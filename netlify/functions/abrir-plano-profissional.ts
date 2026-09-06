// ELITE90 PRO · abrir-plano-profissional
// Netlify Function: item 3 da parte 2 do bloco 5b — a fonte de abertura do
// editor da rota restrita. Adendo 07: AC-18, AC-23, AC-24; AC-13 e CA-47.
//
// QUARTA FUNÇÃO A SERVIR PROFISSIONAL. A CA-47 é critério de SUPERFÍCIE e
// reabre a cada função nova: as três guardas vão inteiras, sem versão resumida.
//
// A ORIGEM DO PLANO É DA HOSPEDEIRA (AC-18), E ESTA É A DA ROTA RESTRITA
//
// A hospedeira do Coach abre por rascunho persistido, cache de sessão e
// plano-base. Esta abre por outro caminho, e a diferença não é de conveniência:
// o campo `draft` de `athletes/{uid}/plans/{planType}` é EXATAMENTE onde a RN-14
// proíbe que o trabalho do delegado viva, e o plano-base é artefato de
// homologação da gaveta.
//
// PRECEDÊNCIA, COM DUAS FONTES E NÃO TRÊS (AC-23)
//
//   1. sugestão própria não resolvida — `draft`, `pending` ou `returned`
//   2. (última versão publicada — INALCANÇÁVEL: a subcoleção de versões não é
//      escrita por código algum, e passa a existir com a AC-06)
//   3. vazio
//
// `basedOnVersion` volta sempre nulo enquanto a fonte 2 não existir. A
// precedência da AC-18 permanece correta como destino: a fonte 2 falta por
// AUSÊNCIA DE DADO, não por decisão.
//
// O `status` VAI JUNTO, E É O QUE DECIDE O MODO DA TELA (AC-24)
//
// A precedência escolhe O QUÊ; o estado do escolhido determina COMO. Uma
// sugestão `pending` está sob revisão do Coach, e a função de rascunho recusa
// gravar nela. A tela abre em somente leitura — e é por isso que o `status`
// precisa vir daqui, e não ser deduzido.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { conferirProfissionalAtivo } from "./_profissional-ativo";
import { nivelPara, projetarAtleta } from "./_projecao-atleta";
import { validarUid, validarPlanType, SPECIALTIES } from "./_m2-validacao";

const COLECAO_PROFISSIONAIS = "professionals";
const COLECAO_ATRIBUICOES = "assignments";
const COLECAO_SUGESTOES = "suggestions";
const COLECAO_ATLETAS = "athletes";

/** Estados em que a sugestão ainda não foi resolvida pelo Coach (AC-18). */
const NAO_RESOLVIDOS = ["draft", "returned", "pending"];

/**
 * Ordem de preferência quando houver mais de uma não resolvida para o mesmo par.
 * Editável primeiro: se existe um `draft` ou um `returned`, é nele que o
 * profissional trabalha, e abrir a `pending` em leitura seria pior — travaria a
 * tela por causa de um documento que já foi superado pelo trabalho em curso.
 */
const PREFERENCIA = ["returned", "draft", "pending"];

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

  let professionalId: string;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    // Guarda 1 (CA-31). Sinalizador booleano — a especialidade não está no token
    // (AC-01), e quem decide a aba é a atribuição (CA-43).
    if (decoded.professional !== true) {
      return json(403, { ...NEGADO, reason: "sem-papel-profissional" });
    }
    if (typeof decoded.professionalId !== "string" || !decoded.professionalId) {
      return json(403, { ...NEGADO, reason: "vinculo-ausente" });
    }
    professionalId = decoded.professionalId;
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

  // Guarda 2 (AC-13, CA-47). O cadastro é a verdade; a reivindicação é cache.
  const profSnap = await db.collection(COLECAO_PROFISSIONAIS).doc(professionalId).get();
  const verdicto = conferirProfissionalAtivo(profSnap);
  if (!verdicto.ok) return json(403, { ...NEGADO, reason: verdicto.reason });

  // Guarda 3 (CA-32, CA-44). O par atleta + especialidade precisa estar na
  // carteira DESTE profissional, agora.
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
    return json(403, { ...NEGADO, reason: "sem-atribuicao-ativa" });
  }

  // O ATLETA, PELA PROJEÇÃO (AD-06). O nível vem da CLASSIFICAÇÃO DO CADASTRO, e
  // não da reivindicação homônima do token: a reivindicação é cache, e um token
  // emitido antes de uma edição diria `internal` para quem virou `external` —
  // entregando nome real a delegado externo.
  const atletaSnap = await db.collection(COLECAO_ATLETAS).doc(athleteUid).get();
  if (!atletaSnap.exists) {
    return json(404, { erro: "Atleta não encontrado." });
  }
  const nivel = nivelPara(verdicto.dados.classification);
  const atleta = projetarAtleta(atletaSnap.id, atletaSnap.data() ?? {}, nivel);

  // Fonte 1: sugestão própria não resolvida. Três igualdades e sem ordenação —
  // os índices declarados na seção 4.3 do Adendo 02 não atendem a três
  // igualdades mais ordenação, e acrescentar índice é alteração de esquema.
  const sugestoes = await db
    .collection(COLECAO_SUGESTOES)
    .where("professionalId", "==", professionalId)
    .where("athleteUid", "==", athleteUid)
    .where("planType", "==", planType)
    .get();

  const candidatas = sugestoes.docs.filter((d) => NAO_RESOLVIDOS.includes(d.get("status")));
  let escolhida = null as (typeof candidatas)[number] | null;
  for (const estado of PREFERENCIA) {
    const achada = candidatas.find((d) => d.get("status") === estado);
    if (achada) { escolhida = achada; break; }
  }

  if (escolhida) {
    return json(200, {
      atleta,
      origem: "sugestao",
      suggestionId: escolhida.id,
      status: escolhida.get("status"),
      content: escolhida.get("content") ?? null,
      basedOnVersion: escolhida.get("basedOnVersion") ?? null,
      reviewNote: escolhida.get("reviewNote") ?? null,
    });
  }

  // Fonte 3: vazio. A fonte 2 seria consultada aqui, e não é (AC-23).
  return json(200, {
    atleta,
    origem: "vazio",
    suggestionId: null,
    status: null,
    content: null,
    basedOnVersion: null,
    reviewNote: null,
  });
};
