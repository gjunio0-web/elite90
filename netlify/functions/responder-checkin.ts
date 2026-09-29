// ELITE90 PRO · responder-checkin
// -----------------------------------------------------------------------------
// Netlify Function: records or edits the Coach's response to one weekly
// check-in, in the same document — `athletes/{uid}/checkins/{wNN}.coachResponse`
// — M2 Phase 4 (persistence plan v5.23; schema v3, section 6).
//
// WHO CALLS IT
// The Coach (`admin` claim), from the "Resposta ao Atleta" section of the
// Check-in tab in /admin/atletas. It is the part of Phase 4 the Coach uses
// right away.
//
// CONTRACT
//   POST, `Authorization: Bearer <admin ID token>`
//   { athleteUid, week: "wNN", text, idempotencyKey? }
//   200 { ok, athleteUid, week, respondeu, editou, semAlteracao, respondedAt }
//   400 malformed   401 no/invalid token   403 not admin
//   404 athlete or week not found   405 method
//
// THE RESPONSE LIVES IN THE CHECK-IN (schema §6)
// It answers THAT check-in, so it is a map on the same document, not a
// collection of its own. `respondedBy` is `{ uid, role }` — no e-mail, no name
// (D-AS; Addendum 04, note to R1). The uid is enough to know who answered while
// the account exists; an e-mail would be a second place with personal data.
//
// EDITABLE (F4-10)
// A second call on the same week replaces the text and the moment
// (`respondedAt` is the time of the latest version). Sending exactly the stored
// text changes nothing and emits nothing — that is also what makes a resend
// from the panel harmless. Answering does not lock anything for the Coach; it
// locks the athlete's correction of that week (F4-3, in registrar-checkin.ts).
//
// TRACEABILITY (plan v5.23, Phase 4 contract)
// After the transaction, best-effort (DR-06): 'checkin.respondido' for the
// first response, 'checkin.resposta-corrigida' for an edit. Actor with the
// Coach's e-mail (DR-09). Target `{ colecao: "checkins", id: "<uid>/wNN" }`
// (D-AR; Addendum 04 §6.5, CE-10). No `detalhe`: the text is free text (R2).
// -----------------------------------------------------------------------------

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator } from "./_rastreabilidade";
import {
  validarUid,
  validarSemanaId,
  validarTexto,
  validarChaveIdempotencia,
} from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_CHECKINS = "checkins";
const ORIGEM = "responder-checkin";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

class NaoEncontrado extends Error {}

type Resultado = { respondeu: boolean; editou: boolean; semAlteracao: boolean };

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

  const { athleteUid, week } = corpo;
  const vUid = validarUid(athleteUid);
  if (!vUid.ok) return json(400, { erro: vUid.erro });
  const vSemana = validarSemanaId(week);
  if (!vSemana.ok) return json(400, { erro: vSemana.erro });
  const vChave = validarChaveIdempotencia(corpo.idempotencyKey);
  if (!vChave.ok) return json(400, { erro: vChave.erro });
  const vTexto = validarTexto(corpo.text, "text", true);
  if (!vTexto.ok) return json(400, { erro: vTexto.erro });
  const texto = vTexto.valor as string;

  const db = getFirestore(app);
  const refAtleta = db.collection(COLECAO_ATLETAS).doc(athleteUid);
  const refSemana = refAtleta.collection(SUBCOLECAO_CHECKINS).doc(week);
  const emHomologacao = process.env.CONTEXT !== "production";

  let resultado: Resultado;
  try {
    resultado = await db.runTransaction<Resultado>(async (tx) => {
      const snap = await tx.get(refSemana);
      if (!snap.exists) throw new NaoEncontrado();

      const anterior = snap.get("coachResponse");
      if (anterior && anterior.text === texto) {
        return { respondeu: false, editou: false, semAlteracao: true };
      }

      tx.update(refSemana, {
        coachResponse: {
          text: texto,
          respondedAt: FieldValue.serverTimestamp(),
          respondedBy: { uid, role: "admin" },
        },
      });
      return { respondeu: !anterior, editou: !!anterior, semAlteracao: false };
    });
  } catch (e: any) {
    if (e instanceof NaoEncontrado) return json(404, { erro: "Check-in não encontrado para esta semana." });
    console.error(`[${ORIGEM}]`, e?.stack ?? e);
    return json(500, { erro: "Falha ao gravar a resposta." });
  }

  if (!resultado.semAlteracao) {
    const ator: Ator = { tipo: "humano", uid, email, papel: "admin" };
    await registrar({
      acao: resultado.editou ? "checkin.resposta-corrigida" : "checkin.respondido",
      ator,
      // D-AR: the athlete uid in the target, because the actor is the Coach.
      alvo: { colecao: SUBCOLECAO_CHECKINS, id: `${athleteUid}/${week}` },
      origem: ORIGEM,
      ...(emHomologacao ? { _test: true } : {}),
    });
  }

  // The stored instant, for the panel's "respondido em" line.
  let respondedAt: string | null = null;
  try {
    const r = (await refSemana.get()).get("coachResponse.respondedAt");
    if (r instanceof Timestamp) respondedAt = r.toDate().toISOString();
  } catch {
    // Display detail only; the response is recorded.
  }

  return json(200, {
    ok: true,
    athleteUid,
    week,
    respondeu: resultado.respondeu,
    editou: resultado.editou,
    semAlteracao: resultado.semAlteracao,
    respondedAt,
  });
};
