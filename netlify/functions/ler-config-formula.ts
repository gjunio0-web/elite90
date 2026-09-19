// ELITE90 PRO · ler-config-formula
// Netlify Function: AF-07 do Adendo 03 — leitura de `config/nutritionFormula`
// por função de servidor. O navegador não lê o documento diretamente
// (firestore.rules recusa; ver o bloco de `config/`).
//
// POR QUE A LEITURA TAMBÉM PASSA POR FUNÇÃO, E NÃO SÓ A ESCRITA
// O Adendo 02 já estabelece que o profissional delegado não lê o banco
// diretamente. Manter a leitura da fórmula atrás de função evita reabrir
// esta decisão quando o M4 chegar — o mesmo raciocínio do Adendo 03, §5.1.

import { getAuth } from "firebase-admin/auth";
import { getApp, getDb } from "./_firebase";
import { garantirFormulaConfig } from "./_formula-nutricional";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  try {
    const config = await garantirFormulaConfig(getDb());
    return json(200, {
      phases: config.phases,
      updatedAt: (config.updatedAt as any)?.toDate ? (config.updatedAt as any).toDate().toISOString() : null,
      updatedBy: config.updatedBy ?? null,
    });
  } catch (e: any) {
    const msg = e?.message ?? "erro desconhecido";
    return json(500, { erro: "Não foi possível ler a configuração da fórmula agora — " + msg });
  }
};
