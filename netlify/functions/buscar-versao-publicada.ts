// ELITE90 PRO · buscar-versao-publicada
// Netlify Function: AC-27 do Adendo 07 — casca HTTP fina sobre
// `versao-publicada.ts`, para o consumidor que roda no NAVEGADOR: o
// cabeçalho da gaveta do Coach. `plano/[token].astro`, que roda em SSR, importa
// o módulo interno diretamente — ver o cabeçalho dele para a razão.
//
// GUARDA ACRESCENTADA NA REVISÃO (achado de segurança, verificação do bloco
// AC-27): a primeira versão não verificava token nenhum, com a justificativa
// de que "o conteúdo já é acessível sem autenticação pela página pública, e o
// token na URL é a autorização". A alegação não se sustenta: o token da
// página pública é aleatório e de uso único (compartilhar-plano.ts,
// randomBytes), enquanto este endpoint recebia `athleteUid` cru — o
// identificador de documento comum, já devolvido ao cliente do profissional
// em toda projeção (inclusive nível 1, externo) porque as próprias chamadas
// do profissional precisam dele. Sem guarda, qualquer chamador que soubesse
// o athleteUid de UM atleta (nem precisa ter vínculo com ele) leria o plano
// publicado de QUALQUER outro — contornando exatamente a atribuição que
// CA-32/CA-44 exigem em todo outro caminho do profissional.
//
// A guarda agora aceita os DOIS papéis que legitimamente precisam desta
// leitura: o Coach (admin, sem mais condição — mesma guarda das demais
// funções do Coach) e o profissional com atribuição ATIVA para o par
// athleteUid+specialty — mesmas três guardas de abrir-plano-profissional.ts,
// exceto que aqui um único papel (admin) já basta e pula as duas seguintes.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { buscarVersaoPublicada } from "../../apps/site/src/lib/versao-publicada";
import { validarUid, validarPlanType, SPECIALTIES } from "./_m2-validacao";
import { conferirProfissionalAtivo } from "./_profissional-ativo";

const COLECAO_PROFISSIONAIS = "professionals";
const COLECAO_ATRIBUICOES = "assignments";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

const NEGADO = { erro: "Acesso não autorizado." };

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let decoded: any;
  try {
    decoded = await getAuth(app).verifyIdToken(idToken);
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo inválido." });
  }

  const vUid = validarUid(corpo.athleteUid);
  if (!vUid.ok) return json(400, { erro: vUid.erro });
  const vTipo = validarPlanType(corpo.planType);
  if (!vTipo.ok) return json(400, { erro: vTipo.erro });

  const athleteUid: string = corpo.athleteUid;
  const planType: string = corpo.planType;

  const db = getFirestore(app);

  if (decoded.admin !== true) {
    // Não é o Coach: só resta o caminho do profissional, com as mesmas três
    // guardas de abrir-plano-profissional.ts (a primeira — papel no token —
    // já está coberta pelo "não é admin" acima combinado com o teste abaixo).
    if (decoded.professional !== true) {
      return json(403, { ...NEGADO, reason: "sem-papel-reconhecido" });
    }
    if (typeof decoded.professionalId !== "string" || !decoded.professionalId) {
      return json(403, { ...NEGADO, reason: "vinculo-ausente" });
    }
    const professionalId = decoded.professionalId;

    const profSnap = await db.collection(COLECAO_PROFISSIONAIS).doc(professionalId).get();
    const verdicto = conferirProfissionalAtivo(profSnap);
    if (!verdicto.ok) return json(403, { ...NEGADO, reason: verdicto.reason });

    const especialidade = SPECIALTIES.find((s) => s === planType);
    if (!especialidade) return json(400, { erro: "planType fora do vocabulário." });

    const atribuicao = await db
      .collection(COLECAO_ATRIBUICOES)
      .where("athleteUid", "==", athleteUid)
      .where("specialty", "==", especialidade)
      .where("endedAt", "==", null)
      .limit(1)
      .get();

    const ativa = atribuicao.docs[0];
    if (!ativa || ativa.get("professionalId") !== professionalId) {
      // Mesma resposta para "não existe atribuição" e "é de outro profissional" —
      // ver a mesma nota em abrir-plano-profissional.ts.
      return json(403, { ...NEGADO, reason: "sem-atribuicao-ativa" });
    }
  }

  try {
    const resultado = await buscarVersaoPublicada(db, athleteUid, planType);
    return json(200, resultado);
  } catch (e) {
    console.error("[buscar-versao-publicada] falha ao consultar:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return json(500, { erro: "Não foi possível consultar a versão agora — " + msg });
  }
};
