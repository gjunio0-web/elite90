// ELITE90 PRO · registrar-avaliacao-fisica
// -----------------------------------------------------------------------------
// Netlify Function: records the athlete's biweekly physical evaluation in
// `athletes/{uid}/evaluations/{wNN}` — M2 Phase 6 (persistence plan v5.26;
// persistence schema v3, section 10, with its update note; Addendum 04 v1.12).
//
// WHO CALLS IT
// The athlete, and only the athlete (`_ator-atleta.ts`). The professional
// MEASURES; the athlete SENDS the numbers (Addendum 04, §6.1; plan O3). The
// Coach's tab is read-only. The Athlete Portal does not exist yet, so in
// homologation the function is exercised by scripts/testar-avaliacao-relatorio.mjs
// (D-AD).
//
// CONTRACT
//   POST, `Authorization: Bearer <athlete ID token>`
//   { athleteUid, perimeters: {14 fields, cm}, skinfolds?: {12 fields, mm} | null,
//     measuredAt: ISO 8601 date-time, measuredBy: { type, sameAsPrevious },
//     idempotencyKey? }
//   200 { ok, athleteUid, week, cycleWeek, registrou, corrigiu, duplicado,
//         idempotencyKey }
//   400 malformed body, weight in the body, value out of range or with two
//       decimals, unknown field, partial skinfold block, measuredBy identifying
//       the rater or inconsistent with the history (O4), measuredAt missing,
//       in the future or before the cycle start (O2, D-AJ)
//   401 no/invalid token   403 not this athlete   404 athlete not found
//   405 method   409 before the cycle start, after week 13, no start date,
//       inconsistent history
//
// WHICH SLOT (O1) — DECIDED HERE, NEVER BY THE CLIENT
// A is the cycle week of arrival (server clock, civil date in America/Sao_Paulo,
// counted from `startDate`, with `semanaDoCiclo` of _checkin.js); U is the last
// evaluation week recorded. The slot is the odd week of a two-week window
// (`decidirVagaAvaliacao`, _avaliacao-fisica.js). `measuredAt` never decides it.
// Because the slot depends on the history, `startDate` may not change after the
// first evaluation (D-AT, extended by O12). No function changes it today.
//
// CORRECTION (O3)
// A resend inside the slot's window overwrites the whole document — a
// transcription error is fixed by sending the numbers again. `submittedAt`
// keeps the first submission. Outside the window the slot is closed.
//
// TWO TIMESTAMPS (common rule 5)
// `measuredAt` is the athlete's declaration of when the professional measured;
// `submittedAt` is the server's. The divergence is information, not a defect.
//
// IDEMPOTENCY (common rule 4) — same as the check-in (FE-5)
// A resend whose key equals the key stored on the LAST recorded evaluation is
// the same operation arriving again: `duplicado: true`, nothing written, no
// event.
//
// WHAT THE DOCUMENT CARRIES (Addendum 04, R1 and note to R1)
// No identifier of the athlete — the path says who it is — and no identifier of
// the rater: `measuredBy` is { type, sameAsPrevious } and nothing else (CE-12).
// No weight (schema §7) and no body-fat percentage (schema §10).
//
// TRACEABILITY (Addendum 04 v1.12, §6.3; D-AG)
// After the transaction, best-effort (DR-06): 'avaliacao-fisica.registrada' for
// a new slot, 'avaliacao-fisica.corrigida' for a correction. Actor e-mail null;
// target `{ colecao: "evaluations", id: "wNN" }`; no `detalhe` (DR-04).
// -----------------------------------------------------------------------------

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar } from "./_rastreabilidade";
import { verificarAtorAtleta } from "./_ator-atleta";
import {
  validarUid,
  validarChaveIdempotencia,
  validarSemPesoAvaliacao,
  validarPerimetros,
  validarDobras,
  validarMedidoPor,
  validarMedidoEm,
  validarLimitesMedidoEm,
  dataCivilDoInicio,
  dataCivilReferencia,
  semanaDoCiclo,
  decidirVagaAvaliacao,
  idDaSemana,
  numeroDaSemana,
} from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_AVALIACOES = "evaluations";
const ORIGEM = "registrar-avaliacao-fisica";

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
class Recusa400 extends Error {
  constructor(public erro: string) {
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
  "historico-inconsistente": "Há avaliação registrada numa semana posterior à atual.",
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

  // Same order as registrar-checkin.ts: the uid first, because the actor check
  // depends on it; the actor before every other validation.
  const vUid = validarUid(athleteUid);
  if (!vUid.ok) return json(400, { erro: vUid.erro });

  const veredicto = verificarAtorAtleta(decoded, athleteUid);
  if (!veredicto.ok) {
    return json(veredicto.status, { erro: veredicto.erro, reason: veredicto.reason });
  }

  const vSemPeso = validarSemPesoAvaliacao(corpo);
  if (!vSemPeso.ok) return json(400, { erro: vSemPeso.erro });

  const vChave = validarChaveIdempotencia(idempotencyKey);
  if (!vChave.ok) return json(400, { erro: vChave.erro });

  const vPerimetros = validarPerimetros(corpo.perimeters);
  if (!vPerimetros.ok) return json(400, { erro: vPerimetros.erro });
  const perimetros = vPerimetros.valor;

  const vDobras = validarDobras(corpo.skinfolds);
  if (!vDobras.ok) return json(400, { erro: vDobras.erro });
  const dobras = vDobras.valor;

  const vMedidoEm = validarMedidoEm(corpo.measuredAt);
  if (!vMedidoEm.ok) return json(400, { erro: vMedidoEm.erro });
  const medidoEm = vMedidoEm.valor;

  // `measuredBy` needs the history (is there an earlier evaluation?), so only
  // its presence is checked here; its content is validated in the transaction.
  if (corpo.measuredBy === undefined || corpo.measuredBy === null) {
    return json(400, { erro: "measuredBy é obrigatório." });
  }

  const db = getFirestore(app);
  const refAtleta = db.collection(COLECAO_ATLETAS).doc(athleteUid);
  const refAvaliacoes = refAtleta.collection(SUBCOLECAO_AVALIACOES);
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

      // The two newest evaluations: the newest decides the slot; the one
      // before it answers "is there an earlier evaluation?" on a correction.
      // wNN is zero-padded, so the id order is the week order (schema P5).
      // Index `evaluations · __name__ DESC` in firestore.indexes.json.
      const snapUltimos = await tx.get(refAvaliacoes.orderBy("__name__", "desc").limit(2));
      const docUltimo = snapUltimos.empty ? null : snapUltimos.docs[0];
      const U = docUltimo ? numeroDaSemana(docUltimo.id) ?? 0 : 0;

      if (
        docUltimo &&
        typeof idempotencyKey === "string" &&
        docUltimo.get("lastIdempotencyKey") === idempotencyKey
      ) {
        return { semana: U, registrou: false, corrigiu: false, duplicado: true };
      }

      const A = semanaDoCiclo(inicio, dataCivilReferencia(agora));
      const decisao = decidirVagaAvaliacao(A, U);
      if (!decisao.ok) throw new Recusa409(MENSAGENS_409[decisao.motivo], decisao.motivo);

      // O2 with D-AJ: the civil date of the measurement is not in the future
      // and not before the cycle start. It decides nothing.
      const vLimites = validarLimitesMedidoEm(medidoEm, agora, inicio);
      if (!vLimites.ok) throw new Recusa400(vLimites.erro);

      const haAnterior = decisao.correcao ? snapUltimos.docs.length > 1 : !!docUltimo;
      const vMedidoPor = validarMedidoPor(corpo.measuredBy, haAnterior);
      if (!vMedidoPor.ok) throw new Recusa400(vMedidoPor.erro);

      const refSemana = refAvaliacoes.doc(idDaSemana(decisao.semana));
      if (!decisao.correcao) {
        // Cannot happen: the slot is always after the last recorded week.
        const snapSemana = await tx.get(refSemana);
        if (snapSemana.exists) {
          throw new Recusa409(MENSAGENS_409["historico-inconsistente"], "historico-inconsistente");
        }
      }

      // Full overwrite, not merge: an evaluation is one fact, and a field left
      // over from an earlier write of the same slot would describe another.
      tx.set(refSemana, {
        cycleWeek: decisao.semana,
        perimeters: perimetros,
        skinfolds: dobras,
        measuredAt: medidoEm,
        measuredBy: vMedidoPor.valor,
        submittedAt:
          decisao.correcao && docUltimo ? docUltimo.get("submittedAt") : FieldValue.serverTimestamp(),
        ...(idempotencyKey ? { lastIdempotencyKey: idempotencyKey } : {}),
        _test: emHomologacao,
      });

      return {
        semana: decisao.semana,
        registrou: !decisao.correcao,
        corrigiu: decisao.correcao,
        duplicado: false,
      };
    });
  } catch (e: any) {
    if (e instanceof AtletaNaoEncontrado) return json(404, { erro: "Atleta não encontrado." });
    if (e instanceof Recusa400) return json(400, { erro: e.erro });
    // 409, not 400: the body is well formed; what fails is a rule about the
    // athlete's current state (precedent: registrar-checkin.ts).
    if (e instanceof Recusa409) return json(409, { erro: e.erro, reason: e.reason });
    console.error(`[${ORIGEM}]`, e?.stack ?? e);
    return json(500, { erro: "Falha ao gravar a avaliação física." });
  }

  const week = idDaSemana(resultado.semana);

  if (!resultado.duplicado) {
    await registrar({
      acao: resultado.corrigiu ? "avaliacao-fisica.corrigida" : "avaliacao-fisica.registrada",
      ator: veredicto.ator,
      alvo: { colecao: SUBCOLECAO_AVALIACOES, id: week },
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
