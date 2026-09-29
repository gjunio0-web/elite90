// ELITE90 PRO · registrar-checkin
// -----------------------------------------------------------------------------
// Netlify Function: records the athlete's weekly check-in in
// `athletes/{uid}/checkins/{wNN}` — M2 Phase 4 (persistence plan v5.23;
// persistence schema v3, section 6, with its update note of 28/09/2026).
//
// WHO CALLS IT
// The athlete, and only the athlete (`_ator-atleta.ts`). The Athlete Portal
// does not exist yet, so in homologation the function is exercised by
// `scripts/testar-checkin.mjs` (D-AD). The Coach does NOT send a check-in for
// the athlete: the check-in always comes from the athlete (decision of
// 03/09/2026, plan §4).
//
// CONTRACT
//   POST, `Authorization: Bearer <athlete ID token>`
//   { athleteUid, measurements: { waistCm, hipCm, armCm?, chestCm? },
//     perception?, photos?: string[], declaredAt?: ISO 8601, idempotencyKey? }
//   200 { ok, athleteUid, week, cycleWeek, registrou, corrigiu, duplicado,
//         idempotencyKey }
//   400 malformed body, weight in the body (F4-4), value out of range (F4-6),
//       photo outside the athlete's prefix or missing from the bucket (F4-5)
//   401 no/invalid token   403 not this athlete   404 athlete not found
//   405 method   409 before the cycle start, after week 13, no start date,
//       or correction after the Coach's response (F4-3)
//
// WHICH WEEK (F4-2) — DECIDED HERE, NEVER BY THE CLIENT
// A is the cycle week of arrival (server clock, civil date in America/Sao_Paulo,
// counted from `startDate`); U is the last week recorded. The rules are in
// _checkin.js (`decidirSemana`). Because the week depends on the history of
// submissions, `startDate` may not change after the first check-in (D-AT).
//
// ONE ATOMIC OPERATION (schema principle P4)
// The week document and `lastCheckinSubmittedAt` on the athlete document are
// written in the same transaction (F4-1; Addendum 06 v1.5, section 5). The
// field only advances when a NEW week is created: a correction is not a new
// submission, and the follow-up status measures punctuality (DA-04).
//
// TWO TIMESTAMPS (common rule 5)
// `submittedAt` is the server's and is the fact the follow-up status uses.
// `declaredAt` is what the client declared, kept only as information (F4-2b);
// it decides nothing.
//
// IDEMPOTENCY (common rule 4)
// A resend whose key equals the key stored on the LAST recorded week is the
// same operation arriving again — possibly in the following week, after a
// timeout on a request that had in fact succeeded. It is answered as
// `duplicado: true`, writes nothing and emits no event. Checking the last
// week, and not the week the rules would pick now, is what keeps such a resend
// from creating a second week.
//
// WHAT THE DOCUMENT CARRIES (Addendum 04, R1, R2, R2.1)
// No identifier of the athlete: the document path already says who it is.
// `perception` is free text in its own named field. `photos` holds Storage
// paths, never URLs.
//
// TRACEABILITY (plan v5.23, Phase 4 contract; D-AG = Addendum 04 §6.4)
// After the transaction, best-effort (DR-06): 'checkin.registrado' for a new
// week, 'checkin.corrigido' for a correction. No `detalhe` (DR-04). Actor
// e-mail null.
// -----------------------------------------------------------------------------

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getApp, storageBucketName } from "./_firebase";
import { registrar } from "./_rastreabilidade";
import { verificarAtorAtleta } from "./_ator-atleta";
import {
  validarUid,
  validarChaveIdempotencia,
  validarSemPeso,
  validarMedidas,
  validarTexto,
  validarFotos,
  validarDeclaradoEm,
  dataCivilDoInicio,
  dataCivilReferencia,
  semanaDoCiclo,
  decidirSemana,
  idDaSemana,
  numeroDaSemana,
  type MedidasCheckin,
} from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_CHECKINS = "checkins";
const ORIGEM = "registrar-checkin";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

class AtletaNaoEncontrado extends Error {}
class Recusa409 extends Error {
  constructor(public erro: string, public reason: string) {
    super(erro);
  }
}

type Resultado = {
  semana: number;
  registrou: boolean;
  corrigiu: boolean;
  duplicado: boolean;
};

const MENSAGENS_409: Record<string, string> = {
  "antes-do-inicio": "O ciclo do atleta ainda não começou.",
  "ciclo-encerrado": "O ciclo do atleta já passou da semana 13.",
  "historico-inconsistente": "Há check-in registrado numa semana posterior à atual.",
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
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) {
    return json(400, { erro: "Corpo inválido." });
  }

  const { athleteUid, idempotencyKey } = corpo;

  // Same order as registrar-peso.ts: the uid first, because the actor check
  // depends on it; the actor before every other validation, so a caller who may
  // not write here learns nothing about what a valid body looks like.
  const vUid = validarUid(athleteUid);
  if (!vUid.ok) return json(400, { erro: vUid.erro });

  const veredicto = verificarAtorAtleta(decoded, athleteUid);
  if (!veredicto.ok) {
    return json(veredicto.status, { erro: veredicto.erro, reason: veredicto.reason });
  }

  const vSemPeso = validarSemPeso(corpo);
  if (!vSemPeso.ok) return json(400, { erro: vSemPeso.erro });

  const vChave = validarChaveIdempotencia(idempotencyKey);
  if (!vChave.ok) return json(400, { erro: vChave.erro });

  const vMedidas = validarMedidas(corpo.measurements);
  if (!vMedidas.ok) return json(400, { erro: vMedidas.erro });
  const medidas: MedidasCheckin = vMedidas.valor;

  const vPercepcao = validarTexto(corpo.perception, "perception", false);
  if (!vPercepcao.ok) return json(400, { erro: vPercepcao.erro });
  const percepcao = vPercepcao.valor;

  const vFotos = validarFotos(corpo.photos, athleteUid);
  if (!vFotos.ok) return json(400, { erro: vFotos.erro });
  const fotos = vFotos.valor;

  const vDeclarado = validarDeclaradoEm(corpo.declaredAt);
  if (!vDeclarado.ok) return json(400, { erro: vDeclarado.erro });
  const declaradoEm = vDeclarado.valor;

  // F4-5: the files must exist. Checked before the transaction — Storage is not
  // part of it, and a path that does not exist would leave the Coach with a
  // broken thumbnail and no way to know why.
  if (fotos.length) {
    try {
      const bucket = getStorage(app).bucket(storageBucketName());
      const existem = await Promise.all(fotos.map((p) => bucket.file(p).exists().then((r) => r[0])));
      const ausente = fotos.find((_, i) => !existem[i]);
      if (ausente) return json(400, { erro: `foto não encontrada no Storage: ${ausente}` });
    } catch (e: any) {
      console.error(`[${ORIGEM}] storage`, e?.stack ?? e);
      return json(500, { erro: "Falha ao conferir as fotos." });
    }
  }

  const db = getFirestore(app);
  const refAtleta = db.collection(COLECAO_ATLETAS).doc(athleteUid);
  const refCheckins = refAtleta.collection(SUBCOLECAO_CHECKINS);
  const emHomologacao = process.env.CONTEXT !== "production";
  const agora = new Date();

  let resultado: Resultado;
  try {
    resultado = await db.runTransaction<Resultado>(async (tx) => {
      // All reads first — Firestore transactions require it.
      const snapAtleta = await tx.get(refAtleta);
      if (!snapAtleta.exists) throw new AtletaNaoEncontrado();

      const inicio = dataCivilDoInicio(snapAtleta.get("startDate"));
      if (!inicio) {
        throw new Recusa409("O atleta não tem data de início do ciclo.", "sem-data-de-inicio");
      }

      // Newest recorded week. wNN is zero-padded, so the id order is the week
      // order (schema P5). Index declared in firestore.indexes.json.
      const snapUltimo = await tx.get(refCheckins.orderBy("__name__", "desc").limit(1));
      const docUltimo = snapUltimo.empty ? null : snapUltimo.docs[0];
      const U = docUltimo ? numeroDaSemana(docUltimo.id) ?? 0 : 0;

      if (
        docUltimo &&
        typeof idempotencyKey === "string" &&
        docUltimo.get("lastIdempotencyKey") === idempotencyKey
      ) {
        return { semana: U, registrou: false, corrigiu: false, duplicado: true };
      }

      const A = semanaDoCiclo(inicio, dataCivilReferencia(agora));
      const decisao = decidirSemana(A, U);
      if (!decisao.ok) throw new Recusa409(MENSAGENS_409[decisao.motivo], decisao.motivo);

      const refSemana = refCheckins.doc(idDaSemana(decisao.semana));
      const snapSemana = decisao.correcao && docUltimo ? docUltimo : await tx.get(refSemana);

      if (decisao.correcao) {
        // F4-3: a correction is only possible before the Coach has answered —
        // otherwise the response would refer to numbers that no longer exist.
        if (snapSemana.get("coachResponse")) {
          throw new Recusa409(
            "A semana já foi respondida pelo Coach e não pode mais ser corrigida.",
            "ja-respondido",
          );
        }
      } else if (snapSemana.exists) {
        // Cannot happen: the target is always after the last recorded week.
        throw new Recusa409(MENSAGENS_409["historico-inconsistente"], "historico-inconsistente");
      }

      // Full overwrite, not merge: a check-in is one fact, and a field left
      // over from an earlier write of the same week would describe another.
      // A correction keeps the original `submittedAt` — the moment of the
      // submission is the fact the follow-up status counts (Addendum 06 §5).
      tx.set(refSemana, {
        cycleWeek: decisao.semana,
        submittedAt: decisao.correcao ? snapSemana.get("submittedAt") : FieldValue.serverTimestamp(),
        measurements: medidas,
        perception: percepcao,
        photos: fotos,
        coachResponse: null,
        declaredAt: declaradoEm,
        ...(idempotencyKey ? { lastIdempotencyKey: idempotencyKey } : {}),
        _test: emHomologacao,
      });

      // F4-1: only a new week advances the date the list reads.
      if (!decisao.correcao) {
        tx.update(refAtleta, { lastCheckinSubmittedAt: FieldValue.serverTimestamp() });
      }

      return {
        semana: decisao.semana,
        registrou: !decisao.correcao,
        corrigiu: decisao.correcao,
        duplicado: false,
      };
    });
  } catch (e: any) {
    if (e instanceof AtletaNaoEncontrado) return json(404, { erro: "Atleta não encontrado." });
    // 409, not 400: the body is well formed; what fails is a rule about the
    // athlete's current state (precedent: alterar-fase-atleta.ts).
    if (e instanceof Recusa409) return json(409, { erro: e.erro, reason: e.reason });
    console.error(`[${ORIGEM}]`, e?.stack ?? e);
    return json(500, { erro: "Falha ao gravar o check-in." });
  }

  const week = idDaSemana(resultado.semana);

  if (!resultado.duplicado) {
    await registrar({
      acao: resultado.corrigiu ? "checkin.corrigido" : "checkin.registrado",
      ator: veredicto.ator,
      alvo: { colecao: SUBCOLECAO_CHECKINS, id: week },
      origem: ORIGEM,
      ...(emHomologacao ? { _test: true } : {}),
    });
  }

  return json(200, {
    ok: true,
    athleteUid,
    week,
    cycleWeek: resultado.semana,
    registrou: resultado.registrou,
    corrigiu: resultado.corrigiu,
    duplicado: resultado.duplicado,
    idempotencyKey: idempotencyKey ?? null,
  });
};
