// ELITE90 PRO · ler-serie-peso
// -----------------------------------------------------------------------------
// Netlify Function: reads the daily weight series of one athlete for the
// Coach's panel — M2 Phase 3 (persistence plan; schema v3, section 7).
//
// WHO CALLS IT
// The Coach (`admin` claim) only. Reading by a delegated professional is
// allowed by Addendum 02 (level 1 lists `weights`), but it is a separate item:
// in this phase /profissional keeps the empty skeleton (owner decision,
// 25/09/2026).
//
// CONTRACT
//   POST, `Authorization: Bearer <admin ID token>`, { athleteUid }
//   200 { ok, athleteUid, weightInitialKg, weightCurrentKg,
//         pontos: [{ measuredOn, weightKg, mma7, n7 }], truncado }
//   400 malformed   401 no/invalid token   403 not admin   404 athlete not found
// POST, like every M2 read (see the header of ler-rascunho-plano.ts).
//
// THE WHOLE SERIES, ONCE
// A cycle has about 91 points. Sending all of them lets the panel switch
// between 30, 60 and 90 days without another call. The ceiling below guards
// against an unexpected volume; `truncado` says when it was hit, and then the
// OLDEST points are the ones left out (the panel shows recent periods).
//
// THE 7-DAY MOVING AVERAGE IS DERIVED HERE, NEVER STORED (schema §7, P3).
// Calendar window, with `n7` = how many points entered it — rules in
// _serie-peso.js.
//
// ALLOW-LIST PROJECTION. Only `measuredOn` and `weightKg` leave each document;
// `recordedAt`, `source`, `ocrRawValue`, `lastIdempotencyKey` and `_test` do
// not, until a screen needs them and someone decides so.
//
// NO TRACEABILITY EVENT: reading is not a fact to preserve (same reasoning as
// ler-rascunho-plano.ts).
// -----------------------------------------------------------------------------

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { validarUid, calcularMediaMovel } from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_PESOS = "weights";
const TETO_PONTOS = 500;

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

const numeroOuNulo = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

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

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo inválido." });
  }

  const { athleteUid } = corpo;
  const vUid = validarUid(athleteUid);
  if (!vUid.ok) return json(400, { erro: vUid.erro });

  const db = getFirestore(app);

  try {
    const refAtleta = db.collection(COLECAO_ATLETAS).doc(athleteUid);
    const snapAtleta = await refAtleta.get();
    if (!snapAtleta.exists) return json(404, { erro: "Atleta não encontrado." });

    // Newest first, so a truncation drops the oldest points; reversed below.
    // Same query shape (and index) as the write transaction.
    const snap = await refAtleta
      .collection(SUBCOLECAO_PESOS)
      .orderBy("__name__", "desc")
      .limit(TETO_PONTOS + 1)
      .get();

    const truncado = snap.size > TETO_PONTOS;
    const brutos = snap.docs
      .slice(0, TETO_PONTOS)
      .map((d) => ({ measuredOn: d.id, weightKg: d.get("weightKg") }))
      .filter((p) => typeof p.weightKg === "number" && Number.isFinite(p.weightKg))
      .reverse();

    return json(200, {
      ok: true,
      athleteUid,
      weightInitialKg: numeroOuNulo(snapAtleta.get("weightInitialKg")),
      weightCurrentKg: numeroOuNulo(snapAtleta.get("weightCurrentKg")),
      pontos: calcularMediaMovel(brutos),
      truncado,
    });
  } catch (e: any) {
    console.error("[ler-serie-peso]", e?.stack ?? e);
    return json(500, { erro: "Falha ao ler a série de peso." });
  }
};
