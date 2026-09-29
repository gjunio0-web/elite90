// ELITE90 PRO · ler-checkins
// -----------------------------------------------------------------------------
// Netlify Function: reads the two most recent weekly check-ins of one athlete
// for the Coach's Check-in tab — M2 Phase 4 (persistence plan v5.23; schema v3,
// section 6). Replaces the panel's direct read of `athlete.checkin` and
// `athlete.prev` (gap 3.1).
//
// WHO CALLS IT
// The Coach (`admin` claim) only. The Check-in tab is exclusive to the Coach;
// the delegated professional's projection does not include it.
//
// CONTRACT
//   POST, `Authorization: Bearer <admin ID token>`, { athleteUid }
//   200 { ok, athleteUid, checkins: [atual, anterior] }   (0, 1 or 2 items,
//        newest first; an empty list is the honest empty state)
//   each item: { week, cycleWeek, submittedAt, measurements, perception,
//                photos, coachResponse: { text, respondedAt } | null,
//                peso: { measuredOn, weightKg } | null }
//   400 malformed   401 no/invalid token   403 not admin   404 athlete not found
//
// THE "PESO" OF A CHECK-IN (F4-7)
// The check-in carries no weight (F4-4). The tile shows the point of the daily
// series on the civil date of the submission (America/Sao_Paulo), or the last
// one before it — read here, from `weights/`, never copied into the check-in.
//
// ALLOW-LIST PROJECTION. `respondedBy`, `declaredAt`, `lastIdempotencyKey` and
// `_test` do not leave the function: no screen needs them.
//
// NO TRACEABILITY EVENT: reading is not a fact to preserve.
// -----------------------------------------------------------------------------

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldPath, Timestamp } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { validarUid, dataCivilReferencia } from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_CHECKINS = "checkins";
const SUBCOLECAO_PESOS = "weights";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

const numeroOuNulo = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : null);

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

    // Same query shape as the write transaction; index `checkins · __name__ DESC`.
    const snap = await refAtleta
      .collection(SUBCOLECAO_CHECKINS)
      .orderBy("__name__", "desc")
      .limit(2)
      .get();

    const checkins = await Promise.all(
      snap.docs.map(async (d) => {
        const submittedAt = d.get("submittedAt");
        const m = d.get("measurements") ?? {};
        const r = d.get("coachResponse");

        // F4-7: weight point on or before the submission's civil date. Uses the
        // weights index (`__name__ DESC`) declared in Phase 3.
        let peso: { measuredOn: string; weightKg: number } | null = null;
        if (submittedAt instanceof Timestamp) {
          const dia = dataCivilReferencia(submittedAt.toDate());
          const sp = await refAtleta
            .collection(SUBCOLECAO_PESOS)
            .where(FieldPath.documentId(), "<=", dia)
            .orderBy(FieldPath.documentId(), "desc")
            .limit(1)
            .get();
          const kg = sp.empty ? null : numeroOuNulo(sp.docs[0].get("weightKg"));
          if (kg !== null) peso = { measuredOn: sp.docs[0].id, weightKg: kg };
        }

        return {
          week: d.id,
          cycleWeek: numeroOuNulo(d.get("cycleWeek")),
          submittedAt: iso(submittedAt),
          measurements: {
            waistCm: numeroOuNulo(m.waistCm),
            hipCm: numeroOuNulo(m.hipCm),
            armCm: numeroOuNulo(m.armCm),
            chestCm: numeroOuNulo(m.chestCm),
          },
          perception: typeof d.get("perception") === "string" ? d.get("perception") : null,
          photos: Array.isArray(d.get("photos"))
            ? (d.get("photos") as unknown[]).filter((p): p is string => typeof p === "string")
            : [],
          coachResponse:
            r && typeof r.text === "string"
              ? { text: r.text, respondedAt: iso(r.respondedAt) }
              : null,
          peso,
        };
      }),
    );

    return json(200, { ok: true, athleteUid, checkins });
  } catch (e: any) {
    console.error("[ler-checkins]", e?.stack ?? e);
    return json(500, { erro: "Falha ao ler os check-ins." });
  }
};
