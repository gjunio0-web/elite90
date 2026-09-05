// ELITE90 PRO · submeter-sugestao
// Netlify Function: bloco 5b do passo 2 da AC-16 — a escrita da tela restrita.
// Adendo 07: AC-04, AC-13; critérios CA-34 e CA-47.
// Adendo 02: coleção 4.3, decisões AD-08 e AD-10, evento na seção 7.4.1.
//
// A PRIMEIRA ESCRITA DO PROJETO PRATICADA POR UM PROFISSIONAL. Todas as demais
// funções de escrita exigem `decoded.admin`. Esta não — e por isso ela carrega
// as guardas todas, e não uma versão resumida delas.
//
// AS TRÊS GUARDAS, E POR QUE A TERCEIRA MUDA DE FORMA AQUI
//
//   1. Token com `professional: true`                        → 403  (CA-31)
//   2. `professionals/{id}.active === true` NO DOCUMENTO      → 403  (AC-13, CA-47)
//   3. Atribuição ATIVA para o par atleta + especialidade     → 403  (CA-32, CA-44)
//
// Na função de listagem, a terceira guarda é uma CONSULTA: descobre quais
// atletas mostrar. Aqui ela é uma VERIFICAÇÃO: a requisição afirma um par de
// atleta e tipo de plano, e a função confirma que a atribuição existe. Sem essa
// inversão, um profissional legítimo gravaria sugestão para atleta que não é
// dele — bastaria trocar o identificador no corpo da requisição.
//
// A CA-47 é critério de SUPERFÍCIE, não de bloco: ela reabre a cada função nova
// que sirva a profissional. Esta é a segunda.
//
// `planType` E `specialty` SÃO O MESMO VOCABULÁRIO
// `training` | `nutrition` nos dois casos, e é isso que permite confrontar o
// tipo de plano pedido com a especialidade da atribuição. São conceitos
// distintos que hoje coincidem em valores; se um dia divergirem, este ponto é o
// que precisa mudar, e está nomeado para ser encontrado.
//
// CA-34 — ESTA FUNÇÃO NÃO TOCA `athletes/`
// Escreve exclusivamente em `suggestions/{suggestionId}`. O trabalho do
// delegado, mesmo em rascunho, nunca vive no campo `draft` do plano (RN-14).

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { conferirProfissionalAtivo } from "./_profissional-ativo";
import { validarUid, validarPlanType, validarIdDocumento, SPECIALTIES } from "./_m2-validacao";

const COLECAO_PROFISSIONAIS = "professionals";
const COLECAO_ATRIBUICOES = "assignments";
const COLECAO_SUGESTOES = "suggestions";

/** Estados de que uma sugestão pode ser submetida ou ressubmetida (AD-08). */
const ESTADOS_SUBMETIVEIS = ["draft", "returned"] as const;

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

  let ator: Ator & { tipo: "humano" };
  let professionalId: string;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);

    // Guarda 1. `professional` lido como sinalizador booleano. A especialidade
    // não está no token (AC-01) e não seria usada: quem decide é a atribuição
    // (CA-43).
    if (decoded.professional !== true) {
      return json(403, { ...NEGADO, reason: "sem-papel-profissional" });
    }
    if (typeof decoded.professionalId !== "string" || !decoded.professionalId) {
      return json(403, { ...NEGADO, reason: "vinculo-ausente" });
    }
    professionalId = decoded.professionalId;
    ator = {
      tipo: "humano",
      uid: decoded.uid,
      email: decoded.email ?? null,
      papel: "professional",
    };
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

  // O conteúdo é o plano proposto inteiro, e não um diferencial: a AC-06 manda
  // copiar `content` da sugestão aprovada para a versão publicada.
  if (corpo.content === null || typeof corpo.content !== "object" || Array.isArray(corpo.content)) {
    return json(400, { erro: "content precisa ser um mapa." });
  }

  // Ressubmissão informa o documento existente; submissão nova, não.
  let suggestionId: string | null = null;
  if (corpo.suggestionId !== undefined && corpo.suggestionId !== null) {
    const vId = validarIdDocumento(corpo.suggestionId, "suggestionId");
    if (!vId.ok) return json(400, { erro: vId.erro });
    suggestionId = String(corpo.suggestionId);
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
    // Mesma resposta para inexistente e para inativo, como na listagem.
    return json(403, { ...NEGADO, reason: verdicto.reason });
  }

  // Guarda 3 (CA-32, CA-44). Índice já existente:
  // assignments[athleteUid, specialty, startedAt].
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
    // Não distingue "não existe atribuição" de "a atribuição é de outro
    // profissional": a segunda resposta confirmaria a existência do atleta a
    // quem não deveria enxergá-lo.
    return json(403, { ...NEGADO, reason: "sem-atribuicao-ativa" });
  }

  const agora = FieldValue.serverTimestamp();
  const emTeste = process.env.CONTEXT !== "production";
  let idFinal: string;

  if (suggestionId) {
    // RESSUBMISSÃO. AD-08: a devolução zera `submittedAt`, e a ressubmissão o
    // recarimba — é o que faz o tempo de espera na fila recomeçar do zero em vez
    // de contar desde a primeira tentativa.
    const ref = db.collection(COLECAO_SUGESTOES).doc(suggestionId);
    try {
      await db.runTransaction(async (tx) => {
        const atual = await tx.get(ref);
        if (!atual.exists) throw new Error("NAO_ENCONTRADA");

        // A sugestão precisa ser DESTE profissional e DESTE par atleta/plano.
        // Sem esta conferência, a guarda 3 seria contornável: bastaria informar
        // um par legítimo no corpo e o identificador de uma sugestão alheia.
        if (
          atual.get("professionalId") !== professionalId ||
          atual.get("athleteUid") !== athleteUid ||
          atual.get("planType") !== planType
        ) {
          throw new Error("NAO_E_SUA");
        }

        // Submeter o que já está pendente, publicado ou recusado não é
        // ressubmissão: seria recarimbar a fila de quem já a percorreu.
        const estado = atual.get("status");
        if (!ESTADOS_SUBMETIVEIS.includes(estado)) throw new Error("ESTADO:" + estado);

        tx.update(ref, {
          content: corpo.content,
          basedOnVersion,
          status: "pending",
          submittedAt: agora,
          updatedAt: agora,
          // `reviewNote` da devolução anterior é apagada: ela se referia ao
          // conteúdo que acabou de ser substituído, e mantê-la faria o Coach ler
          // uma crítica que já não corresponde ao que está na tela.
          reviewNote: null,
        });
      });
    } catch (e) {
      const m = String((e as Error).message ?? "");
      if (m === "NAO_ENCONTRADA") return json(404, { erro: "Sugestão não encontrada." });
      if (m === "NAO_E_SUA") return json(403, { ...NEGADO, reason: "sugestao-de-outro" });
      if (m.startsWith("ESTADO:")) {
        return json(409, {
          erro: "Esta sugestão não está em estado que admita submissão.",
          reason: "estado-invalido",
        });
      }
      throw e;
    }
    idFinal = suggestionId;
  } else {
    // SUBMISSÃO NOVA. Nasce já `pending`: esta função é a de submeter, e o
    // rascunho local do profissional ainda não é gravado no servidor nesta fase.
    const ref = db.collection(COLECAO_SUGESTOES).doc();
    await ref.set({
      athleteUid,
      planType,
      professionalId,
      status: "pending",
      content: corpo.content,
      basedOnVersion,
      createdAt: agora,
      updatedAt: agora,
      submittedAt: agora,
      resolvedAt: null,
      resolvedBy: null,
      reviewNote: null,
      resultingVersion: null,
      _test: emTeste,
    });
    idFinal = ref.id;
  }

  // Evento: Adendo 02, seção 7.4.1. Ator `professional` — é o único dos três
  // atos de sugestão praticado por quem produz; devolver e recusar são de quem
  // revisa. `detalhe: { planType }` é vocabulário fechado, e nada além dele
  // entra: o conteúdo proposto é plano de um atleta, e a coleção de auditoria
  // não recebe segunda cópia de dado protegido.
  await registrar({
    acao: "sugestao.submetida",
    ator,
    origem: "submeter-sugestao",
    alvo: { colecao: COLECAO_SUGESTOES, id: idFinal } as Alvo,
    detalhe: { planType },
    _test: emTeste,
  });

  return json(200, { ok: true, suggestionId: idFinal, status: "pending" });
};
