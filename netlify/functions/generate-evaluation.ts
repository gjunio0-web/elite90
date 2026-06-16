// --- ELITE 90 · generate-evaluation
// Netlify Function: gera rascunho do documento de avaliação via Gemini 2.5 Flash.
// Chamada pelo painel admin ao clicar em "Gerar avaliação".

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function getDb() {
  if (!getApps().length) {
    let saEnv: string = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "{}").trim();
    let serviceAccount: any = null;

    try {
      // Remove aspas externas caso o CI/CD tenha envelopado o JSON
      if (saEnv.startsWith('"') && saEnv.endsWith('"')) saEnv = saEnv.slice(1, -1);
      if (saEnv.startsWith("'") && saEnv.endsWith("'")) saEnv = saEnv.slice(1, -1);

      // Parse direto — o JSON.parse já interpreta \n escapado corretamente.
      // NÃO substituir \n antes do parse: transforma JSON válido em inválido.
      try {
        serviceAccount = JSON.parse(saEnv);
      } catch {
        // Fallback: escapes duplos injetados pelo CI/CD
        serviceAccount = JSON.parse(saEnv.replace(/\\"/g, '"'));
      }

      // Após o parse, garante quebras de linha reais no private_key
      if (serviceAccount?.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
    } catch (e: any) {
      console.error("FALHA CRÍTICA (generate-evaluation): FIREBASE_SERVICE_ACCOUNT_JSON inválido.");
      throw new Error(`Erro no parse das credenciais do Firebase: ${e.message}`);
    }

    if (!serviceAccount?.private_key) {
      throw new Error("Credenciais do Firebase ausentes ou incompletas.");
    }

    initializeApp({ credential: cert(serviceAccount as any) });
  }
  return getFirestore();
}

// -- Referência do documento avaliacao_elite90.html (estrutura e tom)
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
Cada seção deve ter 2-4 parágrafos densos e específicos.
`;

// -- Build prompt from lead data
function buildPrompt(lead: Record<string, any>, previousDocs: string[]): string {
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

INSTRUÇÕES:
- Gere o documento completo com as 5 seções numeradas
- Seja específico aos dados do atleta - não genérico
- Use linguagem técnica do fisiculturismo
- Onde os dados forem insuficientes para uma seção, sinalize com [COMPLETAR] para o coach revisar
- Responda APENAS com o conteúdo das 5 seções, em formato JSON com esta estrutura:
{
  "s1": "conteúdo da seção 01",
  "s2": "conteúdo da seção 02",
  "s3": "conteúdo da seção 03",
  "s4": "conteúdo da seção 04",
  "s5": "conteúdo da seção 05"
}`;
}

// -- Handler
export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // getDb() deve ser chamado antes de getAuth() — é ele quem garante
  // que initializeApp() rode. getAuth(getApps()[0]) com app ainda não
  // inicializado retorna undefined e lança exceção, causando 401 falso.
  const db = getDb();

  // Verificação do token Firebase Auth
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };
  try {
    await getAuth(getApps()[0]).verifyIdToken(idToken);
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  try {
    const { leadId } = JSON.parse(event.body);
    if (!leadId) return { statusCode: 400, body: "leadId obrigatório" };

    // db já inicializado acima

    // Fetch lead data
    const leadDoc = await db.collection("leads").doc(leadId).get();
    if (!leadDoc.exists) return { statusCode: 404, body: "Lead não encontrado" };
    const lead = leadDoc.data() as Record<string, any>;

    // Fetch previous evaluation docs for style calibration (Nivel 2)
    const prevSnap = await db.collection("avaliacoes")
      .orderBy("createdAt", "desc")
      .limit(3)
      .get();
    const previousDocs = prevSnap.docs.map(d => d.data().content_s1 ?? "");

    // Call Gemini 2.5 Flash
    const geminiKey = process.env.GOOGLE_GEMINI_KEY;
    if (!geminiKey) {
      return { statusCode: 500, body: "GOOGLE_GEMINI_KEY não configurada" };
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: buildPrompt(lead, previousDocs) }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
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

    // Parse JSON response
    let sections: Record<string, string>;
    try {
      const clean = rawText.replace(/```json|```/g, "").trim();
      sections = JSON.parse(clean);
    } catch {
      // Fallback: return raw text in s1
      sections = { s1: rawText, s2: "", s3: "", s4: "", s5: "" };
    }

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