// ELITE90 PRO · _avaliacao-fisica
// -----------------------------------------------------------------------------
// Pure rules of the physical evaluation — M2 Phase 6 (persistence plan v5.26;
// persistence schema v3, section 10, with its update note; Addendum 04 v1.12).
//
// WHY A COMMONJS MODULE
// Same arrangement as _checkin.js: the TypeScript functions import it (through
// _m2-validacao.ts), and the Node.js test runner loads it directly. Nothing here
// touches Firestore, the clock or the network: "today", the cycle start and the
// recorded history always come in as parameters.
//
// WHAT LIVES HERE (owner decisions of 30/09/2026, plan §4)
//   · O1 — the evaluation is biweekly. Its slot is the odd week S of a two-week
//     window: S = A when the arrival week A is odd, A − 1 when it is even. A
//     resend inside the window corrects S; a later arrival goes to the current
//     slot and the skipped slots stay empty. `semanaDoCiclo` of _checkin.js is
//     reused for A; `decidirSemana` is NOT — applied to biweekly slots it would
//     record a week-5 measurement as week 3.
//   · O2 — `measuredAt` is declared by the athlete, required, and decides
//     nothing. Its civil date is bounded by the D-AJ rules of the weight series
//     (not in the future, not before the cycle start); see _serie-peso.js.
//   · O4 — `measuredBy` says whether a professional or the athlete measured, and
//     whether it was the same rater as the previous evaluation. It never
//     identifies the rater: no name, no professional registration, no uid
//     (Addendum 04, note to R1; CE-12).
//   · Provisional validation until the Coach answers p09 to p11 (plan, Phase 6):
//     the 14 perimeters required; the 12 skinfolds as a complete block or null;
//     technical bounds against typing errors only; one decimal place; refused,
//     never rounded. Changing these after the answers is configuration of the
//     tables below, not new code.
// -----------------------------------------------------------------------------

'use strict';

const CICLO_TOTAL_SEMANAS = 13;

/**
 * The 14 perimeters of schema §10, in centimetres. Where a field coincides with
 * a check-in measurement, the F4-6 range is reused (chest, waist, hip, arms);
 * the others are technical bounds. Clinical plausibility is the Coach's (p11).
 */
const PERIMETROS = {
  shouldersCm: { min: 60, max: 200 },
  chestCm: { min: 50, max: 200 },
  waistAbdomenCm: { min: 40, max: 200 },
  hipCm: { min: 50, max: 200 },
  armLeftRelaxedCm: { min: 15, max: 70 },
  armLeftFlexedCm: { min: 15, max: 70 },
  armRightRelaxedCm: { min: 15, max: 70 },
  armRightFlexedCm: { min: 15, max: 70 },
  thighLeftProximalCm: { min: 25, max: 120 },
  thighLeftMedialCm: { min: 25, max: 120 },
  thighRightProximalCm: { min: 25, max: 120 },
  thighRightMedialCm: { min: 25, max: 120 },
  calfLeftCm: { min: 15, max: 70 },
  calfRightCm: { min: 15, max: 70 },
};

/** The 12 skinfolds of schema §10, in millimetres. Same technical bound for all. */
const DOBRAS = {
  tricepsLeftMm: { min: 1, max: 80 },
  tricepsRightMm: { min: 1, max: 80 },
  subscapularMm: { min: 1, max: 80 },
  suprailiacMm: { min: 1, max: 80 },
  abdominalMm: { min: 1, max: 80 },
  pectoralMm: { min: 1, max: 80 },
  bicepsLeftMm: { min: 1, max: 80 },
  bicepsRightMm: { min: 1, max: 80 },
  thighLeftMm: { min: 1, max: 80 },
  thighRightMm: { min: 1, max: 80 },
  calfLeftMm: { min: 1, max: 80 },
  calfRightMm: { min: 1, max: 80 },
};

const MEDIDA_MAX_DECIMALS = 1;

/** Who measured (O4). Closed. */
const MEASURED_BY_TYPES = ['professional', 'self'];

/**
 * Weight never travels with the evaluation: it has its own daily series
 * (schema §7). A body carrying it is REFUSED, never silently ignored — the
 * caller would believe it was recorded. Same rule as the check-in (F4-4).
 */
const CAMPOS_DE_PESO = ['weightKg', 'weight', 'peso'];

/** Odd cycle weeks: the slots of the biweekly evaluation (1, 3, 5 … 13). */
const SEMANAS_DE_AVALIACAO = [1, 3, 5, 7, 9, 11, 13];

function ehSemanaDeAvaliacao(n) {
  return SEMANAS_DE_AVALIACAO.includes(n);
}

/**
 * O1. Slot of an evaluation arriving in cycle week `A`, given the last recorded
 * evaluation week `U` (0 when there is none).
 *   S = A when A is odd, A − 1 when A is even (two-week window);
 *   U < S → new evaluation in S (skipped slots stay empty);
 *   U = S → correction of S (O3: only inside the window);
 *   U > S → refused, inconsistent history (D-AT keeps it impossible);
 *   A < 1 → refused, before the start; A > 13 → refused, cycle over (week 13
 *   is a one-week window, because week 14 is outside the cycle).
 *
 * Returns { ok: true, semana, correcao } or { ok: false, motivo }.
 */
function decidirVagaAvaliacao(A, U) {
  if (!Number.isInteger(A) || A < 1) return { ok: false, motivo: 'antes-do-inicio' };
  if (A > CICLO_TOTAL_SEMANAS) return { ok: false, motivo: 'ciclo-encerrado' };
  const S = A % 2 === 1 ? A : A - 1;
  const u = Number.isInteger(U) && U > 0 ? U : 0;
  if (u > S) return { ok: false, motivo: 'historico-inconsistente' };
  if (u === S) return { ok: true, semana: S, correcao: true };
  return { ok: true, semana: S, correcao: false };
}

function temNoMaximoDecimais(v, casas) {
  const escala = 10 ** casas;
  // Tolerance absorbs binary representation noise (80.3 * 10 = 802.9999…).
  return Math.abs(v * escala - Math.round(v * escala)) <= 1e-6;
}

/**
 * Validates one block of measurements against its table. Every key of the
 * table is required; any other key is refused. Returns the block normalized
 * (same keys, same values) so the stored map never carries anything else.
 */
function validarBloco(m, tabela, nomeBloco, unidade) {
  if (m === null || typeof m !== 'object' || Array.isArray(m)) {
    return { ok: false, erro: `${nomeBloco} precisa ser um mapa.` };
  }
  for (const chave of Object.keys(m)) {
    if (!Object.prototype.hasOwnProperty.call(tabela, chave)) {
      return { ok: false, erro: `${nomeBloco}.${chave} não é aceito.` };
    }
  }
  const saida = {};
  for (const [chave, regra] of Object.entries(tabela)) {
    const v = m[chave];
    if (v === undefined || v === null) {
      return { ok: false, erro: `${nomeBloco}.${chave} é obrigatório.` };
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, erro: `${nomeBloco}.${chave} precisa ser um número.` };
    }
    if (v < regra.min || v > regra.max) {
      return { ok: false, erro: `${nomeBloco}.${chave} fora da faixa de ${regra.min} a ${regra.max} ${unidade}.` };
    }
    if (!temNoMaximoDecimais(v, MEDIDA_MAX_DECIMALS)) {
      return { ok: false, erro: `${nomeBloco}.${chave} aceita no máximo ${MEDIDA_MAX_DECIMALS} casa decimal.` };
    }
    saida[chave] = v;
  }
  return { ok: true, valor: saida };
}

/** The 14 perimeters: all required (provisional, p09). */
function validarPerimetros(m) {
  return validarBloco(m, PERIMETROS, 'perimeters', 'cm');
}

/**
 * The 12 skinfolds: a complete block, or absent/null (provisional, p09 and
 * p10 — if the Coach answers "monthly", every other evaluation comes without
 * them). A partial block is refused: a body-fat formula needs its full set.
 */
function validarDobras(m) {
  if (m === undefined || m === null) return { ok: true, valor: null };
  return validarBloco(m, DOBRAS, 'skinfolds', 'mm');
}

/**
 * O4. `measuredBy` = { type, sameAsPrevious }, and nothing else — any other key
 * (a name, a registration number, a uid) is refused (CE-12). `sameAsPrevious`
 * is null on the first evaluation, when there is nothing to compare with, and
 * a boolean otherwise. `haAnterior` says whether an evaluation exists before
 * the target week.
 */
function validarMedidoPor(v, haAnterior) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return { ok: false, erro: 'measuredBy precisa ser um mapa { type, sameAsPrevious }.' };
  }
  for (const chave of Object.keys(v)) {
    if (chave !== 'type' && chave !== 'sameAsPrevious') {
      return { ok: false, erro: `measuredBy.${chave} não é aceito: o avaliador não é identificado (O4).` };
    }
  }
  if (!MEASURED_BY_TYPES.includes(v.type)) {
    return { ok: false, erro: `measuredBy.type inválido. Esperado um de: ${MEASURED_BY_TYPES.join(', ')}.` };
  }
  const igual = v.sameAsPrevious === undefined ? null : v.sameAsPrevious;
  if (!haAnterior) {
    if (igual !== null) {
      return { ok: false, erro: 'measuredBy.sameAsPrevious deve ser nulo na primeira avaliação.' };
    }
  } else if (typeof igual !== 'boolean') {
    return { ok: false, erro: 'measuredBy.sameAsPrevious precisa ser verdadeiro ou falso: há avaliação anterior.' };
  }
  return { ok: true, valor: { type: v.type, sameAsPrevious: igual } };
}

/**
 * O2. Shape of `measuredAt`: an ISO 8601 date-time (with time of day — a bare
 * AAAA-MM-DD would be read as UTC midnight and land on the previous civil day
 * in Brasília). Required. Its bounds are checked by the caller on the civil
 * date, with the D-AJ rules of _serie-peso.js.
 */
function validarMedidoEm(v) {
  if (v === undefined || v === null) return { ok: false, erro: 'measuredAt é obrigatório.' };
  if (typeof v !== 'string' || !v.includes('T')) {
    return { ok: false, erro: 'measuredAt precisa ser data e hora no formato ISO 8601.' };
  }
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return { ok: false, erro: 'measuredAt não é uma data válida.' };
  return { ok: true, valor: t };
}

/** Weight never travels with the evaluation (see CAMPOS_DE_PESO). */
function validarSemPesoAvaliacao(corpo) {
  for (const campo of CAMPOS_DE_PESO) {
    if (corpo && Object.prototype.hasOwnProperty.call(corpo, campo)) {
      return {
        ok: false,
        erro: 'A avaliação física não aceita peso. O peso é registrado pela série diária (registrar-peso).',
      };
    }
  }
  return { ok: true };
}

module.exports = {
  CICLO_TOTAL_SEMANAS,
  PERIMETROS,
  DOBRAS,
  MEDIDA_MAX_DECIMALS,
  MEASURED_BY_TYPES,
  CAMPOS_DE_PESO,
  SEMANAS_DE_AVALIACAO,
  ehSemanaDeAvaliacao,
  decidirVagaAvaliacao,
  validarPerimetros,
  validarDobras,
  validarMedidoPor,
  validarMedidoEm,
  validarSemPesoAvaliacao,
};
