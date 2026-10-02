// ELITE90 PRO · ler-avaliacoes-fisicas
// -----------------------------------------------------------------------------
// Netlify Function: reads every physical evaluation of one athlete for the
// Coach's Avaliação and Evolução tabs — M2 Phase 6 (persistence plan v5.26;
// schema v3, section 10). Replaces the panel's read of `athlete.avaliacao`
// (gap 3.13) and the invented history table (gap 3.14).
//
// WHO CALLS IT
// The Coach (`admin` claim) only. The delegated professional's projection does
// not include these tabs.
//
// CONTRACT
//   POST, `Authorization: Bearer <admin ID token>`, { athleteUid }
//   200 { ok, athleteUid, avaliacoes: [...] }   (oldest first, at most 7 — the
//        odd weeks 1 to 13; an empty list is the honest empty state)
//   each item: { week, cycleWeek, measuredAt, submittedAt, measuredBy,
//                perimeters, skinfolds | null, peso: { measuredOn, weightKg } | null }
//   400 malformed   401 no/invalid token   403 not admin   404 athlete not found
//
// THE WEIGHT OF AN EVALUATION (O11, same rule as F4-7)
// The evaluation carries no weight. The history table shows the point of the
// daily series on the civil date of the measurement (America/Sao_Paulo), or the
// last one before it — read here, from `weights/`, never copied.
//
// ALLOW-LIST PROJECTION. `lastIdempotencyKey` and `_test` do not leave the
// function: no screen needs them.
//
// NO TRACEABILITY EVENT: reading is not a fact to preserve.
// -----------------------------------------------------------------------------

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldPath, Timestamp } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { validarUid, dataCivilReferencia, SEMANAS_DE_AVALIACAO } from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_AVALIACOES = "evaluations";
const SUBCOLECAO_PESOS = "weights";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

const numeroOuNulo = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : null);

/** Copies only numeric values of a stored measurement map. */
function mapaNumerico(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const saida: Record<string, number> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const n = numeroOuNulo(x);
    if (n !== null) saida[k] = n;
  }
  return saida;
}

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

  const { athleteUid } = corpo ?? {};
  const vUid = validarUid(athleteUid);
  if (!vUid.ok) return json(400, { erro: vUid.erro });

  const db = getFirestore(app);

  try {
    const refAtleta = db.collection(COLECAO_ATLETAS).doc(athleteUid);
    const snapAtleta = await refAtleta.get();
    if (!snapAtleta.exists) return json(404, { erro: "Atleta não encontrado." });

    // At most seven documents exist (the odd weeks); the limit is a guard.
    const snap = await refAtleta
      .collection(SUBCOLECAO_AVALIACOES)
      .orderBy("__name__", "asc")
      .limit(SEMANAS_DE_AVALIACAO.length)
      .get();

    const avaliacoes = await Promise.all(
      snap.docs.map(async (d) => {
        const medidoEm = d.get("measuredAt");
        const mb = d.get("measuredBy");

        let peso: { measuredOn: string; weightKg: number } | null = null;
        if (medidoEm instanceof Timestamp) {
          const dia = dataCivilReferencia(medidoEm.toDate());
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
          measuredAt: iso(medidoEm),
          submittedAt: iso(d.get("submittedAt")),
          measuredBy:
            mb && typeof mb === "object"
              ? {
                  type: mb.type === "professional" || mb.type === "self" ? mb.type : null,
                  sameAsPrevious: typeof mb.sameAsPrevious === "boolean" ? mb.sameAsPrevious : null,
                }
              : null,
          perimeters: mapaNumerico(d.get("perimeters")),
          skinfolds: mapaNumerico(d.get("skinfolds")),
          peso,
        };
      }),
    );

    return json(200, { ok: true, athleteUid, avaliacoes });
  } catch (e: any) {
    console.error("[ler-avaliacoes-fisicas]", e?.stack ?? e);
    return json(500, { erro: "Falha ao ler as avaliações físicas." });
  }
};
