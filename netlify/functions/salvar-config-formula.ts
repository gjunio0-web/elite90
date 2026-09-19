// ELITE90 PRO · salvar-config-formula
// Netlify Function: escrita de `config/nutritionFormula` — o painel de
// "Configurar fórmula de macros" passa a gravar aqui, em vez de
// `localStorage` (Adendo 03, §3 e CF-10).
//
// SÓ O COACH. A configuração é "da casa" (AF-05): não há campo de
// coeficiente no cadastro profissional, e delegado nenhum grava aqui.

import { getAuth } from "firebase-admin/auth";
import { getApp, getDb } from "./_firebase";
import { validarCoeficientesFormula, camposAtualizacao, COLECAO_CONFIG, DOC_FORMULA } from "./_formula-nutricional";

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

  let uid: string;
  let email: string | null;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    uid = decoded.uid;
    email = decoded.email ?? null;
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo inválido." });
  }

  const validado = validarCoeficientesFormula(corpo.phases);
  if (!validado.ok) return json(400, { erro: validado.erro });

  try {
    const db = getDb();
    await db.collection(COLECAO_CONFIG).doc(DOC_FORMULA).set(
      { phases: validado.phases, ...camposAtualizacao(uid, email), _test: process.env.CONTEXT !== "production" },
      { merge: true },
    );
    return json(200, { ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "erro desconhecido";
    return json(500, { erro: "Não foi possível salvar a configuração agora — " + msg });
  }
};
