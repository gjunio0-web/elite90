// --- ELITE90 PRO · send-evaluation
// Netlify Function: salva o documento de avaliação no Firestore,
// gera token único, cria a página /avaliacao/{token} e envia por e-mail.

import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getApp, getDb } from "./_firebase";
import { randomBytes } from "crypto";
import { sendMail } from "./_mailer";


function buildEvaluationEmail(
  nome: string,
  token: string,
  sections: Record<string, string>,
  siteUrl: string
): string {
  const firstName = nome.split(" ")[0];
  const pageUrl = `${siteUrl}/avaliacao/${token}`;

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ELITE90 PRO - Sua Avaliação</title>
<style>
  body{margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Arial,sans-serif;color:#CCCCCC;}
  .wrap{max-width:600px;margin:0 auto;padding:40px 24px;}
  .logo{font-size:28px;font-weight:900;letter-spacing:.08em;color:#A6C300;text-transform:uppercase;margin-bottom:4px;}
  .tagline{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#666;margin-bottom:40px;}
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
  <div class="logo">Coach Ruiz</div>
  <div class="tagline">Estrategista em Alta Performance</div>

  <h1>${firstName}, seu planejamento estratégico está pronto.</h1>

  <p>
    Analisei sua ficha com atenção. Com base no que você me enviou, 
    preparei suas <span class="highlight">Diretrizes de Preparação e Planejamento Estratégico do Físico</span>.
  </p>

  <p>
    Este é o ponto de partida. O documento abaixo contém minha análise completa 
    e os próximos passos para construir o físico que você merece.
  </p>

  <div class="section-preview">
    <div class="section-title">Prévia - Diagnóstico</div>
    ${(sections.s1 ?? "").slice(0, 300)}${sections.s1?.length > 300 ? "..." : ""}
  </div>

  <div class="cta-wrap">
    <a href="${pageUrl}" class="cta">Acessar meu planejamento completo</a>
  </div>

  <p style="font-size:13px;color:#666;text-align:center;">
    Ou acesse diretamente: <a href="${pageUrl}" style="color:#A6C300;">${pageUrl}</a>
  </p>

  <div class="sig">
    <div class="sig-name">Fernando Ruiz</div>
    <div class="sig-title">Coach Ruiz · ELITE90 PRO</div>
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
    const { id: evaluationEmailId } = await sendMail({
      to: lead.email,
      subject: `${lead.nome.split(" ")[0]}, seu planejamento estratégico está pronto - ELITE90 PRO`,
      html: buildEvaluationEmail(lead.nome, token, sections, siteUrl),
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