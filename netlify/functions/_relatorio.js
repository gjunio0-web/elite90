// ELITE90 PRO · _relatorio
// -----------------------------------------------------------------------------
// Pure rules of the weekly evolution report — M2 Phase 6 (persistence plan
// v5.26; persistence schema v3, section 9, with its update note; Addendum 10
// v1.4, RP-1 and the reservations of its §4; Addendum 04 v1.12, R2.1).
//
// WHY A COMMONJS MODULE
// Same arrangement as _checkin.js and _avaliacao-fisica.js: imported by the
// TypeScript functions through _m2-validacao.ts and loaded directly by the
// Node.js test runner. No Firestore, no clock, no network.
//
// WHAT LIVES HERE (owner decisions of 30/09/2026, plan §4)
//   · The four prose texts the Coach writes — diagnosis, training and
//     nutrition adjustments, causal links — each a single named text field
//     (R2). `causalLinks` is ONE text, not an array (O5, R2.1).
//   · O9 — the Coach writes reports for weeks 1 to min(A, 13), A being the
//     cycle week now. A future week is refused.
//   · O6, O10 — the structured layer and the provenance are present from the
//     first write and empty: no free text in any array (CP-24), no AI output,
//     no audio (coachAudioPaths is never created).
//   · O7 — an identical text changes nothing: it neither writes nor emits.
// -----------------------------------------------------------------------------

'use strict';

const CICLO_TOTAL_SEMANAS = 13;

/** Limit of each text, the same as the check-in texts (F4-6). */
const TEXTO_MAX_CHARS = 4000;

/** The four prose texts of the report, in the order the panel shows them. */
const TEXTOS_RELATORIO = ['diagnosis', 'trainingAdjustments', 'nutritionAdjustments', 'causalLinks'];

const STATUS_RELATORIO = ['draft', 'published'];

/**
 * O9. Is week `w` (1…13) writable when the cycle week now is `A`? Weeks after
 * min(A, 13) have not happened yet. A < 1 means the cycle has not started:
 * every week is in the future.
 */
function semanaDoRelatorioPermitida(w, A) {
  if (!Number.isInteger(w) || w < 1 || w > CICLO_TOTAL_SEMANAS) return false;
  if (!Number.isInteger(A) || A < 1) return false;
  return w <= Math.min(A, CICLO_TOTAL_SEMANAS);
}

/**
 * One prose text: absent, null or blank → null; otherwise a trimmed string of
 * at most 4,000 characters. Never coerced: a number or an array is refused.
 */
function validarTextoRelatorio(v, campo) {
  if (v === undefined || v === null) return { ok: true, valor: null };
  if (typeof v !== 'string') return { ok: false, erro: `${campo} precisa ser texto.` };
  const t = v.trim();
  if (!t) return { ok: true, valor: null };
  if (t.length > TEXTO_MAX_CHARS) {
    return { ok: false, erro: `${campo} excede o limite de ${TEXTO_MAX_CHARS} caracteres.` };
  }
  return { ok: true, valor: t };
}

/**
 * The four texts of a call body, normalized. Any other report field sent by the
 * caller (status, generatedBy, the structured layer, provenance, audio) is
 * REFUSED: those are written by the server only, and a client sending them
 * would believe it had set them.
 */
const CAMPOS_SO_DO_SERVIDOR = [
  'status', 'cycleWeek', 'alerts', 'hypotheses', 'adjustments', 'expectation',
  'coachInputText', 'coachAudioTranscript', 'coachAudioPaths', 'generatedBy',
  'aiOriginalDraft', 'promptVersion', 'modelVersion', 'coachInputRefs',
  'publishedAt', 'publishedBy', 'updatedAt', '_test',
];

function validarTextosRelatorio(corpo) {
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { ok: false, erro: 'Corpo inválido.' };
  }
  for (const campo of CAMPOS_SO_DO_SERVIDOR) {
    if (Object.prototype.hasOwnProperty.call(corpo, campo)) {
      return { ok: false, erro: `${campo} não é aceito: é gravado só pelo servidor.` };
    }
  }
  const textos = {};
  for (const campo of TEXTOS_RELATORIO) {
    const r = validarTextoRelatorio(corpo[campo], campo);
    if (!r.ok) return r;
    textos[campo] = r.valor;
  }
  return { ok: true, valor: textos };
}

/** A report can only be published with at least one of the four texts. */
function temAlgumTexto(textos) {
  return TEXTOS_RELATORIO.some((c) => typeof textos[c] === 'string' && textos[c].length > 0);
}

/** O7. True when the stored texts are exactly the new ones. */
function textosIguais(armazenado, textos) {
  return TEXTOS_RELATORIO.every((c) => (armazenado && armazenado[c] != null ? armazenado[c] : null) === textos[c]);
}

/**
 * Fields present from the first write of a report and empty in Phase 6 —
 * RP-1 with the reservations of Addendum 10 v1.4, §4 (O5, O6, O10). Returns a
 * fresh object each call, so no caller can share and mutate the arrays.
 * `coachAudioPaths` is deliberately absent: replaced by coachAudio/,
 * coachInputs/ and coachInputRefs (expansion §12, adopted).
 */
function camposIniciaisRelatorio() {
  return {
    alerts: [],
    hypotheses: [],
    adjustments: [],
    expectation: null,
    coachInputText: null,
    coachAudioTranscript: null,
    generatedBy: 'coach',
    aiOriginalDraft: null,
    promptVersion: null,
    modelVersion: null,
    coachInputRefs: [],
  };
}

module.exports = {
  CICLO_TOTAL_SEMANAS,
  TEXTO_MAX_CHARS,
  TEXTOS_RELATORIO,
  STATUS_RELATORIO,
  CAMPOS_SO_DO_SERVIDOR,
  semanaDoRelatorioPermitida,
  validarTextoRelatorio,
  validarTextosRelatorio,
  temAlgumTexto,
  textosIguais,
  camposIniciaisRelatorio,
};
