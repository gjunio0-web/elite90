// ELITE90 PRO · listar-minhas-propostas
// Netlify Function: segunda peça da AC-34 — a tela mínima que a §5 previu.
//
// Devolve as propostas de catálogo (exercício ou alimento) que O PRÓPRIO
// PROFISSIONAL QUE CHAMA já enviou, com o estado de cada uma. Não é uma
// versão reduzida de listar-exercicios.ts/listar-alimentos.ts — é função
// nova, porque aquelas trazem filtro, paginação e contadores pensados para o
// Coach curar a base inteira, e nada disso serve a "mostre só o que eu
// mandei". Reaproveitar teria significado abrir 200 linhas de superfície
// admin para adaptar 20.
//
// SEM EDITAR, SEM EXCLUIR — só leitura, e só do que o próprio uid criou. A
// tela mínima que consome isto (AC-34, §5) não oferece as duas ações de
// propósito: editar ou excluir proposta já enviada reabriria perguntas que a
// AC-34 não precisou responder para o canal existir (reseta revisão? desfaz
// aprovação? até quando?) — ver a conversa que fechou o escopo desta peça.
//
// MESMAS TRÊS GUARDAS DE listar-atletas-do-profissional.ts, PELO MESMO MOTIVO
//   1. Token com `professional: true`                  → senão 403
//   2. `professionals/{id}.active === true` NO DOCUMENTO → senão 403 (AC-13)
//   3. `tipo` pedido tem que casar com a especialidade   → senão 403 (mesma
//      amarra 2 de atualizar-exercicio.ts/atualizar-alimento.ts, na criação)
//
// SEM EVENTO DE RASTREABILIDADE — leitura não é fato que a rastreabilidade
// exista para preservar, mesmo motivo das demais funções de listagem.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { conferirProfissionalAtivo } from "./_profissional-ativo";
import { FONTE_PROPOSTA_PROFISSIONAL } from "./_vocabulario-alimentos";

const COLECAO_PROFISSIONAIS = "professionals";
const COLECAO_EXERCICIOS = "exercises";
const COLECAO_ALIMENTOS = "foods";

// Mesma string em atualizar-exercicio.ts, mas exercícios não têm arquivo de
// vocabulário próprio para hospedar a constante — ela nasce lá, direto no
// campo `origem.fonte`. Repetida aqui, não importada, porque não há de onde
// importar sem criar dependência nova só para isto.
const ORIGEM_EXERCICIO_PROPOSTA = "proposta-profissional";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };

  let uid: string;
  let professionalId: string;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    // GUARDA 1 · token com professional: true.
    if (decoded.professional !== true) {
      return json(403, { erro: "Acesso não autorizado.", reason: "sem-papel-profissional" });
    }
    if (typeof decoded.professionalId !== "string" || !decoded.professionalId) {
      return json(403, { erro: "Acesso não autorizado.", reason: "vinculo-ausente" });
    }
    uid = decoded.uid;
    professionalId = decoded.professionalId;
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo não é JSON válido." });
  }

  const tipo = corpo.tipo;
  if (tipo !== "exercicio" && tipo !== "alimento") {
    return json(400, { erro: "tipo obrigatório: 'exercicio' ou 'alimento'." });
  }

  const db = getFirestore(app);

  // GUARDA 2 · profissional ativo, lido do documento, não do token — a
  // reivindicação é cache (ver o cabeçalho de listar-atletas-do-profissional.ts
  // para o raciocínio completo sobre por que isso importa).
  const snapProf = await db.collection(COLECAO_PROFISSIONAIS).doc(professionalId).get();
  const verdicto = conferirProfissionalAtivo(snapProf);
  if (!verdicto.ok) {
    return json(verdicto.reason === "nao-encontrado" ? 404 : 403, {
      erro: verdicto.reason === "inativo" ? "Cadastro desativado. Procure o Coach." : verdicto.erro,
      reason: verdicto.reason,
    });
  }

  // GUARDA 3 · tipo pedido tem que casar com a especialidade — mesma amarra 2
  // que a criação já aplica. Sem ela, um profissional de nutrição poderia ao
  // menos ENXERGAR que propôs exercícios em algum momento anterior a perder a
  // especialidade, o que não deveria ser possível de começo.
  const especialidades = Array.isArray(verdicto.dados.specialties) ? verdicto.dados.specialties : [];
  const especialidadeNecessaria = tipo === "exercicio" ? "training" : "nutrition";
  if (!especialidades.includes(especialidadeNecessaria)) {
    return json(403, { erro: "Sua especialidade não corresponde a este tipo.", reason: "especialidade-incompativel" });
  }

  const colecao = tipo === "exercicio" ? COLECAO_EXERCICIOS : COLECAO_ALIMENTOS;
  const fonteEsperada = tipo === "exercicio" ? ORIGEM_EXERCICIO_PROPOSTA : FONTE_PROPOSTA_PROFISSIONAL;

  try {
    // Só o que este uid propôs. Não filtra por fonte na consulta — exercícios
    // guardam a fonte dentro de `origem.fonte` (objeto), e o Firestore não
    // indexa esse aninhamento por padrão nesta base; filtra-se depois de ler,
    // sobre um conjunto já pequeno (as próprias propostas de UM profissional,
    // não a base inteira).
    const snap = await db.collection(colecao).where("criadoPor", "==", uid).get();

    const propostas = snap.docs
      .map((d) => {
        const x = d.data() ?? {};
        const fonte = tipo === "exercicio" ? x.origem?.fonte : x.fonte;
        return { doc: d, x, fonte };
      })
      .filter((p) => p.fonte === fonteEsperada)
      .map(({ doc, x }) => ({
        id: doc.id,
        nome: tipo === "exercicio" ? x.nome_pt ?? null : x.nomeExibicao ?? null,
        // "aprovado" só quando o Coach de fato carimbou — o mesmo campo que
        // as telas de curadoria já leem, não um estado novo e paralelo.
        status: x.revisadoPor ? "aprovado" : "pendente",
        criadoEm: x.criadoEm ?? null,
      }))
      .sort((a, b) => {
        // Mais recente primeiro. criadoEm é Timestamp do Firestore quando
        // presente; ausência (não deveria acontecer, mas sem garantia externa)
        // vai para o fim, não quebra a ordenação.
        const ta = a.criadoEm?.toMillis?.() ?? 0;
        const tb = b.criadoEm?.toMillis?.() ?? 0;
        return tb - ta;
      });

    return json(200, { propostas, total: propostas.length });
  } catch (e) {
    console.error("[listar-minhas-propostas] falha ao ler:", e);
    return json(500, { erro: "Não foi possível ler suas propostas agora." });
  }
};
