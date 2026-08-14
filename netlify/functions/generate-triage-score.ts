// ELITE 90 PRO · generate-triage-score
// Netlify Function: calcula o score de triagem automático (0–100) de um lead.
// Aceita dois modos de autenticação:
//   • Interno (function-to-function): header X-Function-Secret == FUNCTION_SECRET
//   • Manual (painel admin): Firebase ID token com custom claim admin:true

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { calcularScoreBase, ajusteIA, classificarPrioridade } from "./_scoring";

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

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const db = getDb();

  const functionSecret = process.env.FUNCTION_SECRET ?? "";
  const callerSecret   = event.headers["x-function-secret"] ?? "";
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

    const { base, flags }           = calcularScoreBase(lead);
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
      body: JSON.stringify({ success: true, score: scoreFinal, score_base: base,
        score_ajuste_ia: ajuste, prioridade, flags, justificativa }),
    };
  } catch (err: any) {
    console.error("[generate-triage-score] Erro:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message ?? "Erro interno" }),
    };
  }
};
