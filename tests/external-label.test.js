// tests/external-label.test.js
// First automated test of the repository. Runs with the Node.js built-in
// runner (`node --test tests/`), no new dependency.
//
// Covers the pure module only. Collision handling needs Firestore and is
// verified against the homologation project (CA-15, CA-17); the acceptance
// criterion this file guards is CA-25 (Adendo 02): every generated label
// matches `ATL-` + four symbols of the 31-symbol alphabet, and none contains
// I, L, O, 0 or 1.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXTERNAL_LABEL_ALPHABET,
  EXTERNAL_LABEL_PATTERN,
  gerarExternalLabel,
  isExternalLabel,
} = require('../netlify/functions/_external-label.js');

test('alphabet has 31 symbols and none of the ambiguous ones', () => {
  assert.equal(EXTERNAL_LABEL_ALPHABET.length, 31);
  assert.equal(new Set(EXTERNAL_LABEL_ALPHABET).size, 31);
  for (const proibido of ['I', 'L', 'O', '0', '1']) {
    assert.ok(!EXTERNAL_LABEL_ALPHABET.includes(proibido), `alphabet must not contain ${proibido}`);
  }
});

test('every generated label matches the stored form (CA-25)', () => {
  for (let i = 0; i < 10000; i++) {
    const rotulo = gerarExternalLabel();
    assert.match(rotulo, EXTERNAL_LABEL_PATTERN);
    assert.ok(isExternalLabel(rotulo));
    // The fixed prefix contains an L by design; the rule is about the drawn part.
    assert.doesNotMatch(rotulo.slice('ATL-'.length), /[ILO01]/);
  }
});

test('the draw is deterministic when the random source is injected', () => {
  const primeiro = gerarExternalLabel(() => 0);
  const ultimo = gerarExternalLabel((max) => max - 1);
  assert.equal(primeiro, 'ATL-2222');
  assert.equal(ultimo, 'ATL-ZZZZ');
});

test('isExternalLabel rejects everything that is not the exact stored form', () => {
  for (const v of ['7K2M', 'atl-7K2M', 'ATL-7K2', 'ATL-7K2MX', 'ATL-7K0M', 'ATL-7KIM', 'ATL-7K1M', '', null, undefined, 42]) {
    assert.equal(isExternalLabel(v), false, `should reject ${String(v)}`);
  }
});
