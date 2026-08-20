// --- ELITE90 PRO · send-evaluation
// Netlify Function: salva o documento de avaliação no Firestore,
// gera token único, cria a página /avaliacao/{token} e envia por e-mail.

import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getApp, getDb } from "./_firebase";
import { randomBytes } from "crypto";
import { sendMail } from "./_mailer";
import { EMAIL_BASE_CSS, emailHeader, emblemaAttachment } from "./_email-header";


function buildEvaluationEmail(
  nome: string,
  token: string,
  sections: Record<string, string>,
  siteUrl: string,
  idioma: string
): string {
  const firstName = nome.split(" ")[0];
  const pageUrl = `${siteUrl}/avaliacao/${token}`;
  const en = idioma === "en";
  const t = en ? {
    lang: "en",
    title: "ELITE90 PRO - Your Assessment",
    tagline: "High Performance Strategy",
    h1: `${firstName}, your strategic plan is ready.`,
    p1: "I reviewed your application carefully. Based on what you sent me, I prepared your",
    docName: "Physique Preparation and Strategic Planning Guidelines",
    p2: "This is the starting point. The document below contains my full analysis and the next steps to build the physique you deserve.",
    previewTitle: "Preview - Assessment",
    cta: "Access my full plan",
    direct: "Or go directly to:",
    sigTitle: "Coach Ruiz · ELITE90 PRO",
  } : {
    lang: "pt-BR",
    title: "ELITE90 PRO - Sua Avaliação",
    tagline: "Estratégia de Alta Performance",
    h1: `${firstName}, seu planejamento estratégico está pronto.`,
    p1: "Analisei sua ficha com atenção. Com base no que você me enviou, preparei suas",
    docName: "Diretrizes de Preparação e Planejamento Estratégico do Físico",
    p2: "Este é o ponto de partida. O documento abaixo contém minha análise completa e os próximos passos para construir o físico que você merece.",
    previewTitle: "Prévia - Diagnóstico",
    cta: "Acessar meu planejamento completo",
    direct: "Ou acesse diretamente:",
    sigTitle: "Coach Ruiz · ELITE90 PRO",
  };

  return `
<!DOCTYPE html>
<html lang="${t.lang}">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${t.title}</title>
<style>
${EMAIL_BASE_CSS}
  h1{font-size:22px;font-weight:700;color:#fff;text-transform:uppercase;margin:0 0 16px;}
  p{font-size:15px;line-height:1.7;margin:0 0 16px;}
  .highlight{color:#A6C300;font-weight:700;}
  .cta-wrap{text-align:center;margin:32px 0;}
  .cta{display:inline-block;background:#A6C300;color:#000;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:16px 40px;border-radius:50px;text-decoration:none;font-size:14px;}
  .section-preview{background:#121212;border-left:3px solid #A6C300;padding:16px 20px;border-radius:0 6px 6px 0;margin:20px 0;font-size:13px;line-height:1.6;}
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#A6C300;margin-bottom:8px;}
  .sig{margin-top:40px;padding-top:24px;border-top:1px solid #1a1a1a;}
  .sig-name{font-size:16px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.06em;}
  .sig-title{font-size:11px;color:#A6C300;letter-spacing:.15em;text-transform:uppercase;margin-top:4px;}
</style>
</head>
<body>
<div class="wrap">
${emailHeader(t.tagline)}

  <h1>${t.h1}</h1>

  <p>
    ${t.p1} <span class="highlight">${t.docName}</span>.
  </p>

  <p>
    ${t.p2}
  </p>

  <div class="section-preview">
    <div class="section-title">${t.previewTitle}</div>
    ${(sections.s1 ?? "").slice(0, 300)}${sections.s1?.length > 300 ? "..." : ""}
  </div>

  <div class="cta-wrap">
    <a href="${pageUrl}" class="cta">${t.cta}</a>
  </div>

  <p style="font-size:13px;color:#666;text-align:center;">
    ${t.direct} <a href="${pageUrl}" style="color:#A6C300;">${pageUrl}</a>
  </p>

  <div class="sig">
    <div class="sig-name">Fernando Ruiz</div>
    <div class="sig-title">${t.sigTitle}</div>
  </div>
</div>
</body>
</html>
`.trim();
}

// -- Handler
export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // getDb() antes de getAuth() — garante que initializeApp() rode antes
  // de getApps()[0] ser acessado. Sem isso, getApps() = [] e getAuth(undefined)
  // lança exceção que se manifesta como 401 "Invalid token" falso.
  const db = getDb();

  // Verificação do token Firebase Auth
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };
  try {
    const decoded = await getAuth(getApp()).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  try {
    const { leadId, sections, coachNotes } = JSON.parse(event.body);
    if (!leadId || !sections) {
      return { statusCode: 400, body: "leadId e sections obrigatórios" };
    }

    // db já inicializado acima

    // Get lead
    const leadDoc = await db.collection("leads").doc(leadId).get();
    if (!leadDoc.exists) return { statusCode: 404, body: "Lead não encontrado" };
    const lead = leadDoc.data() as Record<string, any>;

    // Generate unique token
    const token = randomBytes(16).toString("hex");

    const siteUrl = `${event.headers["x-forwarded-proto"] ?? "https"}://${event.headers["host"]}`;

    // Envio ANTES da escrita no Firestore: se a entrega falhar, o lead não
    // avança de estado e o admin pode repetir sem deixar documento órfão nem um
    // "avaliacao_enviada" que o atleta jamais conseguiria acessar.
    //
    // Configuração ausente RECUSA o envio (o módulo _mailer lança), em vez de
    // seguir adiante gravando — o comportamento anterior anulava, justamente
    // neste caminho, a garantia que o parágrafo acima descreve.
    // Idioma declarado na ficha ("pt-br" ou "en"). Qualquer outro valor cai no
    // português — a reserva segura, dado o perfil predominante da base.
    const idioma = lead.idioma === "en" ? "en" : "pt-br";

    const { id: evaluationEmailId } = await sendMail({
      to: lead.email,
      subject: idioma === "en"
        ? `${lead.nome.split(" ")[0]}, your strategic plan is ready - ELITE90 PRO`
        : `${lead.nome.split(" ")[0]}, seu planejamento estratégico está pronto - ELITE90 PRO`,
      html: buildEvaluationEmail(lead.nome, token, sections, siteUrl, idioma),
      // O cabeçalho referencia o emblema por "cid:"; sem este anexo o leitor
      // receberia um ícone de imagem quebrada.
      attachments: [emblemaAttachment()],
    });

    // Firestore writes only reach here if Resend accepted the email.
    const ninetyDaysFromNow = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await db.collection("avaliacoes").add({
      leadId,
      nome: lead.nome,
      email: lead.email,
      token,
      sections,
      coachNotes: coachNotes ?? "",
      content_s1: sections.s1 ?? "",
      createdAt: FieldValue.serverTimestamp(),
      sentAt: FieldValue.serverTimestamp(),
      expiresAt: ninetyDaysFromNow,
      resentCount: 0,
      emailId: evaluationEmailId,
      // Gravado aqui para que o reenvio não precise reler a ficha do lead.
      idioma,
    });

    // Update lead status
    await db.collection("leads").doc(leadId).update({
      status: "avaliacao_enviada",
      avaliacao_enviada: true,
      avaliacao_token: token,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, token }),
    };
  } catch (err: any) {
    console.error("send-evaluation error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message ?? "Erro interno" }),
    };
  }
};