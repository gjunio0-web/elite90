// ELITE 90 - submit-lead
// Netlify Function: recebe dados do formulário em JSON,
// salva no Firestore e dispara e-mail de confirmação via Resend.

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function getDb(): FirebaseFirestore.Firestore {
  if (!getApps().length) {
    let saEnv: string = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "{}").trim();
    let serviceAccount: any = null;
    
    try {
      // Remove aspas externas extras caso a plataforma de CI/CD tenha envelopado o JSON incorretamente
      if (saEnv.startsWith('"') && saEnv.endsWith('"')) saEnv = saEnv.slice(1, -1);
      if (saEnv.startsWith("'") && saEnv.endsWith("'")) saEnv = saEnv.slice(1, -1);
      
      // Parse primário e Fallback: tenta converter a string bruta diretamente para objeto.
      // Se a infraestrutura de CI/CD aplicar múltiplos invólucros, aciona a recuperação.
      try {
        serviceAccount = JSON.parse(saEnv);
      } catch (initialParseError) {
        // Fallback Cascata: tentativa de descompressão de escapes excessivos injetados pela host
        const unescapedEnv = saEnv.replace(/\\"/g, '"');
        serviceAccount = JSON.parse(unescapedEnv);
      }
      
      // Mutação Pós-Parse: Transforma as sequências de escape em quebras de linha reais
      // estritamente na chave criptográfica isolada, preservando a integridade do JSON original.
      if (serviceAccount && serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
    } catch (parseError: any) {
      console.error("FALHA CRÍTICA: FIREBASE_SERVICE_ACCOUNT_JSON inválido - verifique a variável de ambiente no Netlify.");
      throw new Error(`Erro no parse das credenciais do Firebase: ${saEnv ? parseError.message : "Variável vazia"}`);
    }

    if (!serviceAccount || !serviceAccount.private_key) {
      throw new Error("Erro na inicialização do Firebase: Objeto de credenciais ou private_key ausente.");
    }

    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: process.env.PUBLIC_FIREBASE_STORAGE_BUCKET ?? "elite90-c716b.firebasestorage.app",
    });
  }
  return getFirestore();
}

// Upload de fotos base64 para Firebase Storage via Admin SDK (sem CORS, sem restrições de bucket)
// Fotos salvas como privadas — acesso via Signed URL gerada no painel admin sob demanda.
async function uploadFotos(fotosB64: string[], uploadId: string): Promise<string[]> {
  // Nome do bucket passado explicitamente — evita resolução implícita via
  // app.options.storageBucket, que retornou "bucket does not exist" mesmo
  // com storageBucket configurado corretamente no initializeApp().
  const bucketName = process.env.PUBLIC_FIREBASE_STORAGE_BUCKET ?? "elite90-c716b.firebasestorage.app";
  const bucket = getStorage().bucket(bucketName);
  const paths: string[] = [];

  for (let i = 0; i < fotosB64.length; i++) {
    const b64 = fotosB64[i];
    const buffer = Buffer.from(b64, "base64");
    const filePath = `leads/${uploadId}/foto-${i + 1}.webp`;
    const file = bucket.file(filePath);

    await file.save(buffer, {
      metadata: { contentType: "image/webp" },
      // Sem predefinedAcl: arquivo permanece privado.
      // Acesso controlado via Signed URL gerada pelo painel admin.
    });

    // Salva o path do Storage, não uma URL pública.
    // A URL de acesso é gerada sob demanda em fichas.astro com expiração.
    paths.push(filePath);
  }

  return paths;
}

function buildEmail(nome: string, objetivo: string): string {
  const firstName = nome.split(" ")[0];
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Elite 90 - Ficha recebida</title>
<style>
  body{margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Arial,sans-serif;color:#CCCCCC;}
  .wrap{max-width:600px;margin:0 auto;padding:40px 24px;}
  .logo{font-size:28px;font-weight:900;letter-spacing:.08em;color:#A6C300;text-transform:uppercase;margin-bottom:4px;}
  .tagline{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#666;margin-bottom:40px;}
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
    É com essa informação que começo a análise.
  </p>
  <div class="steps">
    <p><strong style="color:#fff;">O que acontece agora:</strong></p>
    <p>- Sua ficha está em análise.</p>
    <p>- Em até 48 horas você receberá um contato para agendar a entrevista de aprovação.</p>
    <p>- A entrevista é por vídeo e dura aproximadamente 30 minutos.</p>
  </div>
  <p class="scarcity">Vagas limitadas por ciclo. Aprovação sujeita à triagem.</p>
  <div class="sig">
    <div class="sig-name">Fernando Ruiz</div>
    <div class="sig-title">Coach Ruiz | Elite 90</div>
  </div>
</div>
</body>
</html>`;
}

export const handler = async (event: any): Promise<{ statusCode: number; body: string }> => {
  // Recusa imediatamente requisições que violem o verbo do protocolo HTTP
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    let fields: Record<string, string> = {};
    const contentType = (event.headers["content-type"] ?? "").toLowerCase();

    // Extração unificada do corpo bruto (raw) tratando de forma limpa codificações Base64
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf-8")
      : event.body ?? "";

    // Parse condicional e transparente baseado no tipo de mídia recebida
    if (contentType.includes("application/json")) {
      fields = JSON.parse(rawBody);
    } else {
      fields = Object.fromEntries(new URLSearchParams(rawBody));
    }

    // Desestruturação limpa e segura com atribuição de valores padrão (fallbacks)
    const {
      nome = "", email = "", cpf = "",
      data_nascimento = "", altura = "", peso = "",
      objetivo = "", objetivo_outro = "",
      atividade_fisica = "", atividade_outra = "", tempo_atividade = "",
      frequencia_semanal = "", disponibilidade_diaria = "",
      personal_trainer = "",
      competicao = "", competicao_detalhe = "",
      conhece_coach = "", medico_esporte = "",
      trt = "", trt_detalhe = "",
      condicao_cardiaca = "", diabetes = "",
      doenca_cronica = "", lesao = "", lesao_detalhe = "",
      dieta = "", refeicoes_dia = "",
      suplementos = "", suplementos_detalhe = "",
      agua_litros = "",
      consentimento_saude = "",
      fotos_urls = [],
      fotos_upload_id = "",
      fotos_b64 = [],
    } = fields;

    // Barreira síncrona primária contra dados vazios ou corrompidos
    if (!nome?.trim() || !email?.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "nome e email são campos obrigatórios" }),
      };
    }

    // Consolidação de campos abertos customizados do formulário
    const objetivoFinal = objetivo === "Outro" || objetivo === "Other"
      ? objetivo_outro
      : objetivo;

    // Upload de fotos para Firebase Storage via Admin SDK (server-side, sem CORS)
    // getDb() deve ser chamado ANTES de uploadFotos para garantir que initializeApp()
    // rode antes de getStorage() ser acessado.
    const db = getDb();
    const uploadId = fotos_upload_id || `${Date.now()}-srv`;
    let fotosUrlsFinal: string[] = Array.isArray(fotos_urls) ? fotos_urls : [];
    if (Array.isArray(fotos_b64) && fotos_b64.length > 0) {
      try {
        fotosUrlsFinal = await uploadFotos(fotos_b64, uploadId);
      } catch (uploadErr: any) {
        console.error("[submit-lead] Erro no upload de fotos:", uploadErr?.message ?? uploadErr);
        // Não bloqueia o envio da ficha — fotos ficam vazias
        fotosUrlsFinal = [];
      }
    }

    // Escrita atômica e definitiva na coleção de destino do Firebase Firestore
    const docRef = await db.collection("leads").add({
      nome:                nome.trim(),
      email:               email.trim().toLowerCase(),
      cpf,
      data_nascimento,
      altura,
      peso,
      objetivo:            objetivoFinal,
      atividade_fisica,
      atividade_outra,
      tempo_atividade,
      frequencia_semanal,
      disponibilidade_diaria,
      personal_trainer,
      competicao,
      competicao_detalhe,
      conhece_coach,
      medico_esporte,
      trt,
      trt_detalhe,
      condicao_cardiaca,
      diabetes,
      doenca_cronica,
      lesao,
      lesao_detalhe,
      dieta,
      refeicoes_dia,
      suplementos,
      suplementos_detalhe,
      agua_litros,
      status:              "novo",
      createdAt:           FieldValue.serverTimestamp(),
      avaliacao_enviada:   false,
      consentimento_saude:           consentimento_saude === "on" || consentimento_saude === "true",
      consentimento_saude_timestamp: FieldValue.serverTimestamp(),
      fotos_paths:         fotosUrlsFinal,  // paths no Storage, acesso via Signed URL
      fotos_upload_id:     uploadId,
    });

    // Disparo assíncrono e isolado de e-mail através da API do Resend (Global Fetch)
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      // Uso do escopo global explicitando a chamada de rede não-bloqueante
      globalThis.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: "Coach Ruiz <contato@coachruiz.com.br>",
          to: [email.trim()],
          subject: `${nome.split(" ")[0]}, sua ficha foi recebida - Elite 90`,
          html: buildEmail(nome, objetivoFinal),
        }),
      }).catch(e => console.error("Erro na API do Resend (não-fatal):", e));
    }

    // Calcula o score de triagem antes de responder ao candidato.
    // Aguardado para garantir execução em ambiente serverless (fire-and-forget
    // é cancelado pelo Lambda antes de concluir quando o handler retorna).
    const siteUrl        = process.env.URL ?? "http://localhost:8888";
    const functionSecret = process.env.FUNCTION_SECRET ?? "";
    try {
      await globalThis.fetch(`${siteUrl}/.netlify/functions/generate-triage-score`, {
        method: "POST",
        headers: {
          "Content-Type":      "application/json",
          "X-Function-Secret": functionSecret || "internal-call",
        },
        body: JSON.stringify({ leadId: docRef.id }),
      });
    } catch (e) {
      console.warn("[submit-lead] Score de triagem falhou (não-fatal):", e);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, id: docRef.id }),
    };

  } catch (err: any) {
    console.error("Erro interno no processamento do lead:", err?.message ?? err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err?.message ?? "Erro interno de processamento",
        hint: "Verifique os logs da função no painel do Netlify em Functions > submit-lead.",
      }),
    };
  }
};