// _external-label.js
// External label of the athlete (`externalLabel`), as fixed by Adendo 02 —
// Delegação (section 5.1, decision AD-04):
//
//   - fixed prefix `ATL-`, followed by four characters;
//   - alphabet of 31 symbols, with the visually ambiguous pairs removed
//     (I, L, O, 0, 1) so the code survives being spoken or handwritten;
//   - stored WITH the prefix, never composed at display time;
//   - drawn at random (never sequential), immutable once assigned.
//
// The label exists for the external delegate, who sees it INSTEAD of the
// athlete's name (D-14). It is not the document id: that is the auth uid, and
// must never be handed to a third party.
//
// PURE MODULE, CommonJS, no dependencies beyond node:crypto — shared by
// promote-lead.ts (the only production path that promotes), by the
// homologation runner scripts/emulate-fn08.js, and by the one-off backfill
// script. Same reasoning as _athlete-from-lead.js: one contract, imported by
// everyone, instead of a copy per caller that drifts in silence.
//
// What this module deliberately does NOT do: check for collisions. That needs
// the database, and callers already hold a Firestore handle; the draw-check-
// retry loop lives next to the write (promote-lead.ts).
//
// The "_" prefix follows the _scoring.ts convention: not a Netlify endpoint,
// only a shared module.

'use strict';

const { randomInt } = require('node:crypto');

const EXTERNAL_LABEL_PREFIX = 'ATL-';
// 31 symbols. Removed on purpose: I, L, O, 0, 1.
const EXTERNAL_LABEL_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const EXTERNAL_LABEL_LENGTH = 4;
// Built from the constants above so there is exactly one place that defines
// the shape. 31^4 = 923,521 combinations.
const EXTERNAL_LABEL_PATTERN = new RegExp(
  '^' + EXTERNAL_LABEL_PREFIX + '[' + EXTERNAL_LABEL_ALPHABET + ']{' + EXTERNAL_LABEL_LENGTH + '}$'
);

/**
 * Draws one label, e.g. "ATL-7K2M". Uses a cryptographic source by default;
 * `rand` is injectable so tests can make the draw deterministic.
 * @param {(max: number) => number} [rand] - returns an integer in [0, max)
 * @returns {string}
 */
function gerarExternalLabel(rand = randomInt) {
  let sufixo = '';
  for (let i = 0; i < EXTERNAL_LABEL_LENGTH; i++) {
    sufixo += EXTERNAL_LABEL_ALPHABET[rand(EXTERNAL_LABEL_ALPHABET.length)];
  }
  return EXTERNAL_LABEL_PREFIX + sufixo;
}

/**
 * True when `v` has the exact stored form (prefix included).
 * @param {*} v
 * @returns {boolean}
 */
function isExternalLabel(v) {
  return typeof v === 'string' && EXTERNAL_LABEL_PATTERN.test(v);
}

module.exports = {
  EXTERNAL_LABEL_PREFIX,
  EXTERNAL_LABEL_ALPHABET,
  EXTERNAL_LABEL_LENGTH,
  EXTERNAL_LABEL_PATTERN,
  gerarExternalLabel,
  isExternalLabel,
};
