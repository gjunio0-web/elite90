// --- ELITE90 PRO · generate-evaluation
// Netlify Function: gera rascunho do documento de avaliação via Gemini 2.5 Flash.
// Chamada pelo painel admin ao clicar em "Gerar avaliação".

import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getApp, getDb, storageBucketName } from "./_firebase";


async function downloadPhotosAsBase64(
  paths: string[]
): Promise<Array<{ mimeType: string; data: string }>> {
  if (!paths?.length) return [];
  // Nome do bucket passado explicitamente — a resolução implícita pelas opções
  // do app já devolveu "bucket does not exist" mesmo com o valor correto
  // configurado (ver _firebase.ts). Este era o último ponto de chamada do
  // projeto que ainda dependia da resolução implícita.
  const bucket = getStorage().bucket(storageBucketName());
  const results: Array<{ mimeType: string; data: string }> = [];
  for (const path of paths) {
    try {
      const [buffer] = await bucket.file(path).download();
      results.push({ mimeType: "image/webp", data: buffer.toString("base64") });
    } catch (e) {
      console.warn(`[generate-evaluation] Falha ao baixar foto ${path}:`, e);
    }
  }
  return results;
}

const REFERENCE_STRUCTURE = `
O documento de avaliação do Coach Ruiz tem 5 seções:

01. DIAGNÓSTICO ESTÉTICO E ANÁLISE DE PROPORÇÕES
    - Qualidade epidérmica e percentual de gordura
    - Simetria e densidade do tronco
    - Marcadores de resposta hormonal

02. PLANEJAMENTO DE TREINAMENTO E CARDIO
    - Estrutura semanal (musculação, abdominais, cardio)
    - Projeção de composição corporal em 30 dias

03. PROTOCOLO DE SAÚDE CARDIOVASCULAR E SUPORTE MITOCONDRIAL
    - Suporte ergogênico
    - Diretriz de conduta

04. ESTRATÉGIA DE COMPETIÇÃO E DIRECIONAMENTO DE CATEGORIA
    - Definição de categoria
    - Comportamento de palco e projeção
    - Alvo competitivo

05. ALINHAMENTO OPERACIONAL E DINÂMICA DE PARCERIA
    - Ajuste de planilha
    - Isolamento de variáveis na dieta
    - Observações finais

Tom: técnico, direto, linguagem de fisiculturismo de alto nível.
Evitar motivacional genérico. Usar terminologia específica (BF, AEJ, TRT, bulking, cutting, etc.).
O coach fala como estrategista biológico, não como personal trainer.
`;

function buildPrompt(lead: Record<string, any>, previousDocs: string[], hasPhotos: boolean = false): string {
  // O documento é redigido no idioma declarado na ficha. Sem isto, um lead
  // captado pela versão em inglês do site receberia um e-mail em inglês com
  // uma prévia em português — pior que o e-mail inteiro em português.
  const idiomaSaida = lead.idioma === "en"
    ? "\n- IDIOMA DE SAÍDA: redija TODO o conteúdo das 5 seções em INGLÊS. A terminologia técnica de fisiculturismo deve usar os termos correntes em inglês (body fat, fasted cardio, TRT, bulking, cutting). As instruções acima continuam em português; apenas o texto produzido muda de idioma."
    : "";
  const prevContext = previousDocs.length > 0
    ? `\n\nDOCUMENTOS ANTERIORES DO COACH (para calibrar o estilo):\n${previousDocs.slice(0, 3).join("\n---\n")}`
    : "";

  return `Você é o Coach Ruiz, estrategista em alta performance física. 
Redija um documento de Diretrizes de Preparação e Planejamento Estratégico do Físico para o atleta abaixo.

DADOS DO ATLETA:
- Nome: ${lead.nome}
- Idade aproximada: ${lead.data_nascimento ? `nascimento em ${lead.data_nascimento}` : "não informada"}
- Altura: ${lead.altura || "não informada"}
- Peso: ${lead.peso || "não informado"}
- Objetivo principal: ${lead.objetivo || "não informado"}
- Atividade física atual: ${lead.atividade_fisica || "não informada"}
- Frequência semanal pretendida: ${lead.frequencia_semanal || "não informada"}
- Disponibilidade diária: ${lead.disponibilidade_diaria || "não informada"}
- Treina com personal: ${lead.personal_trainer || "não informado"}
- Já competiu: ${lead.competicao || "não informado"}${lead.competicao_detalhe ? ` - ${lead.competicao_detalhe}` : ""}
- Conhece coach bodybuilding: ${lead.conhece_coach || "não informado"}
- Acompanhamento médico esporte: ${lead.medico_esporte || "não informado"}
- TRT: ${lead.trt || "não informado"}${lead.trt_detalhe ? ` - ${lead.trt_detalhe}` : ""}
- Condição cardíaca: ${lead.condicao_cardiaca || "nenhuma informada"}
- Diabetes: ${lead.diabetes || "não informado"}
- Doença crônica: ${lead.doenca_cronica || "nenhuma informada"}
- Lesão: ${lead.lesao || "não informado"}${lead.lesao_detalhe ? ` - ${lead.lesao_detalhe}` : ""}
- Dieta: ${lead.dieta || "não informada"}
- Refeições/dia: ${lead.refeicoes_dia || "não informado"}
- Suplementos: ${lead.suplementos || "não informado"}${lead.suplementos_detalhe ? ` - ${lead.suplementos_detalhe}` : ""}
- Água/dia: ${lead.agua_litros || "não informado"} litros

ESTRUTURA E TOM ESPERADOS:
${REFERENCE_STRUCTURE}
${prevContext}

INSTRUÇÕES DE PREENCHIMENTO CRÍTICAS:
- Cada seção deve ser resumida em apenas 1 parágrafo contínuo, extremamente denso, direto e focado nas condutas do atleta, sem enrolação.
- Use exclusivamente a linguagem técnica e a terminologia do fisiculturismo de alto nível.
- Onde os dados do atleta forem insuficientes para estruturar uma conduta, sinalize com [COMPLETAR] para que o coach revise manualmente depois.
- IMPORTANTE: Forneça apenas o texto corrido correspondente a cada seção. Não inclua títulos, não use blocos de código Markdown (\`\`\`) e não tente estruturar chaves ou sintaxe JSON manualmente.${idiomaSaida}
${hasPhotos ? `- As fotos do atleta estão incluídas nesta chamada como dados de imagem. Utilize-as para fundamentar a seção 01 (Diagnóstico Estético e Análise de Proporções): avalie qualidade epidérmica, percentual de gordura estimado visualmente, simetria muscular, densidade do tronco e marcadores visuais de resposta hormonal. Para as demais seções, baseie-se exclusivamente nos dados textuais acima.` : ""}
`;
}

// Função de reparação cirúrgica para JSONs truncados na exaustão de tokens
function tentarRepararJsonTruncado(rawText: string): Record<string, string> {
  let textoLimpo = rawText.trim();
  
  // Se o JSON já estiver completo, tenta dar o parse direto
  try {
    return JSON.parse(textoLimpo);
  } catch (e) {
    console.warn("[Lax Parser]: Detectada quebra de token de saída. Iniciando reparo cirúrgico...");
  }

  // Mapeia quais chaves existem no texto para reconstruir a estrutura de fechamento
  const chaves = ["\"s1\"", "\"s2\"", "\"s3\"", "\"s4\"", "\"s5\""];
  let ultimaChaveEncontrada = "";
  
  for (const chave of chaves) {
    if (textoLimpo.includes(chave)) {
      ultimaChaveEncontrada = chave.replace(/"/g, "");
    }
  }

  // Garante que o texto termine fechando as aspas da string cortada, a chave e o objeto externo
  if (textoLimpo.endsWith(",")) {
    textoLimpo = textoLimpo.slice(0, -1);
  }
  
  // Força o fechamento da string e do objeto dependendo de onde o corte ocorreu
  if (!textoLimpo.endsWith("\"}")) {
    if (textoLimpo.endsWith("\"")) {
      textoLimpo += "}";
    } else {
      textoLimpo += "\"}";
    }
  }

  try {
    const objetoReparado = JSON.parse(textoLimpo);
    
    // Preenche com string vazia as chaves que nem chegaram a ser abertas antes do corte
    const chavesObrigatorias = ["s1", "s2", "s3", "s4", "s5"];
    for (const k of chavesObrigatorias) {
      if (objetoReparado[k] === undefined) {
        objetoReparado[k] = "";
      }
    }
    return objetoReparado;
  } catch (erroSegundoParse) {
    // Fallback definitivo caso a quebra ocorra em ponto impossível de reconstrução por regex simples
    console.error("[Lax Parser]: Falha severa de truncamento. Acionando fallback padrão.");
    return { s1: rawText, s2: "", s3: "", s4: "", s5: "" };
  }
}

// -- Handler
export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

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
    const { leadId } = JSON.parse(event.body);
    if (!leadId) return { statusCode: 400, body: "leadId obrigatório" };

    // Fetch lead data
    const leadDoc = await db.collection("leads").doc(leadId).get();
    if (!leadDoc.exists) return { statusCode: 404, body: "Lead não encontrado" };
    const lead = leadDoc.data() as Record<string, any>;

    // Fetch previous evaluation docs for style calibration (Nivel 2)
    const prevSnap = await db.collection("avaliacoes")
      .orderBy("createdAt", "desc")
      .limit(3)
      .get();
    const previousDocs = prevSnap.docs.map((d: any) => d.data().content_s1 ?? "");

    // Download athlete photos for visual diagnosis (S1)
    const fotos = await downloadPhotosAsBase64(lead.fotos_paths ?? []);
    const parts: any[] = [
      { text: buildPrompt(lead, previousDocs, fotos.length > 0) },
      ...fotos.map(f => ({ inlineData: f })),
    ];

    // Call Gemini 2.5 Flash
    const geminiKey = process.env.GOOGLE_GEMINI_KEY;
    if (!geminiKey) {
      return { statusCode: 500, body: "GOOGLE_GEMINI_KEY não configurada" };
    }

    const schemaRigido = {
      type: "OBJECT",
      properties: {
        s1: { type: "STRING", description: "Texto do Diagnóstico Estético e Análise de Proporções" },
        s2: { type: "STRING", description: "Texto do Planejamento de Treinamento e Cardio" },
        s3: { type: "STRING", description: "Texto do Protocolo de Saúde Cardiovascular e Suporte Mitocondrial" },
        s4: { type: "STRING", description: "Texto do Estratégia de Competição e Direcionamento de Categoria" },
        s5: { type: "STRING", description: "Texto do Alinhamento Operacional e Dinâmica de Parceria" }
      },
      required: ["s1", "s2", "s3", "s4", "s5"]
    };

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
            responseSchema: schemaRigido
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      throw new Error(`Gemini error: ${err}`);
    }

    const geminiData = await geminiRes.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

    // Executa a estratégia de parsing tolerante a truncamento de tokens
    const sections = tentarRepararJsonTruncado(rawText);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, sections, leadName: lead.nome }),
    };
  } catch (err: any) {
    console.error("generate-evaluation error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message ?? "Erro interno" }),
    };
  }
};