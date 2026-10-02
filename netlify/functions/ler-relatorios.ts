// ELITE90 PRO · ler-relatorios
// -----------------------------------------------------------------------------
// Netlify Function: reads the weekly evolution reports of one athlete for the
// Coach's Evolução tab — M2 Phase 6 (persistence plan v5.26; schema v3,
// section 9). Replaces the invented reports of the tab (gap 3.14).
//
// WHO CALLS IT
// The Coach (`admin` claim) only.
//
// CONTRACT
//   POST, `Authorization: Bearer <admin ID token>`, { athleteUid }
//   200 { ok, athleteUid, semanaCorrente, relatorios: [...] }
//        semanaCorrente: the cycle week now, by the same rule the writing
//          functions use (server clock, Brasília, NOT clamped: 0 before the
//          start, 14 or more after the cycle), or null without a start date.
//          The panel takes the ruler from here, so it never disagrees with
//          what the server accepts (O9).
//        relatorios: oldest first, at most 13 — an empty list is the honest
//          empty state. Each: { week, cycleWeek, status, diagnosis,
//          trainingAdjustments, nutritionAdjustments, causalLinks, generatedBy,
//          temGeracaoOriginal, publishedAt, updatedAt }
//   400 malformed   401 no/invalid token   403 not admin   404 athlete not found
//
// ALLOW-LIST PROJECTION. `publishedBy`, `lastIdempotencyKey`, `_test` and the
// content of `aiOriginalDraft` do not leave the function; `temGeracaoOriginal`
// only says whether an AI original exists, for the editor's "Ver geração
// original" control, which stays disabled while it is false (O13). The
// structured layer is empty in this phase and has no screen yet.
//
// NO TRACEABILITY EVENT: reading is not a fact to preserve.
// -----------------------------------------------------------------------------

import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import {
  validarUid,
  dataCivilDoInicio,
  dataCivilReferencia,
  semanaDoCiclo,
} from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_RELATORIOS = "weeklyReports";
const MAX_RELATORIOS = 13;

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

const numeroOuNulo = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const textoOuNulo = (v: unknown) => (typeof v === "string" ? v : null);
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

  const { athleteUid } = corpo ?? {};
  const vUid = validarUid(athleteUid);
  if (!vUid.ok) return json(400, { erro: vUid.erro });

  const db = getFirestore(app);

  try {
    const refAtleta = db.collection(COLECAO_ATLETAS).doc(athleteUid);
    const snapAtleta = await refAtleta.get();
    if (!snapAtleta.exists) return json(404, { erro: "Atleta não encontrado." });

    const inicio = dataCivilDoInicio(snapAtleta.get("startDate"));
    const semanaCorrente = inicio ? semanaDoCiclo(inicio, dataCivilReferencia(new Date())) : null;

    const snap = await refAtleta
      .collection(SUBCOLECAO_RELATORIOS)
      .orderBy("__name__", "asc")
      .limit(MAX_RELATORIOS)
      .get();

    const relatorios = snap.docs.map((d) => ({
      week: d.id,
      cycleWeek: numeroOuNulo(d.get("cycleWeek")),
      status: d.get("status") === "published" ? "published" : "draft",
      diagnosis: textoOuNulo(d.get("diagnosis")),
      trainingAdjustments: textoOuNulo(d.get("trainingAdjustments")),
      nutritionAdjustments: textoOuNulo(d.get("nutritionAdjustments")),
      causalLinks: textoOuNulo(d.get("causalLinks")),
      generatedBy: textoOuNulo(d.get("generatedBy")),
      temGeracaoOriginal: d.get("aiOriginalDraft") != null,
      publishedAt: iso(d.get("publishedAt")),
      updatedAt: iso(d.get("updatedAt")),
    }));

    return json(200, { ok: true, athleteUid, semanaCorrente, relatorios });
  } catch (e: any) {
    console.error("[ler-relatorios]", e?.stack ?? e);
    return json(500, { erro: "Falha ao ler os relatórios." });
  }
};
