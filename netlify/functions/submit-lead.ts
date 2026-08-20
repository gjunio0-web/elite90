// ELITE90 PRO - submit-lead
// Netlify Function: recebe dados do formulário em JSON,
// salva no Firestore e dispara e-mail de confirmação via Resend.

import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getDb, storageBucketName } from "./_firebase";
import { calcularScoreBase, ajusteIA, classificarPrioridade } from "./_scoring";
import { sendMail } from "./_mailer";
import { EMAIL_BASE_CSS, emailHeader, emblemaAttachment } from "./_email-header";


// Upload de fotos base64 para Firebase Storage via Admin SDK (sem CORS, sem restrições de bucket)
// Fotos salvas como privadas — acesso via Signed URL gerada no painel admin sob demanda.
async function uploadFotos(fotosB64: string[], uploadId: string): Promise<string[]> {
  // Nome do bucket passado explicitamente — evita resolução implícita via
  // app.options.storageBucket, que retornou "bucket does not exist" mesmo
  // com storageBucket configurado corretamente no initializeApp().
  const bucketName = storageBucketName();
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

// Textos por idioma. A estrutura visual é única — só o conteúdo muda, para que
// um ajuste de estilo não precise ser feito duas vezes e sair divergente.
function buildEmail(nome: string, objetivo: string, idioma: string): string {
  const firstName = nome.split(" ")[0];
  const en = idioma === "en";
  const t = en ? {
    lang: "en",
    title: "ELITE90 PRO - Application received",
    tagline: "High Performance Strategist",
    h1: `${firstName}, we received your application.`,
    p1a: `You completed the screening form for the`,
    program: "ELITE90 PRO Program",
    p1b: `Most people think about this for months. You did it today.`,
    goalLabel: "Stated goal:",
    goalFallback: "not provided",
    p2b: "That is where my analysis begins.",
    stepsTitle: "What happens now:",
    step1: "- Your application is under review.",
    step2: "- Within 2 business days you will be contacted to schedule the approval interview.",
    step3: "- The interview is by video and takes about 30 minutes.",
    scarcity: "Limited spots per cycle. Approval subject to screening.",
    sigTitle: "Coach Ruiz | ELITE90 PRO",
  } : {
    lang: "pt-BR",
    title: "ELITE90 PRO - Ficha recebida",
    tagline: "Estrategista em Alta Performance",
    h1: `${firstName}, sua ficha foi recebida.`,
    p1a: "Você preencheu a ficha de triagem do",
    program: "Programa ELITE90 PRO",
    p1b: "Isso já diz algo sobre você - a maioria continua procrastinando. Você agiu.",
    goalLabel: "Objetivo declarado:",
    goalFallback: "não informado",
    p2b: "É com essa informação que começo a análise.",
    stepsTitle: "O que acontece agora:",
    step1: "- Sua ficha está em análise.",
    step2: "- Em até 48 horas úteis você receberá um contato para agendar a entrevista de aprovação.",
    step3: "- A entrevista é por vídeo e dura aproximadamente 30 minutos.",
    scarcity: "Vagas limitadas por ciclo. Aprovação sujeita à triagem.",
    sigTitle: "Coach Ruiz | ELITE90 PRO",
  };
  return `<!DOCTYPE html>
<html lang="${t.lang}">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${t.title}</title>
<style>
${EMAIL_BASE_CSS}
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
${emailHeader(t.tagline)}
  <h1>${t.h1}</h1>
  <p>
    ${t.p1a} <span class="highlight">${t.program}</span>.
    ${t.p1b}
  </p>
  <p>
    ${t.goalLabel} <span class="highlight">${objetivo || t.goalFallback}</span>. 
    ${t.p2b}
  </p>
  <div class="steps">
    <p><strong style="color:#fff;">${t.stepsTitle}</strong></p>
    <p>${t.step1}</p>
    <p>${t.step2}</p>
    <p>${t.step3}</p>
  </div>
  <p class="scarcity">${t.scarcity}</p>
  <div class="sig">
    <div class="sig-name">Fernando Ruiz</div>
    <div class="sig-title">${t.sigTitle}</div>
  </div>
</div>
</body>
</html>`;
}

// Aviso ao Coach de que uma ficha nova entrou.
//
// Sempre em português: o destinatário é o Coach, não o candidato. O idioma da
// ficha entra como informação dentro da mensagem, nunca como língua dela.
//
// CONTEÚDO DELIBERADAMENTE MÍNIMO. A mensagem NÃO carrega nenhum dado de
// saúde — condição cardíaca, diabetes, doença crônica, lesão, reposição
// hormonal. E-mail não é canal seguro: fica retido em servidores do provedor
// e em cópias locais por tempo indeterminado, e esses são exatamente os dados
// que o consentimento do formulário promete tratar com finalidade restrita.
// Das bandeiras de risco, só a CONTAGEM viaja ("2 alertas clínicos"), sem
// dizer quais — o suficiente para o Coach saber que a ficha merece atenção,
// insuficiente para reconstituir o quadro clínico de alguém a partir do
// e-mail. O detalhe está no painel, atrás de autenticação, que é onde deve
// estar. O aviso serve para chamar o Coach até lá, não para substituí-lo.
function buildCoachNotification(
  nome: string,
  objetivo: string,
  idioma: string,
  score: number | null,
  prioridade: string | null,
  alertas: number,
  painelUrl: string
): string {
  const idiomaLabel = idioma === "en" ? "Inglês" : "Português";
  const scoreLinha = score !== null
    ? `${score}/100${prioridade ? ` &middot; prioridade ${prioridade}` : ""}`
    : "não calculada (ver painel)";
  const alertasLinha = alertas > 0
    ? `${alertas} alerta${alertas > 1 ? "s" : ""} clínico${alertas > 1 ? "s" : ""}`
    : "nenhum alerta clínico";
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ELITE90 PRO - Ficha nova</title>
<style>
${EMAIL_BASE_CSS}
  h1{font-size:22px;font-weight:700;color:#FFFFFF;text-transform:uppercase;letter-spacing:.04em;margin:0 0 16px;}
  p{font-size:15px;line-height:1.7;margin:0 0 16px;}
  .card{background:#121212;border-left:3px solid #A6C300;padding:20px 24px;border-radius:0 6px 6px 0;margin:24px 0;}
  .card p{margin:0 0 8px;font-size:14px;}
  .card p:last-child{margin:0;}
  .k{color:#666;text-transform:uppercase;letter-spacing:.1em;font-size:11px;}
  .v{color:#FFFFFF;font-weight:700;}
  .cta{display:inline-block;background:#A6C300;color:#0D0D0D;text-decoration:none;font-weight:700;
       text-transform:uppercase;letter-spacing:.08em;font-size:13px;padding:14px 28px;border-radius:6px;margin-top:8px;}
  .nota{font-size:12px;color:#666;margin-top:32px;line-height:1.6;}
</style>
</head>
<body>
<div class="wrap">
${emailHeader("ELITE90 PRO &middot; Aviso interno")}
  <h1>Ficha nova na triagem</h1>
  <p>Uma ficha acabou de entrar e está aguardando análise no painel.</p>
  <div class="card">
    <p><span class="k">Candidato</span><br/><span class="v">${nome}</span></p>
    <p><span class="k">Objetivo declarado</span><br/><span class="v">${objetivo || "não informado"}</span></p>
    <p><span class="k">Idioma da ficha</span><br/><span class="v">${idiomaLabel}</span></p>
    <p><span class="k">Nota de triagem</span><br/><span class="v">${scoreLinha}</span></p>
    <p><span class="k">Sinalizações</span><br/><span class="v">${alertasLinha}</span></p>
  </div>
  <a class="cta" href="${painelUrl}">Abrir o painel</a>
  <p class="nota">
    Este aviso traz apenas o necessário para decidir se a ficha exige atenção agora.
    Os dados de saúde, o contato e as fotos ficam no painel, com acesso autenticado.
  </p>
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
      nome = "", email = "",
      documento = "", documento_tipo = "cpf", idioma = "pt-br",
      celular = "",
      data_nascimento = "", altura = "", peso = "",
      objetivo = "", objetivo_outro = "",
      atividade_fisica = "", atividade_outra = "", tempo_atividade = "",
      frequencia_semanal = "", disponibilidade_diaria = "",
      personal_trainer = "",
      competicao = "", competicao_detalhe = "",
      conhece_coach = "", medico_esporte = "",
      trt = "", trt_detalhe = "",
      condicao_cardiaca = "", condicao_cardiaca_detalhe = "",
      diabetes = "",
      doenca_cronica = "", doenca_cronica_detalhe = "",
      lesao = "", lesao_detalhe = "",
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
      // Documento: CPF na versão pt-BR, documento estrangeiro livre na versão em inglês.
      // O tipo acompanha o valor para que o painel saiba o que está exibindo.
      documento:           documento.trim(),
      documento_tipo,
      celular:             celular.trim(),
      idioma,
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
      condicao_cardiaca_detalhe,
      diabetes,
      doenca_cronica,
      doenca_cronica_detalhe,
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

    // Confirmação ao candidato — envio AGUARDADO, falha não-fatal.
    // O envio precisa ser aguardado porque o ambiente de execução da função é
    // congelado quando o handler retorna: uma requisição em voo nesse instante
    // pode não completar, e o candidato nunca recebe a confirmação — sem erro
    // visível em lugar nenhum. É a mesma razão pela qual o score de triagem
    // deixou de ser um salto HTTP entre funções (ver bloco abaixo).
    // A falha continua sendo não-fatal: a ficha já está gravada e o visitante
    // recebe sucesso de qualquer forma.
    let confirmationEmailId: string | null = null;
    try {
      const { id } = await sendMail({
        to: email.trim(),
        subject: idioma === "en"
          ? `${nome.split(" ")[0]}, we received your application - ELITE90 PRO`
          : `${nome.split(" ")[0]}, sua ficha foi recebida - ELITE90 PRO`,
        html: buildEmail(nome, objetivoFinal, idioma),
        // O cabeçalho referencia o emblema por "cid:"; sem este anexo o leitor
        // receberia um ícone de imagem quebrada.
        attachments: [emblemaAttachment()],
      });
      confirmationEmailId = id;
    } catch (mailErr: any) {
      console.error("[submit-lead] Falha no e-mail de confirmação (não-fatal):",
        mailErr?.message ?? mailErr);
    }

    // Identificador devolvido pelo Resend — sem ele, "não recebi o e-mail" não
    // tem investigação possível no painel do provedor.
    if (confirmationEmailId) {
      try {
        await db.collection("leads").doc(docRef.id).update({
          confirmation_email_id: confirmationEmailId,
        });
      } catch (idErr: any) {
        console.warn("[submit-lead] Falha ao registrar o id do e-mail (não-fatal):",
          idErr?.message ?? idErr);
      }
    }

    // Calcula o score de triagem inline — evita o HTTP hop entre funções Lambda,
    // que é cancelado pelo runtime antes de concluir quando o handler retorna.
    const leadParaScore: Record<string, any> = {
      data_nascimento, objetivo: objetivoFinal, objetivo_outro,
      atividade_fisica, tempo_atividade, frequencia_semanal, disponibilidade_diaria,
      personal_trainer, competicao, competicao_detalhe, conhece_coach,
      medico_esporte, trt, trt_detalhe, condicao_cardiaca, condicao_cardiaca_detalhe,
      diabetes, doenca_cronica, doenca_cronica_detalhe, lesao, lesao_detalhe, dieta, refeicoes_dia,
      suplementos, suplementos_detalhe, agua_litros,
    };
    // Declarados FORA do try porque o aviso ao Coach (abaixo) os consome. Se o
    // cálculo falhar, permanecem nulos e o aviso sai assim mesmo, dizendo que a
    // nota não foi calculada — a chegada da ficha é a informação essencial, e
    // ela não pode depender do sucesso de um passo acessório.
    let scoreParaAviso: number | null = null;
    let prioridadeParaAviso: string | null = null;
    let alertasClinicos = 0;
    try {
      const { base, flags }           = calcularScoreBase(leadParaScore);
      const { ajuste, justificativa } = await ajusteIA(leadParaScore);
      const scoreFinal  = Math.max(0, Math.min(100, base + ajuste));
      const prioridade  = classificarPrioridade(scoreFinal);
      scoreParaAviso      = scoreFinal;
      prioridadeParaAviso = prioridade;
      // RISCO_MULTIPLO é derivada — existe quando já há duas outras bandeiras.
      // Contá-la inflaria o número e faria duas condições virarem "3 alertas".
      alertasClinicos     = flags.filter(f => f !== "RISCO_MULTIPLO").length;
      await db.collection("leads").doc(docRef.id).update({
        score:               scoreFinal,
        score_base:          base,
        score_ajuste_ia:     ajuste,
        prioridade,
        score_flags:         flags,
        score_justificativa: justificativa,
        score_gerado_em:     FieldValue.serverTimestamp(),
      });
    } catch (scoreErr: any) {
      console.warn("[submit-lead] Score de triagem falhou (não-fatal):", scoreErr.message);
    }

    // Aviso ao Coach — depois da nota, para que a mensagem já a carregue.
    //
    // A AUSÊNCIA de COACH_NOTIFICATION_EMAIL DESLIGA o aviso e não faz mais
    // nada: é comportamento deliberado, para que um ambiente sem essa
    // configuração continue aceitando fichas normalmente. Note a diferença em
    // relação a RESEND_FROM, cuja ausência RECUSA o envio: ali a variável
    // define COMO se envia e um valor de reserva reintroduziria o padrão de
    // "configuração ausente vale como autorização"; aqui ela define SE existe
    // destinatário, e sem destinatário não há o que enviar.
    //
    // Falha não-fatal, como os demais envios: a ficha já está gravada e o
    // visitante já recebeu sucesso. O erro fica nos registros da função.
    const coachEmail = process.env.COACH_NOTIFICATION_EMAIL?.trim();
    if (coachEmail) {
      try {
        const siteUrl = `${event.headers["x-forwarded-proto"] ?? "https"}://${event.headers["host"]}`;
        await sendMail({
          to: coachEmail,
          subject: `Ficha nova - ${nome.trim()} - ELITE90 PRO`,
          html: buildCoachNotification(
            nome.trim(), objetivoFinal, idioma,
            scoreParaAviso, prioridadeParaAviso, alertasClinicos,
            `${siteUrl}/admin/login`
          ),
          // O cabeçalho referencia o emblema por "cid:"; sem este anexo o leitor
          // receberia um ícone de imagem quebrada.
          attachments: [emblemaAttachment()],
        });
      } catch (coachErr: any) {
        console.error("[submit-lead] Falha no aviso ao Coach (não-fatal):",
          coachErr?.message ?? coachErr);
      }
    } else {
      console.info("[submit-lead] COACH_NOTIFICATION_EMAIL ausente — aviso ao Coach desligado.");
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