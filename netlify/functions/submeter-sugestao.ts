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
import { sendMail, isMailerConfigured } from "./_mailer";
import { emblemaAttachment } from "./_email-emblema";
import { EMAIL_BASE_CSS, emailHeader } from "./_email-header";
import { ROTULO_PLANO } from "./_email-decisao-sugestao";

const COLECAO_PROFISSIONAIS = "professionals";
const COLECAO_ATRIBUICOES = "assignments";
const COLECAO_SUGESTOES = "suggestions";

/** Estados de que uma sugestão pode ser submetida ou ressubmetida (AD-08). */
const ESTADOS_SUBMETIVEIS = ["draft", "returned"] as const;

const COLECAO_ATLETAS = "athletes";

const idDaVersao = (n: number) => "v" + String(n).padStart(3, "0");

/**
 * ENVIO SEM ALTERAÇÃO É RECUSADO
 *
 * A tela do profissional abre a versão publicada corrente (AC-23, fonte 2) e
 * informa o número dela em `basedOnVersion`. Submeter o mesmo conteúdo que se
 * abriu produziria versão nova, imutável e sem efeito para o atleta, e tomaria
 * o tempo do Coach numa revisão que não tem o que revisar.
 *
 * A comparação é de FORMA, não de identidade de objeto: chaves ordenadas, e
 * fora dela os campos que o servidor acrescenta ou que só existem no navegador.
 * `snapshot` e `congeladoEm` são produzidos na publicação, nunca vêm do
 * profissional; `isNew` é marca de estado vazio da tela.
 */
const IGNORADAS = new Set(["snapshot", "congeladoEm", "_congeladoNoCliente", "isNew"]);

function normalizar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(normalizar);
  if (valor !== null && typeof valor === "object" && (valor as object).constructor === Object) {
    const saida: Record<string, unknown> = {};
    for (const chave of Object.keys(valor as Record<string, unknown>).sort()) {
      if (IGNORADAS.has(chave)) continue;
      const v = (valor as Record<string, unknown>)[chave];
      if (v === undefined) continue;
      saida[chave] = normalizar(v);
    }
    return saida;
  }
  return valor;
}

const mesmoConteudo = (a: unknown, b: unknown) =>
  JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));

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

  // Envio sem alteração. Só se aplica quando há versão de partida: sem ela não
  // existe "o que o profissional abriu" com que comparar. A leitura é do
  // documento da versão, pelo número — não da última publicada: comparar com
  // outra versão recusaria trabalho real feito sobre a versão de partida.
  if (basedOnVersion !== null) {
    const refVersao = db
      .collection(COLECAO_ATLETAS).doc(athleteUid)
      .collection("plans").doc(planType)
      .collection("versions").doc(idDaVersao(basedOnVersion));
    const versao = await refVersao.get();
    if (versao.exists && mesmoConteudo(corpo.content, versao.get("content"))) {
      return json(409, {
        erro: "Nada foi alterado em relação ao plano publicado. Faça ao menos um ajuste antes de enviar.",
        reason: "sem-alteracao",
      });
    }
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

  // ── AVISO AO COACH (AC-36, CA-115/CA-119) ──────────────────────────────
  // Um e-mail POR SUBMISSÃO, sem agregação — cada sugestão é fato distinto,
  // com rastro próprio; agregar esconderia volume real de trabalho pendente.
  // Dispara igual em submissão nova e em ressubmissão: as duas passam por
  // aqui, e as duas são coisa que o Coach precisa saber que chegou.
  //
  // Mesmo mecanismo de submit-lead.ts: ausência de COACH_NOTIFICATION_EMAIL
  // DESLIGA o aviso, não é erro — e-mail que falha por outro motivo é
  // não-fatal (CA-118), como em toda a AC-36.
  const coachEmail = process.env.COACH_NOTIFICATION_EMAIL?.trim();
  if (coachEmail && isMailerConfigured()) {
    try {
      const [profSnap, athleteSnap] = await Promise.all([
        db.collection(COLECAO_PROFISSIONAIS).doc(professionalId).get(),
        db.collection("athletes").doc(athleteUid).get(),
      ]);
      const nomeProfissional = String(profSnap.data()?.name ?? "Um profissional");
      const nomeAtleta = String(athleteSnap.data()?.name ?? "um atleta");
      const rotuloPlano = ROTULO_PLANO[planType as "training" | "nutrition"];
      const urlAdmin =
        process.env.CONTEXT === "production"
          ? "https://coachruiz.com.br/admin/login"
          : "https://quality-env--elite90.netlify.app/admin/login";
      await sendMail({
        to: coachEmail,
        subject: `Nova sugestão para revisar — ${rotuloPlano} — ELITE 90 PRO`,
        html: buildSubmissaoEmail(nomeProfissional, nomeAtleta, rotuloPlano, urlAdmin),
        attachments: [emblemaAttachment()],
      });
    } catch (e) {
      console.error("[submeter-sugestao] aviso ao Coach não enviado (não-fatal):", e);
    }
  }

  return json(200, { ok: true, suggestionId: idFinal, status: "pending" });
};

function buildSubmissaoEmail(
  nomeProfissional: string,
  nomeAtleta: string,
  rotuloPlano: string,
  urlAdmin: string,
): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<meta name="supported-color-schemes" content="dark"/>
<title>ELITE 90 PRO — Nova sugestão</title>
<style>
${EMAIL_BASE_CSS}
  h1{font-size:22px;font-weight:700;color:#FFFFFF !important;text-transform:uppercase;letter-spacing:.04em;margin:0 0 16px;}
  p{font-size:15px;line-height:1.7;margin:0 0 16px;color:#CCCCCC !important;}
  .btn{display:inline-block;background:#A6C300;color:#0D0D0D !important;font-weight:700;text-decoration:none;
       padding:14px 28px;border-radius:6px;text-transform:uppercase;letter-spacing:.04em;font-size:14px;margin:8px 0 8px;}
</style>
</head>
<body>
<div class="wrap">
${emailHeader("Nova sugestão de plano")}
  <h1>Uma sugestão chegou para revisão.</h1>
  <p>
    <span style="color:#A6C300 !important;font-weight:700;">${nomeProfissional}</span> enviou um
    ${rotuloPlano.toLowerCase()} para <span style="color:#A6C300 !important;font-weight:700;">${nomeAtleta}</span>.
  </p>
  <p><a class="btn" href="${urlAdmin}">Revisar agora</a></p>
</div>
</body>
</html>`;
}
