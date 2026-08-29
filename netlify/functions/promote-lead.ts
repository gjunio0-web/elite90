// ELITE90 PRO · promote-lead
// Netlify Function: promove um lead do M1 (Captação & Triagem) a atleta do M2
// (Acompanhamento), por decisão explícita do Coach no painel admin.
//
// Substitui o pagamento como GATILHO da entrada no programa. A ROTINA de
// promoção é única e vive aqui; quando a FN-08 (stripe-webhook) for
// implementada, deve chamar esta mesma lógica em vez de duplicá-la.
//
// Segurança: requer Firebase ID token com custom claim admin:true — promover
// cria conta e concede permissão, então exige o mesmo nível de delete-lead.
//
// Contrato de dados: reutiliza _athlete-from-lead.js, o mesmo módulo puro que o
// runner de homologação (scripts/emulate-fn08.js) já usa. Nenhuma tradução
// paralela lead → atleta é criada aqui.
//
// FOTOS DE REFERÊNCIA (decisão de 15/08/2026): baselinePhotos recebe os MESMOS
// caminhos de fotos_paths do lead — não há cópia dos arquivos no Storage. Os
// dois documentos passam a apontar para os mesmos objetos. Por isso a exclusão
// de fichas já promovidas foi bloqueada em delete-lead.ts e em
// purge-rejected-leads.ts: apagar a ficha apagaria as fotos do atleta ativo.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { sendMail, isMailerConfigured } from "./_mailer";
import { EMAIL_BASE_CSS, emailHeader, emblemaAttachment } from "./_email-header";

// @ts-ignore — módulo CommonJS compartilhado com scripts/emulate-fn08.js
import athleteContract from "./_athlete-from-lead.js";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
const { athleteFromLead } = athleteContract as any;

const FASES_VALIDAS = ["Bulking", "Cutting", "Diet Break"];

/** Valida DD/MM/AAAA e confirma que a data existe (rejeita 31/02/2026). */
function isValidBrDate(s: string): boolean {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s ?? "");
  if (!m) return false;
  const [, dd, mm, yyyy] = m;
  const d = new Date(+yyyy, +mm - 1, +dd);
  return d.getFullYear() === +yyyy && d.getMonth() + 1 === +mm && d.getDate() === +dd;
}

// NOTA (decisão de 15/08/2026): este e-mail NÃO traz link de definição de senha.
// O primeiro acesso do atleta será tratado junto com o Portal do Atleta (PRT-01).
// Por isso o texto diz que o Coach enviará os dados de acesso — e não que eles
// virão automaticamente. Não prometer o que o sistema ainda não faz.
function buildWelcomeEmail(nome: string, startDate: string, idioma: string): string {
  const firstName = String(nome || "").split(" ")[0];
  const en = idioma === "en";
  const txt = en ? {
    lang: "en", title: "ELITE 90 PRO — Welcome",
    tagline: "High Performance Strategy",
    h1: `${firstName}, your place is confirmed.`,
    p1a: "You have been approved for the", p1b: "Your 90-day cycle starts on",
    stepsTitle: "What happens now:",
    s1: "— The Coach will contact you to arrange the first step.",
    s2: "— Your training and nutrition plans will be built from your assessment.",
    s3: "— From then on, follow-up is weekly.",
    close: "If you have any questions, just reply to this message.",
  } : {
    lang: "pt-BR", title: "ELITE 90 PRO — Bem-vindo",
    tagline: "Estratégia de Alta Performance",
    h1: `${firstName}, sua vaga está confirmada.`,
    p1a: "Você foi aprovado no", p1b: "Seu ciclo de 90 dias começa em",
    stepsTitle: "O que acontece agora:",
    s1: "— O Coach entrará em contato com você para combinar o primeiro passo.",
    s2: "— Seu plano de treino e de nutrição será montado a partir da sua avaliação.",
    s3: "— A partir daí, o acompanhamento é semanal.",
    close: "Qualquer dúvida, basta responder a esta mensagem.",
  };
  return `<!DOCTYPE html>
<html lang="${txt.lang}">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${txt.title}</title>
<style>
${EMAIL_BASE_CSS}
  h1{font-size:22px;font-weight:700;color:#FFFFFF;text-transform:uppercase;letter-spacing:.04em;margin:0 0 16px;}
  p{font-size:15px;line-height:1.7;margin:0 0 16px;}
  .highlight{color:#A6C300;font-weight:700;}
  .steps{background:#121212;border-left:3px solid #A6C300;padding:20px 24px;border-radius:0 6px 6px 0;margin:24px 0;}
  .steps p{margin:0 0 8px;font-size:14px;}
  .steps p:last-child{margin:0;}
  .sig{margin-top:40px;padding-top:24px;border-top:1px solid #1a1a1a;}
  .sig-name{font-size:16px;font-weight:700;color:#FFFFFF;text-transform:uppercase;letter-spacing:.06em;}
  .sig-title{font-size:11px;color:#A6C300;letter-spacing:.15em;text-transform:uppercase;margin-top:4px;}
</style>
</head>
<body>
<div class="wrap">
${emailHeader(txt.tagline)}
  <h1>${txt.h1}</h1>
  <p>
    ${txt.p1a} <span class="highlight">Programa ELITE 90 PRO</span>.
    ${txt.p1b} <span class="highlight">${startDate}</span>.
  </p>
  <div class="steps">
    <p><strong style="color:#fff;">${txt.stepsTitle}</strong></p>
    <p>${txt.s1}</p>
    <p>${txt.s2}</p>
    <p>${txt.s3}</p>
  </div>
  <p>${txt.close}</p>
  <div class="sig">
    <div class="sig-name">Fernando Ruiz</div>
    <div class="sig-title">Coach Ruiz | ELITE 90 PRO</div>
  </div>
</div>
</body>
</html>`;
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: JSON.stringify({ error: "Não autenticado." }) };

  let caller: any;
  try {
    caller = await getAuth(app).verifyIdToken(idToken);
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: "Token inválido." }) };
  }
  if (caller.admin !== true) {
    return { statusCode: 403, body: JSON.stringify({ error: "Ação restrita ao administrador." }) };
  }
  const ator: Ator & { tipo: "humano" } = {
    tipo: "humano",
    uid: caller.uid,
    email: caller.email ?? null,
    papel: "admin",
  };

  try {
    const body = JSON.parse(event.body ?? "{}");
    const leadId: string    = String(body.leadId ?? "").trim();
    const startDate: string = String(body.startDate ?? "").trim();
    const phase: string     = String(body.phase ?? "Bulking").trim();
    const sendWelcome: boolean = body.sendWelcome !== false;

    if (!leadId) {
      return { statusCode: 400, body: JSON.stringify({ error: "leadId é obrigatório." }) };
    }
    if (!isValidBrDate(startDate)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Data de início inválida." }) };
    }
    if (!FASES_VALIDAS.includes(phase)) {
      return { statusCode: 400, body: JSON.stringify({ error: `Fase deve ser uma de: ${FASES_VALIDAS.join(", ")}.` }) };
    }

    const db = getFirestore();
    const leadRef  = db.collection("leads").doc(leadId);
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) {
      return { statusCode: 404, body: JSON.stringify({ error: "Ficha não encontrada." }) };
    }
    const lead: any = { id: leadId, ...leadSnap.data() };

    if (!lead.email) {
      return {
        statusCode: 422,
        body: JSON.stringify({ error: "A ficha não tem e-mail — não é possível criar a conta de acesso." }),
      };
    }

    // -- Guarda de idempotência --
    // Sobrescrever devolveria o atleta ao dia 1 do ciclo, apagando semana, dia
    // e peso atual já acumulados. O caso do atleta excluído depois (referência
    // órfã na ficha) segue adiante e repromove.
    if (lead.convertedAt && lead.convertedAthleteUid) {
      const existente = await db.collection("athletes").doc(lead.convertedAthleteUid).get();
      if (existente.exists) {
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: "Esta ficha já foi promovida a atleta.",
            athleteUid: lead.convertedAthleteUid,
          }),
        };
      }
    }

    // -- Conta de acesso: cria ou reaproveita a existente pelo e-mail --
    const auth = getAuth(app);
    const emailNorm = String(lead.email).trim().toLowerCase();
    let uid: string;
    // Distingue promoção que CRIOU conta de promoção sobre conta que já existia
    // — são situações diferentes de suporte, e o documento do atleta não guarda
    // essa diferença em lugar nenhum.
    let contaCriada = false;
    try {
      uid = (await auth.getUserByEmail(emailNorm)).uid;
    } catch {
      const criada = await auth.createUser({
        email: emailNorm,
        emailVerified: false,
        displayName: String(lead.nome ?? "").trim() || undefined,
        // Senha aleatória e descartada: o primeiro acesso será definido junto
        // com o Portal do Atleta (PRT-01). Até lá, o Coach envia o acesso.
        password: `E90-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
      });
      uid = criada.uid;
      contaCriada = true;
    }

    // Preserva claims existentes — a conta pode já ter outro papel.
    const claimsAtuais = (await auth.getUser(uid)).customClaims ?? {};
    await auth.setCustomUserClaims(uid, { ...claimsAtuais, athlete: true });

    // -- Documento do atleta, pelo contrato compartilhado --
    const athleteDoc = athleteFromLead(lead, null, {
      uid,
      leadId,
      startDate,
      phase,
      test: lead._test === true,
    });
    // Fotos do Dia 1 = as mesmas enviadas na ficha de triagem (decisão 15/08/2026).
    athleteDoc.baselinePhotos = Array.isArray(lead.fotos_paths) ? lead.fotos_paths : [];

    // DATA NO PASSADO É INTENCIONAL (decisão de 15/08/2026): permite regularizar
    // quem já começou o acompanhamento antes de existir registro no sistema.
    // Por isso semana e dia NÃO podem ficar fixos em 1 como o contrato entrega por
    // padrão — ficariam contradizendo a própria data de início desde o instante da
    // criação. São derivados aqui, limitados ao tamanho do ciclo (13 semanas / 90
    // dias). Data futura mantém dia 1: o ciclo ainda não começou.
    const [ddS, mmS, yyyyS] = startDate.split("/").map(Number);
    const inicio = new Date(yyyyS, mmS - 1, ddS);
    const hoje = new Date();
    const diasCorridos = Math.floor(
      (Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
       - Date.UTC(inicio.getFullYear(), inicio.getMonth(), inicio.getDate())) / 86400000
    );
    const dia = Math.min(90, Math.max(1, diasCorridos + 1));
    athleteDoc.day  = dia;
    athleteDoc.week = Math.min(13, Math.ceil(dia / 7));
    athleteDoc.payment         = null;   // entrada por decisão do Coach, não por pagamento
    athleteDoc._source         = "promote-lead";
    athleteDoc.promotedBy      = caller.uid;
    athleteDoc.promotedByEmail = caller.email ?? null;

    await db.collection("athletes").doc(uid).set(athleteDoc, { merge: true });

    // -- Fecha o elo na ficha de origem --
    await leadRef.update({
      convertedAt:         FieldValue.serverTimestamp(),
      convertedAthleteUid: uid,
      convertedBy:         caller.uid,
      convertedByEmail:    caller.email ?? null,
    });

    // A promoção está consumada aqui: a conta existe, o documento do atleta foi
    // gravado e o elo na ficha foi fechado. O e-mail de boas-vindas vem depois e
    // é não-fatal por decisão do próprio fluxo, então não faz parte deste ato.
    await registrar({
      acao: "atleta.promovido",
      ator,
      origem: "promote-lead",
      alvos: [
        { colecao: "leads", id: leadId } as Alvo,
        { colecao: "athletes", id: uid } as Alvo,
      ],
      detalhe: { contaCriada },
    });

    // -- E-mail de boas-vindas (opcional, escolha do Coach no modal) --
    // Não-fatal: a promoção já aconteceu quando chegamos aqui. Falha no envio
    // é reportada ao painel, não desfaz a promoção.
    let welcomeSent = false;
    let welcomeError: string | null = null;
    if (sendWelcome) {
      if (!isMailerConfigured()) {
        welcomeError = "Envio de e-mail não configurado no ambiente.";
      } else {
        try {
          // Idioma da ficha, mesmo critério de submit-lead e send-evaluation.
          const idioma = lead.idioma === "en" ? "en" : "pt-br";
          const primeiroNome = String(lead.nome ?? "").split(" ")[0];
          await sendMail({
            to: emailNorm,
            subject: idioma === "en"
              ? `${primeiroNome}, your place in ELITE 90 PRO is confirmed`
              : `${primeiroNome}, sua vaga no ELITE 90 PRO está confirmada`,
            html: buildWelcomeEmail(lead.nome, startDate, idioma),
            // O cabeçalho referencia o emblema por "cid:"; sem este anexo o leitor
            // receberia um ícone de imagem quebrada.
            attachments: [emblemaAttachment()],
          });
          welcomeSent = true;
        } catch (e: any) {
          welcomeError = e?.message ?? "Falha no envio.";
          console.error("[promote-lead] E-mail não enviado (não-fatal):", welcomeError);
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, athleteUid: uid, startDate, phase, welcomeSent, welcomeError }),
    };

  } catch (err: any) {
    console.error("[promote-lead] Erro:", err?.message ?? err);
    return { statusCode: 500, body: JSON.stringify({ error: err?.message ?? "Erro interno." }) };
  }
};
