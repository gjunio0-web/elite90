// ELITE 90 · generate-triage-score
// Netlify Function: calcula o score de triagem automático (0–100) de um lead.
// Aceita dois modos de autenticação:
//   • Interno (function-to-function): header X-Function-Secret == FUNCTION_SECRET
//   • Manual (painel admin): Firebase ID token com custom claim admin:true

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function getDb() {
  if (!getApps().length) {
    let saEnv: string = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "{}").trim();
    let serviceAccount: any = null;
    try {
      if (saEnv.startsWith('"') && saEnv.endsWith('"')) saEnv = saEnv.slice(1, -1);
      if (saEnv.startsWith("'") && saEnv.endsWith("'")) saEnv = saEnv.slice(1, -1);
      try {
        serviceAccount = JSON.parse(saEnv);
      } catch {
        serviceAccount = JSON.parse(saEnv.replace(/\\"/g, '"'));
      }
      if (serviceAccount?.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
      }
    } catch (e: any) {
      throw new Error(`Erro no parse das credenciais do Firebase: ${e.message}`);
    }
    if (!serviceAccount?.private_key) throw new Error("Credenciais do Firebase ausentes.");
    initializeApp({
      credential: cert(serviceAccount as any),
      storageBucket: process.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
  }
  return getFirestore();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcularIdade(dataNascimento: string): number | null {
  const m = dataNascimento.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const nasc = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (isNaN(nasc.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const diff = hoje.getMonth() - nasc.getMonth();
  if (diff < 0 || (diff === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

function num(v: any, fallback = 0): number {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return isNaN(n) ? fallback : n;
}

function isAfirmativo(v: any): boolean {
  return ["sim", "SIM", "Sim", "yes", "YES"].includes(String(v ?? "").trim());
}

// Retorna true quando o valor indica uma condição real (não vazio nem "nenhuma")
function indicaCondicao(v: any): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s !== "" && s !== "nenhuma" && s !== "não" && s !== "nao" && s !== "no";
}

// ── Dimensão 1 — Alinhamento Demográfico (0–15 pts) ─────────────────────────

function d1_demografico(lead: Record<string, any>): number {
  const idade = calcularIdade(lead.data_nascimento ?? "");
  if (idade === null) return 5; // neutro quando data ausente ou inválida
  if (idade >= 35 && idade <= 55) return 15;
  if ((idade >= 28 && idade <= 34) || (idade >= 56 && idade <= 62)) return 8;
  return 0;
}

// ── Dimensão 2 — Alinhamento de Objetivo (0–20 pts) ─────────────────────────

function d2_objetivo(lead: Record<string, any>): number {
  const obj = String(lead.objetivo ?? "").toLowerCase();
  if (obj.includes("competição") || obj.includes("competicao") || obj.includes("competi")) return 20;
  if (obj.includes("massa") || obj.includes("bulking")) return 16;
  if (obj.includes("defin") || obj.includes("gordura") || obj.includes("cutting")) return 12;
  if (obj.includes("performance") || obj.includes("longevidade")) return 8;
  if (obj.includes("saúde") || obj.includes("saude") || obj.includes("qualidade")) return 4;
  return 6; // "Outro" ou não informado — a IA ajustará com base no texto livre
}

// ── Dimensão 3 — Maturidade de Treino (0–20 pts) ────────────────────────────

function d3_maturidade(lead: Record<string, any>): number {
  let pts = 0;

  // Modalidade (0–8)
  const ativ = String(lead.atividade_fisica ?? "").toLowerCase();
  if (ativ.includes("musculação") || ativ.includes("musculacao")) pts += 8;
  else if (ativ.includes("cross") || ativ.includes("funcional") || ativ.includes("powerlifting")) pts += 5;
  else if (ativ.length > 0) pts += 2;

  // Experiência em anos (0–8)
  const anos = num(lead.tempo_atividade);
  if (anos > 5) pts += 8;
  else if (anos >= 2) pts += 5;
  else if (anos >= 1) pts += 2;

  // Frequência semanal (0–4)
  const freq = num(lead.frequencia_semanal);
  if (freq >= 5) pts += 4;
  else if (freq >= 4) pts += 3;
  else if (freq >= 3) pts += 1;

  return pts;
}

// ── Dimensão 4 — Comprometimento e Disciplina (0–20 pts) ────────────────────

function d4_comprometimento(lead: Record<string, any>): number {
  let pts = 0;

  // Dieta (0–5)
  const dieta = String(lead.dieta ?? "").toLowerCase();
  if (dieta.includes("acompanhamento") || dieta.includes("profissional")) pts += 5;
  else if (dieta.includes("sim") || dieta.includes("segue") || dieta.includes("própria") || dieta.includes("propria")) pts += 3;

  // Suplementação (0–3)
  if (isAfirmativo(lead.suplementos)) pts += 3;

  // Disponibilidade diária em horas (0–4)
  const disp = num(lead.disponibilidade_diaria);
  if (disp >= 2) pts += 4;
  else if (disp >= 1.5) pts += 3;
  else if (disp >= 1) pts += 2;

  // Refeições por dia (0–4)
  const ref = num(lead.refeicoes_dia);
  if (ref >= 5) pts += 4;
  else if (ref >= 4) pts += 2;

  // Consumo de água em litros (0–4)
  const agua = num(lead.agua_litros);
  if (agua >= 4) pts += 4;
  else if (agua >= 2.5) pts += 2;

  return pts;
}

// ── Dimensão 5 — Motivação e Canal de Entrada (0–15 pts, teto 15) ───────────

function d5_motivacao(lead: Record<string, any>): number {
  let pts = 0;
  if (isAfirmativo(lead.competicao))      pts += 8; // já competiu
  if (isAfirmativo(lead.conhece_coach))   pts += 5; // chegou por canal de autoridade
  if (isAfirmativo(lead.medico_esporte))  pts += 4; // já investe em infraestrutura clínica
  if (isAfirmativo(lead.personal_trainer)) pts += 2; // já paga por orientação
  return Math.min(pts, 15);
}

// ── Dimensão 6 — Fatores de Risco (descontos + flags) ───────────────────────

function d6_riscos(lead: Record<string, any>): { desconto: number; flags: string[] } {
  let desconto = 0;
  const flags: string[] = [];

  if (indicaCondicao(lead.condicao_cardiaca)) {
    desconto += 8;
    flags.push("CARDIO");
  }
  if (isAfirmativo(lead.diabetes)) {
    desconto += 5;
    if (!flags.includes("SAUDE")) flags.push("SAUDE");
  }
  if (indicaCondicao(lead.doenca_cronica)) {
    desconto += 5;
    if (!flags.includes("SAUDE")) flags.push("SAUDE");
  }
  if (isAfirmativo(lead.lesao)) {
    desconto += 3;
    flags.push("LESAO");
  }
  // TRT sem médico de esporte = risco clínico não gerenciado
  if (isAfirmativo(lead.trt) && !isAfirmativo(lead.medico_esporte)) {
    desconto += 5;
    flags.push("TRT_SEM_MEDICO");
  }
  if (flags.length >= 2) flags.push("RISCO_MULTIPLO");

  return { desconto, flags };
}

// ── Score base determinístico ────────────────────────────────────────────────

function calcularScoreBase(lead: Record<string, any>): { base: number; flags: string[] } {
  const demo  = d1_demografico(lead);
  const obj   = d2_objetivo(lead);
  const matur = d3_maturidade(lead);
  const comp  = d4_comprometimento(lead);
  const motiv = d5_motivacao(lead);
  const { desconto, flags } = d6_riscos(lead);

  const bruto = demo + obj + matur + comp + motiv - desconto;
  const base  = Math.max(0, Math.min(90, bruto));
  return { base, flags };
}

// ── Ajuste qualitativo via Gemini (-10 a +10) ────────────────────────────────

async function ajusteIA(lead: Record<string, any>): Promise<{ ajuste: number; justificativa: string }> {
  const geminiKey = process.env.GOOGLE_GEMINI_KEY;
  if (!geminiKey) return { ajuste: 0, justificativa: "GOOGLE_GEMINI_KEY não configurada." };

  const camposTexto = [
    lead.objetivo_outro      ? `Objetivo (texto livre): ${lead.objetivo_outro}` : null,
    lead.trt_detalhe         ? `Detalhe TRT: ${lead.trt_detalhe}` : null,
    lead.competicao_detalhe  ? `Detalhe competição: ${lead.competicao_detalhe}` : null,
    lead.lesao_detalhe       ? `Detalhe lesão: ${lead.lesao_detalhe}` : null,
    lead.suplementos_detalhe ? `Detalhe suplementação: ${lead.suplementos_detalhe}` : null,
  ].filter(Boolean) as string[];

  if (camposTexto.length === 0) {
    return { ajuste: 0, justificativa: "Sem campos de texto livre para análise qualitativa." };
  }

  const prompt = `Você é um assistente de triagem do Coach Ruiz, especialista em fisiculturismo de alto nível.

Analise os campos abaixo de um candidato ao Programa Elite 90 e retorne um ajuste de pontuação entre -10 e +10, acompanhado de uma justificativa objetiva de até 2 linhas.

Critérios de ajuste POSITIVO: protocolo de TRT detalhado e clinicamente coerente, histórico competitivo relevante (Classic Physique, Men's Physique ou categorias similares), stack de suplementação sofisticado, lesão resolvida com tratamento documentado.

Critérios de ajuste NEGATIVO: protocolo de TRT vago ou incoerente (risco clínico não gerenciado), objetivo "Outro" incompatível com a metodologia Elite 90, lesão grave recente sem indicação de tratamento, suplementação inexistente apesar de declarar SIM.

CAMPOS PARA ANÁLISE:
${camposTexto.join("\n")}

Retorne JSON estrito: {"ajuste": número_inteiro_entre_-10_e_10, "justificativa": "texto de até 2 linhas"}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 256,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                ajuste:        { type: "INTEGER" },
                justificativa: { type: "STRING"  },
              },
              required: ["ajuste", "justificativa"],
            },
          },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const parsed = JSON.parse(raw);
    const ajuste = Math.max(-10, Math.min(10, Number(parsed.ajuste ?? 0)));
    return { ajuste, justificativa: String(parsed.justificativa ?? "") };
  } catch (e: any) {
    console.warn("[generate-triage-score] Ajuste IA falhou (não-fatal):", e.message);
    return { ajuste: 0, justificativa: "Ajuste qualitativo indisponível." };
  }
}

// ── Prioridade ───────────────────────────────────────────────────────────────

function classificarPrioridade(score: number): "alta" | "media" | "baixa" | "fora_do_perfil" {
  if (score >= 80) return "alta";
  if (score >= 60) return "media";
  if (score >= 40) return "baixa";
  return "fora_do_perfil";
}

// ── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const db = getDb();

  // Autenticação dupla: secret interno (submit-lead) ou token Firebase admin (painel)
  const functionSecret = process.env.FUNCTION_SECRET ?? "";
  const callerSecret   = event.headers["x-function-secret"] ?? "";
  // Aceita chamada interna se: segredo confere (quando configurado) OU
  // FUNCTION_SECRET não está configurada e o caller enviou qualquer header não vazio.
  const isInternalCall = callerSecret.length > 0 &&
                         (functionSecret.length === 0 || callerSecret === functionSecret);

  if (!isInternalCall) {
    const authHeader = event.headers["authorization"] ?? "";
    const idToken = authHeader.replace("Bearer ", "").trim();
    if (!idToken) return { statusCode: 401, body: "Unauthorized" };
    try {
      const decoded = await getAuth(getApps()[0]).verifyIdToken(idToken);
      if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    } catch {
      return { statusCode: 401, body: "Invalid token" };
    }
  }

  try {
    const { leadId } = JSON.parse(event.body ?? "{}");
    if (!leadId) return { statusCode: 400, body: "leadId obrigatório" };

    const leadDoc = await db.collection("leads").doc(leadId).get();
    if (!leadDoc.exists) return { statusCode: 404, body: "Lead não encontrado" };
    const lead = leadDoc.data() as Record<string, any>;

    const { base, flags }         = calcularScoreBase(lead);
    const { ajuste, justificativa } = await ajusteIA(lead);
    const scoreFinal = Math.max(0, Math.min(100, base + ajuste));
    const prioridade = classificarPrioridade(scoreFinal);

    await db.collection("leads").doc(leadId).update({
      score:               scoreFinal,
      score_base:          base,
      score_ajuste_ia:     ajuste,
      prioridade,
      score_flags:         flags,
      score_justificativa: justificativa,
      score_gerado_em:     FieldValue.serverTimestamp(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success:         true,
        score:           scoreFinal,
        score_base:      base,
        score_ajuste_ia: ajuste,
        prioridade,
        flags,
        justificativa,
      }),
    };
  } catch (err: any) {
    console.error("[generate-triage-score] Erro:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message ?? "Erro interno" }),
    };
  }
};
