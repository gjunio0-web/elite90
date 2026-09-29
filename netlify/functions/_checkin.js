// ELITE90 PRO · _checkin
// -----------------------------------------------------------------------------
// Pure rules of the weekly check-in — M2 Phase 4 (persistence plan v5.23;
// persistence schema v3, section 6, with the update note of 28/09/2026).
//
// WHY A COMMONJS MODULE
// Same arrangement as _serie-peso.js: the TypeScript functions import it
// (through _m2-validacao.ts), and the Node.js test runner loads it directly.
// Nothing here touches Firestore, the clock or the network: "today" and the
// cycle start always come in as parameters, so every rule can be tested with
// fixed dates.
//
// WHAT LIVES HERE (owner decisions of 28/09/2026, plan §4)
//   · F4-2 — the week of a check-in is decided by the SERVER, from the cycle
//     week of arrival (A) and the last week already recorded (U). Nothing sent
//     by the client decides it.
//   · F4-3 — a resend in the same week A is a correction of week A.
//   · F4-5 — photo paths: under the athlete's own check-in prefix, at most as
//     many as the triage form accepts (5), same angles and order as the form.
//   · F4-6 — measurement ranges, required fields and decimal places; text
//     length limits.
// -----------------------------------------------------------------------------

'use strict';

const CICLO_TOTAL_SEMANAS = 13;
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Measurement ranges in centimetres (F4-6). Waist and hip are required; arm
 * and chest are optional. At most one decimal place; values out of shape are
 * REFUSED, never rounded — same principle as the weight range (D-AN).
 */
const MEDIDAS = {
  waistCm: { min: 40, max: 200, obrigatoria: true },
  hipCm: { min: 50, max: 200, obrigatoria: true },
  armCm: { min: 15, max: 70, obrigatoria: false },
  chestCm: { min: 50, max: 200, obrigatoria: false },
};
const MEDIDA_MAX_DECIMALS = 1;

/** Free text of the athlete (`perception`) and of the Coach (`coachResponse.text`). */
const TEXTO_MAX_CHARS = 4000;

/**
 * Photos per check-in: the triage form accepts up to five, and the check-in
 * keeps the same angles in the same order (F4-5), because "Comparar com Início"
 * pairs photos by position.
 */
const FOTOS_MAX = 5;

const SEMANA_ID_PATTERN = /^w(0[1-9]|1[0-3])$/;

/** Document id of a cycle week: 5 → "w05" (schema §4, principle P5). */
function idDaSemana(n) {
  return 'w' + String(n).padStart(2, '0');
}

/** Cycle week number of a document id, or null when the id is not w01…w13. */
function numeroDaSemana(id) {
  if (typeof id !== 'string' || !SEMANA_ID_PATTERN.test(id)) return null;
  return Number(id.slice(1));
}

function diaNumero(dataCivil) {
  const [a, m, d] = dataCivil.split('-').map(Number);
  return Math.round(Date.UTC(a, m - 1, d) / DIA_MS);
}

/**
 * Cycle week of a civil date, counted from the cycle start: the start day is
 * day 1 of week 1 (same convention as the panel). NOT clamped — 0 or less
 * means before the start, 14 or more means after the cycle. Both inputs are
 * AAAA-MM-DD civil dates in the programme's reference time zone.
 */
function semanaDoCiclo(inicioCivil, hojeCivil) {
  const dia = diaNumero(hojeCivil) - diaNumero(inicioCivil) + 1;
  if (dia < 1) return 0;
  return Math.ceil(dia / 7);
}

/**
 * F4-2. Decides the target week of a check-in arriving in cycle week `A`,
 * given the last recorded week `U` (0 when there is none).
 *   (1) U + 1 = A      → new week A;
 *   (2) U = A          → correction of week A (F4-3);
 *   (3) U + 1 = A − 1  → new week U + 1 (one week late is accepted);
 *   (4) U + 1 < A − 1  → new week A; the skipped weeks stay empty;
 *   (5) A before the start or after week 13 → refused.
 * Accepted risk, registered in the plan: whoever skipped the previous week and
 * sends the current one has it recorded in the previous week.
 *
 * Returns { ok: true, semana, correcao } or { ok: false, motivo }.
 */
function decidirSemana(A, U) {
  if (!Number.isInteger(A) || A < 1) return { ok: false, motivo: 'antes-do-inicio' };
  if (A > CICLO_TOTAL_SEMANAS) return { ok: false, motivo: 'ciclo-encerrado' };
  const u = Number.isInteger(U) && U > 0 ? U : 0;
  // A recorded week ahead of the arrival week cannot happen while startDate is
  // immutable after the first check-in (D-AT). Refused rather than guessed.
  if (u > A) return { ok: false, motivo: 'historico-inconsistente' };
  if (u === A) return { ok: true, semana: A, correcao: true };
  if (u + 1 === A) return { ok: true, semana: A, correcao: false };
  if (u + 1 === A - 1) return { ok: true, semana: u + 1, correcao: false };
  return { ok: true, semana: A, correcao: false };
}

function temNoMaximoDecimais(v, casas) {
  const escala = 10 ** casas;
  // Tolerance absorbs binary representation noise (80.3 * 10 = 802.9999…).
  return Math.abs(v * escala - Math.round(v * escala)) <= 1e-6;
}

/**
 * F4-6. Validates the `measurements` map and returns it normalized: the four
 * keys always present, an absent optional one as null. Unknown keys are
 * refused — in particular any weight, which the check-in never carries (F4-4).
 */
function validarMedidas(m) {
  if (m === null || typeof m !== 'object' || Array.isArray(m)) {
    return { ok: false, erro: 'measurements precisa ser um mapa.' };
  }
  for (const chave of Object.keys(m)) {
    if (!Object.prototype.hasOwnProperty.call(MEDIDAS, chave)) {
      return { ok: false, erro: `measurements.${chave} não é aceito. Esperado: ${Object.keys(MEDIDAS).join(', ')}.` };
    }
  }
  const saida = {};
  for (const [chave, regra] of Object.entries(MEDIDAS)) {
    const v = m[chave];
    if (v === undefined || v === null) {
      if (regra.obrigatoria) return { ok: false, erro: `measurements.${chave} é obrigatória.` };
      saida[chave] = null;
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, erro: `measurements.${chave} precisa ser um número.` };
    }
    if (v < regra.min || v > regra.max) {
      return { ok: false, erro: `measurements.${chave} fora da faixa de ${regra.min} a ${regra.max} cm.` };
    }
    if (!temNoMaximoDecimais(v, MEDIDA_MAX_DECIMALS)) {
      return { ok: false, erro: `measurements.${chave} aceita no máximo ${MEDIDA_MAX_DECIMALS} casa decimal.` };
    }
    saida[chave] = v;
  }
  return { ok: true, valor: saida };
}

/**
 * Free text (F4-6; Addendum 04, R2): a string of at most 4,000 characters,
 * trimmed. `obrigatorio` false turns absent or blank into null.
 */
function validarTexto(v, campo, obrigatorio) {
  if (v === undefined || v === null) {
    return obrigatorio ? { ok: false, erro: `${campo} é obrigatório.` } : { ok: true, valor: null };
  }
  if (typeof v !== 'string') return { ok: false, erro: `${campo} precisa ser texto.` };
  const t = v.trim();
  if (!t) return obrigatorio ? { ok: false, erro: `${campo} não pode ser vazio.` } : { ok: true, valor: null };
  if (t.length > TEXTO_MAX_CHARS) {
    return { ok: false, erro: `${campo} excede o limite de ${TEXTO_MAX_CHARS} caracteres.` };
  }
  return { ok: true, valor: t };
}

/** Storage prefix of an athlete's check-in photos (F4-5). */
function prefixoFotos(athleteUid) {
  return `athletes/${athleteUid}/checkins/`;
}

/**
 * F4-5. Shape of the photo paths: an array (absent → empty) of at most five
 * paths, each `athletes/{uid}/checkins/{submission key}/{file}`, no path
 * traversal, no duplicates. Existence in the bucket is checked by the function,
 * which has the Storage client.
 */
function validarFotos(fotos, athleteUid) {
  if (fotos === undefined || fotos === null) return { ok: true, valor: [] };
  if (!Array.isArray(fotos)) return { ok: false, erro: 'photos precisa ser uma lista de caminhos.' };
  if (fotos.length > FOTOS_MAX) return { ok: false, erro: `photos aceita no máximo ${FOTOS_MAX} fotos.` };
  const prefixo = prefixoFotos(athleteUid);
  const vistos = new Set();
  for (const p of fotos) {
    if (typeof p !== 'string' || !p.startsWith(prefixo)) {
      return { ok: false, erro: 'photos só aceita caminhos na pasta de check-in do próprio atleta.' };
    }
    const resto = p.slice(prefixo.length).split('/');
    if (resto.length !== 2 || resto.some((s) => !s || s === '.' || s === '..')) {
      return { ok: false, erro: `caminho de foto inválido: ${p}` };
    }
    if (vistos.has(p)) return { ok: false, erro: `foto repetida: ${p}` };
    vistos.add(p);
  }
  return { ok: true, valor: fotos.slice() };
}

/**
 * F4-2b. Instant declared by the client, kept only as information (common
 * rule 5). Optional; when sent, it must be a parseable date. It never decides
 * the week nor the follow-up status.
 */
function validarDeclaradoEm(v) {
  if (v === undefined || v === null) return { ok: true, valor: null };
  if (typeof v !== 'string') return { ok: false, erro: 'declaredAt precisa ser texto no formato ISO 8601.' };
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return { ok: false, erro: 'declaredAt não é uma data válida.' };
  return { ok: true, valor: t };
}

/** Week document id sent by the Coach's panel. */
function validarSemanaId(v) {
  if (numeroDaSemana(v) === null) return { ok: false, erro: 'week precisa ser w01 a w13.' };
  return { ok: true };
}

module.exports = {
  CICLO_TOTAL_SEMANAS,
  MEDIDAS,
  MEDIDA_MAX_DECIMALS,
  TEXTO_MAX_CHARS,
  FOTOS_MAX,
  idDaSemana,
  numeroDaSemana,
  semanaDoCiclo,
  decidirSemana,
  validarMedidas,
  validarTexto,
  prefixoFotos,
  validarFotos,
  validarDeclaradoEm,
  validarSemanaId,
};
