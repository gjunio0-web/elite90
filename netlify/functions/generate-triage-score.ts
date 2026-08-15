// ELITE90 PRO · generate-triage-score
// Netlify Function: calcula o score de triagem automático (0–100) de um lead.
// Aceita dois modos de autenticação:
//   • Interno (function-to-function): header X-Function-Secret == FUNCTION_SECRET
//   • Manual (painel admin): Firebase ID token com custom claim admin:true

import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { getApp, getDb } from "./_firebase";
import { calcularScoreBase, ajusteIA, classificarPrioridade } from "./_scoring";


export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const db = getDb();

  const functionSecret = process.env.FUNCTION_SECRET ?? "";
  const callerSecret   = event.headers["x-function-secret"] ?? "";
  // Segredo AUSENTE no ambiente RECUSA a chamada interna — nunca autoriza.
  // A versao anterior tratava functionSecret.length === 0 como permissao: sem a
  // variavel definida, qualquer requisicao com um cabecalho x-function-secret
  // nao vazio passava como chamada interna e contornava a checagem de admin.
  const isInternalCall = functionSecret.length > 0 && callerSecret === functionSecret;

  if (!isInternalCall) {
    const authHeader = event.headers["authorization"] ?? "";
    const idToken = authHeader.replace("Bearer ", "").trim();
    if (!idToken) return { statusCode: 401, body: "Unauthorized" };
    try {
      const decoded = await getAuth(getApp()).verifyIdToken(idToken);
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
