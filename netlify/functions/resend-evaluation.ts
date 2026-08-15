// --- ELITE90 PRO · resend-evaluation
// Netlify Function: reenvia o e-mail de acesso a uma avaliação já enviada.
// Usa subject e corpo diferenciados para não criar falsa expectativa de novo conteúdo.
// Registra lastResentAt e incrementa resentCount no documento do Firestore.

import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getApp, getDb } from "./_firebase";
import { sendMail } from "./_mailer";


function buildResendEmail(nome: string, token: string, siteUrl: string): string {
  const firstName = nome.split(" ")[0];
  const pageUrl = `${siteUrl}/avaliacao/${token}`;

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ELITE90 PRO - Acesso à sua avaliação</title>
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
  .notice{background:#121212;border-left:3px solid #444;padding:14px 18px;border-radius:0 6px 6px 0;margin:20px 0;font-size:13px;line-height:1.6;color:#888;}
  .sig{margin-top:40px;padding-top:24px;border-top:1px solid #1a1a1a;}
  .sig-name{font-size:16px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:.06em;}
  .sig-title{font-size:11px;color:#A6C300;letter-spacing:.15em;text-transform:uppercase;margin-top:4px;}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">Coach Ruiz</div>
  <div class="tagline">Estrategista em Alta Performance</div>

  <h1>${firstName}, segue o acesso à sua avaliação.</h1>

  <p>
    Conforme solicitado, reenviamos o link de acesso às suas
    <span class="highlight">Diretrizes de Preparação e Planejamento Estratégico do Físico</span>.
  </p>

  <div class="notice">
    Este é o mesmo documento já preparado pelo Coach Ruiz — o conteúdo não foi alterado.
  </div>

  <div class="cta-wrap">
    <a href="${pageUrl}" class="cta">Acessar meu planejamento</a>
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

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const db = getDb();

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
    const { evalId } = JSON.parse(event.body);
    if (!evalId) return { statusCode: 400, body: "evalId obrigatório" };

    const evalDoc = await db.collection("avaliacoes").doc(evalId).get();
    if (!evalDoc.exists) return { statusCode: 404, body: "Avaliação não encontrada" };

    const avaliacao = evalDoc.data() as Record<string, any>;

    // Bloqueia reenvio de avaliações expiradas
    if (avaliacao.expiresAt) {
      const exp: Date = avaliacao.expiresAt.toDate
        ? avaliacao.expiresAt.toDate()
        : new Date(avaliacao.expiresAt._seconds * 1000);
      if (exp < new Date()) {
        return { statusCode: 410, body: JSON.stringify({ error: "Esta avaliação expirou e não pode ser reenviada." }) };
      }
    }

    const siteUrl = `${event.headers["x-forwarded-proto"] ?? "https"}://${event.headers["host"]}`;

    // Configuração ausente lança e cai no catch abaixo (resposta 500), mantendo
    // o comportamento que esta função já tinha: nunca registrar reenvio sem envio.
    const { id: resentEmailId } = await sendMail({
      to: avaliacao.email,
      subject: `${avaliacao.nome.split(" ")[0]}, segue o acesso à sua avaliação — ELITE90 PRO`,
      html: buildResendEmail(avaliacao.nome, avaliacao.token, siteUrl),
    });

    await db.collection("avaliacoes").doc(evalId).update({
      lastResentAt: FieldValue.serverTimestamp(),
      resentCount: FieldValue.increment(1),
      lastResentEmailId: resentEmailId,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err: any) {
    console.error("resend-evaluation error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message ?? "Erro interno" }),
    };
  }
};
