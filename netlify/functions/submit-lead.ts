// --- ELITE 90 · submit-lead --------------------------------------------------
// Netlify Function: recebe o formulário de triagem, salva no Firestore,
// dispara e-mail automático de confirmação via Resend.

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// -- Firebase Admin init ----------------------------------------------------
function getDb() {
  if (!getApps().length) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "{}"
    );
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

// -- E-mail template --------------------------------------------------------
function buildEmail(nome: string, objetivo: string): string {
  const firstName = nome.split(" ")[0];
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Elite 90 - Ficha recebida</title>
<style>
  body{margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Arial,sans-serif;color:#CCCCCC;}
  .wrap{max-width:600px;margin:0 auto;padding:40px 24px;}
  .logo{font-family:Arial,sans-serif;font-size:28px;font-weight:900;letter-spacing:.08em;color:#A6C300;text-transform:uppercase;margin-bottom:4px;}
  .tagline{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#666;margin-bottom:40px;}
  .divider{height:1px;background:linear-gradient(to right,transparent,#A6C300,transparent);margin:32px 0;opacity:.3;}
  h1{font-size:22px;font-weight:700;color:#FFFFFF;text-transform:uppercase;letter-spacing:.04em;margin:0 0 16px;}
  p{font-size:15px;line-height:1.7;margin:0 0 16px;}
  .highlight{color:#A6C300;font-weight:700;}
  .steps{background:#121212;border-left:3px solid #A6C300;padding:20px 24px;border-radius:0 6px 6px 0;margin:24px 0;}
  .steps p{margin:0 0 8px;font-size:14px;}
  .steps p:last-child{margin:0;}
  .scarcity{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#666;margin-top:32px;}
  .sig{margin-top:40px;padding-top:24px;border-top:1px solid #1a1a1a;}
  .sig-name{font-size:16px;font-weight:700;color:#FFFFFF;text-transform:uppercase;letter-spacing:.06em;}
  .sig-title{font-size:11px;color:#A6C300;letter-spacing:.15em;text-transform:uppercase;margin-top:4px;}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">Coach Ruiz</div>
  <div class="tagline">Estrategista em Alta Performance</div>

  <h1>${firstName}, sua ficha foi recebida.</h1>

  <p>
    Você preencheu a ficha de triagem do <span class="highlight">Programa Elite 90</span>.
    Isso já diz algo sobre você - a maioria continua procrastinando. Você agiu.
  </p>

  <p>
    Objetivo declarado: <span class="highlight">${objetivo || "não informado"}</span>.
    É com essa informação que começa a análise.
  </p>

  <div class="steps">
    <p><strong style="color:#fff;">O que acontece agora:</strong></p>
    <p>→ Sua ficha está em análise.</p>
    <p>→ Em até 48 horas você receberá um contato para agendar a entrevista de aprovação.</p>
    <p>→ A entrevista é por vídeo e dura aproximadamente 30 minutos.</p>
  </div>

  <p class="scarcity">
    Vagas limitadas por ciclo. Aprovação sujeita à triagem.
  </p>

  <div class="sig">
    <div class="sig-name">Fernando Ruiz</div>
    <div class="sig-title">Coach Ruiz · Elite 90</div>
  </div>
</div>
</body>
</html>
`.trim();
}

// -- Handler ----------------------------------------------------------------
export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Parse multipart form data
    // Netlify Functions receive multipart as base64 body - use busboy or parse manually
    // For simplicity, we parse URL-encoded; file uploads handled separately via Firebase Storage
    let fields: Record<string, string> = {};

    const contentType = event.headers["content-type"] ?? "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf-8")
        : event.body;
      fields = Object.fromEntries(new URLSearchParams(body));
    } else if (contentType.includes("application/json")) {
      fields = JSON.parse(event.body);
    } else {
      // Multipart: parse manually (basic implementation without file upload for Sprint 1)
      const body = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf-8")
        : event.body;

      // Extract text fields from multipart
      const boundary = contentType.split("boundary=")[1];
      if (boundary) {
        const parts = body.split(`--${boundary}`);
        for (const part of parts) {
          const match = part.match(/name="([^"]+)"\r?\n\r?\n([\s\S]*?)(?:\r?\n)?$/);
          if (match && match[1] !== "fotos") {
            fields[match[1]] = match[2].trim();
          }
        }
      }
    }

    const {
      nome = "", email = "", objetivo = "", cpf = "",
      data_nascimento = "", altura = "", peso = "",
      atividade_fisica = "", frequencia_semanal = "",
      disponibilidade_diaria = "", personal_trainer = "",
      competicao = "", competicao_detalhe = "",
      conhece_coach = "", medico_esporte = "",
      trt = "", trt_detalhe = "",
      condicao_cardiaca = "", diabetes = "",
      doenca_cronica = "", lesao = "", lesao_detalhe = "",
      dieta = "", refeicoes_dia = "", suplementos = "",
      suplementos_detalhe = "", agua_litros = "",
    } = fields;

    if (!nome || !email) {
      return { statusCode: 400, body: "Campos obrigatórios ausentes" };
    }

    // -- Save to Firestore ----------------------------------------------------
    const db = getDb();
    const docRef = await db.collection("leads").add({
      // Dados pessoais
      nome, email, cpf, data_nascimento, altura, peso,
      // Imersão
      objetivo, atividade_fisica, frequencia_semanal,
      disponibilidade_diaria, personal_trainer,
      competicao, competicao_detalhe,
      conhece_coach, medico_esporte,
      trt, trt_detalhe,
      // Saúde
      condicao_cardiaca, diabetes, doenca_cronica,
      lesao, lesao_detalhe,
      // Alimentação
      dieta, refeicoes_dia, suplementos,
      suplementos_detalhe, agua_litros,
      // Metadata
      status: "novo",
      createdAt: FieldValue.serverTimestamp(),
      avaliacao_enviada: false,
    });

    // -- Send confirmation email via Resend -----------------------------------
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: "Coach Ruiz <contato@coachruiz.com.br>",
          to: [email],
          subject: `${nome.split(" ")[0]}, sua ficha foi recebida - Elite 90`,
          html: buildEmail(nome, objetivo),
        }),
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, id: docRef.id }),
    };
  } catch (err: any) {
    console.error("submit-lead error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message ?? "Erro interno" }),
    };
  }
};
