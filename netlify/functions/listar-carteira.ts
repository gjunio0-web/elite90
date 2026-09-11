// ELITE90 PRO · listar-carteira
// Netlify Function: leitura de vínculos ativos de `assignments`, para a tela
// administrativa da Fase 4-D.
//
// Adendo 09, AT-23 — especificação completa, §4.9. Esta função implementa a
// especificação; não decide nada que o adendo não tenha decidido.
//
// POR QUE ESTA FUNÇÃO EXISTE (T-49 a T-51)
// Dois atos da AT-07 são hoje inalcançáveis pela tela: encerrar carteira e
// atribuir carteira a um atleta que já tem profissional. `encerrar-carteira.ts`
// exige `assignmentId`, e nada o devolve ao administrador. A única leitura de
// carteira que existia (`listar-atletas-do-profissional.ts`) é do profissional
// sobre si mesmo: recusa qualquer token sem o papel `professional`, inclusive
// o do admin, e o identificador vem do TOKEN, sem caminho para o admin
// informar de quem quer ver a carteira. E `assignments` está fechada ao
// navegador (AT-11), sem exceção.
//
// FILTRO EXCLUSIVO: `professionalId` OU `athleteUid`, NUNCA NENHUM, NUNCA OS
// DOIS (§4.9.1). Corpo fora dessa regra é 400 — mesma disciplina que
// listar-titulares.ts já aplicou contra leitura sem recorte.
//
// NÃO DEVOLVE VÍNCULOS ENCERRADOS (§4.9.3), em nenhum dos dois filtros.
// Histórico é matéria de rastreabilidade; esta função serve à gestão do que
// está ativo agora.
//
// ┌── NÃO É A LEITURA CARA DE listar-titulares.ts (§4.9.5) ───────────────────┐
// │ Com QUALQUER UM dos dois filtros, é uma consulta INDEXADA — sobre o       │
// │ índice composto já existente (professionalId+endedAt, T-52) ou sobre      │
// │ índice de campo único, sempre disponível por padrão no Firestore, sem     │
// │ entrada própria no arquivo de índices —, seguida de um `getAll` restrito  │
// │ aos atletas dos vínculos JÁ DEVOLVIDOS. Não há junção de duas coleções    │
// │ inteiras aqui, como há em listar-titulares.ts. NENHUMA DECISÃO FUTURA DE  │
// │ PAGINAÇÃO OU CACHE DEVE TRATAR ESTA FUNÇÃO COM A MESMA CAUTELA — herdar   │
// │ cautela de uma função para outra sem justificar o custo é o erro que a    │
// │ AT-19 já nomeou, do lado oposto.                                          │
// └────────────────────────────────────────────────────────────────────────────┘
//
// `origin` OBRIGATÓRIO NA PROJEÇÃO (§4.9.4), sem exceção. É o que permite ao
// Coach saber, antes de clicar em encerrar, se está prestes a desfazer um
// vínculo de titularidade ou uma atribuição manual — mesma distinção que a
// CT-09 já provou necessária, agora do lado de quem está prestes a ser
// encerrado.
//
// O QUE ESTA FUNÇÃO NÃO FAZ (§4.9.6): não devolve vínculos encerrados; não
// aceita chamada sem filtro nem com os dois filtros juntos; não é consumida
// pela rota restrita do profissional — é exclusiva do admin, como as demais
// funções de escrita sobre `assignments`.
//
// SEM EVENTO DE RASTREABILIDADE — leitura não é fato que a rastreabilidade
// exista para preservar (Adendo 02, seção 7.3), mesma razão de
// listar-profissionais.ts e listar-titulares.ts.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { validarIdDocumento } from "./_m2-validacao";

const COLECAO_ASSIGNMENTS = "assignments";
const COLECAO_ATLETAS = "athletes";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

/** Um vínculo, projetado para a tela (§4.9.4). */
type VinculoListado = {
  assignmentId: string;
  athleteUid: string;
  athleteName: string | null;
  specialty: string;
  origin: string | null;
  professionalId: string;
};

/**
 * Projeta os documentos de `assignments` já lidos, cruzando com os nomes dos
 * atletas. Pura de propósito, como `montarEstado` em listar-titulares.ts:
 * testável sem Firestore nem token.
 */
export function projetarVinculos(
  docs: { id: string; data: () => Record<string, any> }[],
  nomesPorAtleta: Map<string, string | null>,
): VinculoListado[] {
  return docs.map((d) => {
    const x = d.data() ?? {};
    const athleteUid = String(x.athleteUid ?? "");
    return {
      assignmentId: d.id,
      athleteUid,
      athleteName: nomesPorAtleta.get(athleteUid) ?? null,
      specialty: String(x.specialty ?? ""),
      // Sem fallback silencioso: vínculo anterior à entrega 2, sem `origin`
      // gravado, devolve `null` — honesto, não inventado.
      origin: typeof x.origin === "string" ? x.origin : null,
      professionalId: String(x.professionalId ?? ""),
    };
  });
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Guarda de admin ANTES de qualquer leitura do Firestore (§4.9.2, e o
  // princípio já fixado na seção 3.7 do adendo).
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo não é JSON válido." });
  }

  const temProfissional = corpo.professionalId !== undefined && corpo.professionalId !== null;
  const temAtleta = corpo.athleteUid !== undefined && corpo.athleteUid !== null;

  // Filtro exclusivo (§4.9.1): exatamente um dos dois. As mensagens dizem
  // qual das duas violações ocorreu, para não obrigar o chamador a adivinhar.
  if (temProfissional === temAtleta) {
    return json(400, {
      erro: temProfissional
        ? "Informe apenas um filtro: professionalId ou athleteUid, nunca os dois."
        : "Informe um filtro: professionalId ou athleteUid.",
    });
  }

  let campo: "professionalId" | "athleteUid";
  let valor: string;
  if (temProfissional) {
    const v = validarIdDocumento(corpo.professionalId, "professionalId");
    if (!v.ok) return json(400, { erro: v.erro });
    campo = "professionalId";
    valor = String(corpo.professionalId);
  } else {
    const v = validarIdDocumento(corpo.athleteUid, "athleteUid");
    if (!v.ok) return json(400, { erro: v.erro });
    campo = "athleteUid";
    valor = String(corpo.athleteUid);
  }

  const db = getFirestore(app);

  try {
    // A consulta (§4.9.3): sobre o índice composto existente quando o filtro
    // é professionalId, sobre índice de campo único quando é athleteUid —
    // nenhum dos dois exige entrada nova em firestore.indexes.json (T-52).
    const snap = await db
      .collection(COLECAO_ASSIGNMENTS)
      .where(campo, "==", valor)
      .where("endedAt", "==", null)
      .get();

    const uids = [...new Set(snap.docs.map((d) => String(d.get("athleteUid") ?? "")))].filter(Boolean);

    const nomesPorAtleta = new Map<string, string | null>();
    if (uids.length) {
      // getAll restrito aos atletas do LOTE já devolvido — nunca a coleção
      // inteira. É a diferença de custo que o cabeçalho registra.
      const refs = uids.map((uid) => db.collection(COLECAO_ATLETAS).doc(uid));
      const docs = await db.getAll(...refs);
      for (const s of docs) {
        if (s.exists) {
          const nome = (s.data() ?? {}).name;
          nomesPorAtleta.set(s.id, typeof nome === "string" ? nome : null);
        }
      }
    }

    const vinculos = projetarVinculos(snap.docs, nomesPorAtleta);

    return json(200, { vinculos, total: vinculos.length });
  } catch (e) {
    console.error("[listar-carteira] falha ao ler:", e);
    return json(500, { erro: "Não foi possível ler a carteira." });
  }
};
