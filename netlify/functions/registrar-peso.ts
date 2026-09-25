// ELITE90 PRO · registrar-peso
// -----------------------------------------------------------------------------
// Netlify Function: records the athlete's weight for one civil day in
// `athletes/{uid}/weights/{AAAA-MM-DD}` — M2 Phase 3 (persistence plan;
// persistence schema v3, sections 5 and 7).
//
// WHO CALLS IT
// The athlete, and only the athlete (`_ator-atleta.ts`). The Athlete Portal
// does not exist yet, so in homologation the function is exercised by
// `scripts/testar-serie-peso.mjs`, with a test-athlete credential (plan,
// common rule 3). The Coach does NOT record weight for the athlete.
//
// CONTRACT
//   POST, `Authorization: Bearer <athlete ID token>`
//   { athleteUid, measuredOn: "AAAA-MM-DD", weightKg, source?, idempotencyKey? }
//   200 { ok, athleteUid, measuredOn, weightKg, weightCurrentKg,
//         substituiu, atualizouAtual, duplicado, idempotencyKey }
//   400 malformed body or value   401 no/invalid token   403 not this athlete
//   404 athlete not found         405 method           409 before cycle start
//
// ONE ATOMIC OPERATION (schema §5, principle P4)
// The day's document and the denormalized `weightCurrentKg` are written in the
// same transaction. `weightCurrentKg` is "the last point of the series", which
// means the point with the LATEST `measuredOn` — not the latest write. A late
// entry (yesterday's weight sent today, or a day delivered later by the
// Portal's offline queue) must not overwrite the current weight with an older
// value. So the transaction reads the newest document of the series and only
// moves `weightCurrentKg` when this day is that one or a newer one.
//
// Consequence worth knowing: `weightCurrentKg` feeds the nutrition formula at
// plan publication (`aprovar-sugestao.ts`, `publicar-plano-direto.ts`). A new
// weight therefore changes the calories of the NEXT publication; the version
// already published keeps its own `formulaSnapshot`.
//
// TWO TIMESTAMPS (schema §14)
// `measuredOn` is declared by the client and is what the series uses;
// `recordedAt` is the server's and is what auditing uses. A gap between them
// is information, not a defect.
//
// IDEMPOTENCY (plan, common rule 4)
// Natural identity: one document per civil day, so writing the same day again
// overwrites. The idempotency key is the second guarantee: a resend with the
// same key and the same value is answered as `duplicado: true`, writes nothing
// and emits no event — the operation did not happen again. That is what lets
// the Portal's offline queue plug in without changing this function.
//
// WHAT THE DOCUMENT CARRIES (Addendum 04, R1)
// No identifier of the person: no uid, no e-mail, no `recordedBy`. Who the
// athlete is, the document path already says. `source` is always `manual` in
// this phase and `ocrRawValue` stays reserved as null (persistence plan, D-AI).
//
// TRACEABILITY (persistence plan, Phase 3 contract; D-AH; D-AG = Addendum 04 §6.4)
// After the transaction, best-effort (DR-06): 'peso.registrado' when the day
// did not exist, 'peso.corrigido' when it did — decided here, at write time.
// No `detalhe` (DR-04). Actor e-mail is null (D-AG; Addendum 04 §6.4).
// -----------------------------------------------------------------------------

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar } from "./_rastreabilidade";
import { verificarAtorAtleta } from "./_ator-atleta";
import {
  validarUid,
  validarWeightKg,
  validarMeasuredOn,
  validarInicioCiclo,
  validarWeightSource,
  validarChaveIdempotencia,
  dataCivilDoInicio,
} from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_PESOS = "weights";
const ORIGEM = "registrar-peso";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

class AtletaNaoEncontrado extends Error {}
class AntesDoInicio extends Error {}

type Resultado = {
  substituiu: boolean;
  atualizouAtual: boolean;
  duplicado: boolean;
  weightCurrentKg: number | null;
};

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Authentication before the body (Phase 1 pattern, W-4).
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let decoded: Awaited<ReturnType<ReturnType<typeof getAuth>["verifyIdToken"]>>;
  try {
    decoded = await getAuth(app).verifyIdToken(idToken);
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo inválido." });
  }

  const { athleteUid, measuredOn, weightKg, source, idempotencyKey } = corpo;

  // The uid is checked first because the actor check depends on it; the actor
  // check comes before the other validations, so a caller who may not write
  // here learns nothing about what a valid body would look like.
  const vUid = validarUid(athleteUid);
  if (!vUid.ok) return json(400, { erro: vUid.erro });

  const veredicto = verificarAtorAtleta(decoded, athleteUid);
  if (!veredicto.ok) {
    return json(veredicto.status, { erro: veredicto.erro, reason: veredicto.reason });
  }

  for (const v of [
    validarMeasuredOn(measuredOn, new Date()),
    validarWeightKg(weightKg),
    validarWeightSource(source),
    validarChaveIdempotencia(idempotencyKey),
  ]) {
    if (!v.ok) return json(400, { erro: v.erro });
  }

  const db = getFirestore(app);
  const refAtleta = db.collection(COLECAO_ATLETAS).doc(athleteUid);
  const refPesos = refAtleta.collection(SUBCOLECAO_PESOS);
  const refDia = refPesos.doc(measuredOn);
  const emHomologacao = process.env.CONTEXT !== "production";

  let resultado: Resultado;
  let inicioCiclo: string | null = null;

  try {
    resultado = await db.runTransaction<Resultado>(async (tx) => {
      // All reads first — Firestore transactions require it.
      const snapAtleta = await tx.get(refAtleta);
      if (!snapAtleta.exists) throw new AtletaNaoEncontrado();

      inicioCiclo = dataCivilDoInicio(snapAtleta.get("startDate"));
      if (!validarInicioCiclo(measuredOn, inicioCiclo).ok) throw new AntesDoInicio();

      const snapDia = await tx.get(refDia);
      // Newest point of the series. Same query shape as the version numbering
      // in aprovar-sugestao.ts; index declared in firestore.indexes.json.
      const snapUltimo = await tx.get(refPesos.orderBy("__name__", "desc").limit(1));

      const atualAtual = snapAtleta.get("weightCurrentKg");
      const weightCurrentAtual = typeof atualAtual === "number" ? atualAtual : null;

      if (
        snapDia.exists &&
        typeof idempotencyKey === "string" &&
        snapDia.get("lastIdempotencyKey") === idempotencyKey &&
        snapDia.get("weightKg") === weightKg
      ) {
        return {
          substituiu: false,
          atualizouAtual: false,
          duplicado: true,
          weightCurrentKg: weightCurrentAtual,
        };
      }

      const ultimoDia = snapUltimo.empty ? null : snapUltimo.docs[0].id;
      const atualiza = ultimoDia === null || measuredOn >= ultimoDia;

      // Full overwrite, not merge: a point is one fact, and a field left over
      // from an earlier write of the same day would describe a different one.
      tx.set(refDia, {
        weightKg,
        measuredOn,
        recordedAt: FieldValue.serverTimestamp(),
        source: "manual",
        ocrRawValue: null,
        ...(idempotencyKey ? { lastIdempotencyKey: idempotencyKey } : {}),
        _test: emHomologacao,
      });

      // Only the denormalized field — same precedent as alterar-fase-atleta.ts,
      // which updates `phase` alone.
      if (atualiza) tx.update(refAtleta, { weightCurrentKg: weightKg });

      return {
        substituiu: snapDia.exists,
        atualizouAtual: atualiza,
        duplicado: false,
        weightCurrentKg: atualiza ? weightKg : weightCurrentAtual,
      };
    });
  } catch (e: any) {
    if (e instanceof AtletaNaoEncontrado) return json(404, { erro: "Atleta não encontrado." });
    if (e instanceof AntesDoInicio) {
      // 409, not 400: the body is well formed; what fails is a rule about the
      // athlete's current state (precedent: alterar-fase-atleta.ts).
      return json(409, {
        erro: `measuredOn anterior ao início do ciclo (${inicioCiclo}).`,
        reason: "antes-do-inicio",
      });
    }
    console.error(`[${ORIGEM}]`, e?.stack ?? e);
    return json(500, { erro: "Falha ao gravar o peso." });
  }

  if (!resultado.duplicado) {
    await registrar({
      acao: resultado.substituiu ? "peso.corrigido" : "peso.registrado",
      ator: veredicto.ator,
      alvo: { colecao: SUBCOLECAO_PESOS, id: measuredOn },
      origem: ORIGEM,
      ...(emHomologacao ? { _test: true } : {}),
    });
  }

  return json(200, {
    ok: true,
    athleteUid,
    measuredOn,
    weightKg,
    weightCurrentKg: resultado.weightCurrentKg,
    substituiu: resultado.substituiu,
    atualizouAtual: resultado.atualizouAtual,
    duplicado: resultado.duplicado,
    idempotencyKey: idempotencyKey ?? null,
  });
};
