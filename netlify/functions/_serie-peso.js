// ELITE90 PRO · _serie-peso
// -----------------------------------------------------------------------------
// Pure rules of the daily weight series — M2 Phase 3 (persistence plan;
// persistence schema v3, section 7).
//
// WHY A COMMONJS MODULE
// Same arrangement as _external-label.js: the TypeScript functions import it
// (through _m2-validacao.ts), and the Node.js test runner loads it directly,
// with no build step. Nothing here touches Firestore, the clock or the network
// on its own — every "now" and every start date comes in as a parameter, so the
// rules can be tested with fixed instants.
//
// WHAT LIVES HERE
//   · shape of `measuredOn` (civil date, AAAA-MM-DD) and its two bounds;
//   · shape of `weightKg` (range and decimal places);
//   · the 7-day moving average, derived on read and never stored (schema §7,
//     principle P3).
//
// DECISIONS APPLIED (owner, 25/09/2026, Phase 3 diagnosis):
//   · weight between 30 and 300 kg — the same range the triage form already
//     enforces — with at most 2 decimal places. Out-of-shape values are REJECTED,
//     never rounded: a silently altered number is worse than a refused one.
//   · `measuredOn` not after "today" in the most advanced time zone on Earth
//     (UTC+14). This tolerates an athlete travelling east without the server
//     having to guess where the athlete is.
//   · `measuredOn` not before the athlete's cycle start date (civil date in
//     America/Sao_Paulo). Also keeps the relative day non-negative when the
//     technical archive converts dates to cycle days (Addendum 04, §5).
//   · moving average over a CALENDAR window of 7 days ending on each point,
//     averaging the points that exist in it; `n7` says how many there were.
//     "Last 7 points" would mix different weeks whenever the athlete skips days.
// -----------------------------------------------------------------------------

'use strict';

const WEIGHT_MIN_KG = 30;
const WEIGHT_MAX_KG = 300;
const WEIGHT_MAX_DECIMALS = 2;

/** Reference time zone of the programme — the same one packages/situacao uses. */
const FUSO_REFERENCIA = 'America/Sao_Paulo';

/** Most advanced UTC offset in use (Line Islands, UTC+14). */
const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;

const JANELA_MEDIA_DIAS = 7;

const MEASURED_ON_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DIA_MS = 24 * 60 * 60 * 1000;

/** True when `v` is a real calendar date written as AAAA-MM-DD. */
function isDataCivil(v) {
  if (typeof v !== 'string' || !MEASURED_ON_PATTERN.test(v)) return false;
  const [a, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  // Round trip rejects 2026-02-30, 2026-13-01 and the like.
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Day number (days since the epoch) of a valid AAAA-MM-DD string. */
function diaNumero(dataCivil) {
  const [a, m, d] = dataCivil.split('-').map(Number);
  return Math.round(Date.UTC(a, m - 1, d) / DIA_MS);
}

/** AAAA-MM-DD of an instant, read in UTC. */
function dataCivilUtc(instante) {
  return instante.toISOString().slice(0, 10);
}

/** AAAA-MM-DD of an instant, read in the given IANA time zone. */
function dataCivilNoFuso(instante, fuso) {
  // en-CA formats as AAAA-MM-DD; parts are assembled explicitly anyway, so the
  // result does not depend on locale data quirks.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instante);
  const valor = (tipo) => partes.find((p) => p.type === tipo).value;
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

/** Latest acceptable `measuredOn` at instant `agora`: today in UTC+14. */
function limiteSuperiorMeasuredOn(agora) {
  return dataCivilUtc(new Date(agora.getTime() + MAX_UTC_OFFSET_MS));
}

/**
 * Cycle start as a civil date in the reference time zone, or null when the
 * value is not a usable instant. Accepts a Date or anything with `toDate()`
 * (a Firestore Timestamp), so this module never imports the Firestore SDK.
 */
function dataCivilDoInicio(startDate) {
  let instante = null;
  if (startDate instanceof Date) instante = startDate;
  else if (startDate && typeof startDate.toDate === 'function') instante = startDate.toDate();
  if (!instante || Number.isNaN(instante.getTime())) return null;
  return dataCivilNoFuso(instante, FUSO_REFERENCIA);
}

/** Shape of `weightKg`. */
function validarPesoKg(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return { ok: false, erro: 'weightKg precisa ser um número.' };
  }
  if (v < WEIGHT_MIN_KG || v > WEIGHT_MAX_KG) {
    return { ok: false, erro: `weightKg fora da faixa de ${WEIGHT_MIN_KG} a ${WEIGHT_MAX_KG} kg.` };
  }
  const escala = 10 ** WEIGHT_MAX_DECIMALS;
  // Tolerance absorbs binary representation noise (85.35 * 100 = 8534.999…).
  if (Math.abs(v * escala - Math.round(v * escala)) > 1e-6) {
    return { ok: false, erro: `weightKg aceita no máximo ${WEIGHT_MAX_DECIMALS} casas decimais.` };
  }
  return { ok: true };
}

/**
 * Shape of `measuredOn` plus its upper bound. Independent of the athlete, so
 * it can run before any database read.
 */
function validarMeasuredOn(v, agora) {
  if (!isDataCivil(v)) {
    return { ok: false, erro: 'measuredOn precisa ser uma data válida no formato AAAA-MM-DD.' };
  }
  if (v > limiteSuperiorMeasuredOn(agora)) {
    return { ok: false, erro: 'measuredOn não pode ser uma data futura.' };
  }
  return { ok: true };
}

/**
 * Lower bound: `measuredOn` not before the cycle start. `inicioCiclo` null
 * means the athlete has no usable start date, and only the upper bound applies.
 * Kept apart from validarMeasuredOn because it depends on the athlete document
 * and therefore runs inside the write transaction.
 */
function validarInicioCiclo(v, inicioCiclo) {
  if (inicioCiclo && v < inicioCiclo) {
    return { ok: false, erro: `measuredOn anterior ao início do ciclo (${inicioCiclo}).` };
  }
  return { ok: true };
}

/**
 * 7-day moving average over a calendar window, derived on read.
 *
 * Input: points `{ measuredOn, weightKg }` in ascending date order, one per
 * day (the document id guarantees it). Output: the same points, each with
 * `mma7` (average of the points whose date falls in the 7 civil days ending on
 * that point, rounded to 2 decimals) and `n7` (how many points entered it).
 */
function calcularMediaMovel(pontos) {
  const saida = [];
  let inicio = 0;
  let soma = 0;
  for (let i = 0; i < pontos.length; i++) {
    const dia = diaNumero(pontos[i].measuredOn);
    soma += pontos[i].weightKg;
    while (diaNumero(pontos[inicio].measuredOn) <= dia - JANELA_MEDIA_DIAS) {
      soma -= pontos[inicio].weightKg;
      inicio += 1;
    }
    const n = i - inicio + 1;
    saida.push({
      measuredOn: pontos[i].measuredOn,
      weightKg: pontos[i].weightKg,
      mma7: Math.round((soma / n) * 100) / 100,
      n7: n,
    });
  }
  return saida;
}

module.exports = {
  WEIGHT_MIN_KG,
  WEIGHT_MAX_KG,
  WEIGHT_MAX_DECIMALS,
  FUSO_REFERENCIA,
  JANELA_MEDIA_DIAS,
  isDataCivil,
  dataCivilNoFuso,
  dataCivilDoInicio,
  limiteSuperiorMeasuredOn,
  validarPesoKg,
  validarMeasuredOn,
  validarInicioCiclo,
  calcularMediaMovel,
};
