// ELITE90 PRO · rascunhar-sugestao
// Netlify Function: item 2 da parte 2 do bloco 5b. Adendo 07, AC-20; Adendo 02,
// coleção 4.3.
//
// O DESTINO DO AUTOSSALVO DO PROFISSIONAL. O núcleo compartilhado chama a entrada
// `m2SalvarRascunho` do gancho a cada tecla digitada, represada em 500 ms. Na
// gaveta do Coach essa entrada grava no campo `draft` de
// `athletes/{uid}/plans/{planType}`. Na rota restrita ela ligará AQUI — porque
// aquele campo é exatamente onde a RN-14 proíbe o trabalho do delegado de viver.
//
// POR QUE FUNÇÃO PRÓPRIA, E NÃO UM MODO DE `submeter-sugestao.ts`
//
// Um parâmetro que desligasse o evento faria a mesma função ora registrar ato,
// ora não. O vocabulário de rastreabilidade é fechado justamente para que a
// emissão NÃO DEPENDA DE ARGUMENTO — e uma função cuja gravação de evento é
// opcional é uma função em que esquecer o argumento apaga o rastro sem que nada
// reprove.
//
// POR QUE SEM EVENTO
//
// `draft` já está no vocabulário de estados da coleção, e a seção 7.4.1 do
// Adendo 02 especifica evento APENAS para submissão, devolução e recusa.
// Rascunho não gera evento — coerente com uma gravação a cada meio segundo, e
// com a mesma razão que dispensou evento no autossalvo do Coach.
//
// AS TRÊS GUARDAS, DE NOVO E POR INTEIRO
//
// A CA-47 é critério de SUPERFÍCIE: reabre a cada função nova que sirva a
// profissional. Esta é a terceira. Papel no token, `active` no documento do
// cadastro, e atribuição ativa para o par atleta + especialidade — sem versão
// resumida, porque uma guarda omitida aqui vale por todas as outras.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { conferirProfissionalAtivo } from "./_profissional-ativo";
import { validarUid, validarPlanType, SPECIALTIES } from "./_m2-validacao";

const COLECAO_PROFISSIONAIS = "professionals";
const COLECAO_ATRIBUICOES = "assignments";
const COLECAO_SUGESTOES = "suggestions";

/**
 * Estados em que o autossalvo pode gravar.
 *
 * `pending` fica DE FORA de propósito: uma sugestão pendente está sob revisão do
 * Coach, e sobrescrever o conteúdo dela mudaria, no meio da leitura, aquilo que
 * ele está lendo. Ver a nota ao fim do arquivo — é ponto não coberto por decisão.
 */
const ESTADOS_RASCUNHAVEIS = ["draft", "returned"];

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
    // Guarda 1 (CA-31). Sinalizador booleano, e nada além — a especialidade não
    // está no token (AC-01), e quem decide a aba é a atribuição (CA-43).
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

  if (corpo.content === null || typeof corpo.content !== "object" || Array.isArray(corpo.content)) {
    return json(400, { erro: "content precisa ser um mapa." });
  }

  const basedOnVersion =
    typeof corpo.basedOnVersion === "number" && Number.isInteger(corpo.basedOnVersion)
      ? corpo.basedOnVersion
      : null;

  const db = getFirestore(app);

  // Guarda 2 (AC-13, CA-47). O cadastro é a verdade; a reivindicação é cache.
  const profSnap = await db.collection(COLECAO_PROFISSIONAIS).doc(professionalId).get();
  const verdicto = conferirProfissionalAtivo(profSnap);
  if (!verdicto.ok) {
    return json(403, { ...NEGADO, reason: verdicto.reason });
  }

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
    // Não distingue "não existe atribuição" de "a atribuição é de outro": a
    // segunda resposta confirmaria a existência do atleta a quem não deveria
    // enxergá-lo.
    return json(403, { ...NEGADO, reason: "sem-atribuicao-ativa" });
  }

  // UM DOCUMENTO NÃO RESOLVIDO POR PAR, e não um por abertura de tela.
  //
  // A precedência de abertura da AC-18 fala em "a sugestão própria não
  // resolvida", no SINGULAR. Se o autossalvo criasse documento novo a cada vez
  // que a tela abrisse, haveria várias em `draft` para o mesmo par, e a regra de
  // abertura ficaria ambígua — sem que nada falhasse, e com o profissional
  // reabrindo um rascunho que não é o último que ele escreveu.
  //
  // SEM `orderBy`, DE PROPÓSITO. O Adendo 02, seção 4.3, especifica dois índices
  // para esta coleção: `status` + `submittedAt`, e `professionalId` +
  // `updatedAt`. Nenhum atende a três igualdades mais ordenação, e acrescentar
  // índice é alteração de esquema, que não é decisão desta função. Três
  // igualdades sem ordenação o Firestore resolve sem índice composto.
  //
  // A escolha entre os resultados é feita em memória, logo abaixo, e não depende
  // de ordem: procura-se o estado, não o mais recente.
  const existentes = await db
    .collection(COLECAO_SUGESTOES)
    .where("professionalId", "==", professionalId)
    .where("athleteUid", "==", athleteUid)
    .where("planType", "==", planType)
    .get();

  const agora = FieldValue.serverTimestamp();
  const alvo = existentes.docs.find((d) => ESTADOS_RASCUNHAVEIS.includes(d.get("status")));
  const pendente = existentes.docs.find((d) => d.get("status") === "pending");

  if (!alvo && pendente) {
    // Sugestão sob revisão do Coach. Sobrescrevê-la trocaria, no meio da
    // leitura, aquilo que ele está lendo — e a devolução dele passaria a se
    // referir a um conteúdo que já não está lá.
    return json(409, {
      erro: "Esta sugestão está em revisão pelo Coach e não pode ser alterada agora.",
      reason: "sugestao-em-revisao",
      suggestionId: pendente.id,
    });
  }

  if (alvo) {
    // GRAVAÇÃO MÍNIMA. Esta função é chamada a cada 500 ms de digitação; tocar
    // os demais campos a cada tecla reescreveria `status`, `basedOnVersion` e
    // carimbos que não mudaram. `submittedAt` em particular NÃO é tocado aqui —
    // quem o carimba é a submissão (AD-08 do Adendo 02).
    const patch: Record<string, unknown> = { content: corpo.content, updatedAt: agora };
    // `basedOnVersion` só é gravado se ainda não houver valor: a versão de
    // origem é do momento da abertura, e não muda enquanto se digita.
    if (basedOnVersion !== null && alvo.get("basedOnVersion") == null) {
      patch.basedOnVersion = basedOnVersion;
    }
    await alvo.ref.update(patch);
    return json(200, { ok: true, suggestionId: alvo.id, status: alvo.get("status") });
  }

  const ref = db.collection(COLECAO_SUGESTOES).doc();
  await ref.set({
    athleteUid,
    planType,
    professionalId,
    status: "draft",
    content: corpo.content,
    basedOnVersion,
    createdAt: agora,
    updatedAt: agora,
    // Nasce sem carimbo de submissão: rascunho não entrou em fila nenhuma, e o
    // tempo de espera da AD-07 é derivado de `submittedAt`.
    submittedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    reviewNote: null,
    resultingVersion: null,
    _test: process.env.CONTEXT !== "production",
  });

  return json(200, { ok: true, suggestionId: ref.id, status: "draft" });
};

// PONTO NÃO COBERTO POR DECISÃO, registrado aqui e levado à frente de
// documentação: o que a tela do profissional deve fazer enquanto a sugestão está
// `pending`. A AC-18 manda ABRIR por sugestão não resolvida, e `pending` é uma
// delas; nenhuma decisão diz se, aberta assim, ela pode ser editada. Esta função
// recusa a gravação, que é a leitura conservadora — não altera documento sob
// revisão —, mas a consequência é que digitar naquele estado devolve 409 a cada
// meio segundo. A alternativa seria a tela abrir a sugestão pendente em modo de
// leitura, e isso é decisão de interface, não desta função.
