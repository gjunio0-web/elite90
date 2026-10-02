// tests/relatorio.test.js
// Pure rules of the weekly evolution report (M2 Phase 6, persistence plan
// v5.26): writable weeks (O9), the four prose texts (R2, O5), server-only
// fields, the identical-text rule (O7) and the RP-1 fields present and empty
// (O6, O10; Addendum 10 v1.4, CP-24).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TEXTOS_RELATORIO,
  semanaDoRelatorioPermitida,
  validarTextoRelatorio,
  validarTextosRelatorio,
  temAlgumTexto,
  textosIguais,
  camposIniciaisRelatorio,
} = require('../netlify/functions/_relatorio.js');

test('O9 · weeks 1 to min(A, 13) are writable; future weeks are not', () => {
  assert.equal(semanaDoRelatorioPermitida(1, 1), true);
  assert.equal(semanaDoRelatorioPermitida(5, 5), true);
  assert.equal(semanaDoRelatorioPermitida(4, 5), true);
  assert.equal(semanaDoRelatorioPermitida(6, 5), false);
  assert.equal(semanaDoRelatorioPermitida(13, 20), true);   // after the cycle: still up to 13
  assert.equal(semanaDoRelatorioPermitida(14, 20), false);
  assert.equal(semanaDoRelatorioPermitida(1, 0), false);    // before the start
  assert.equal(semanaDoRelatorioPermitida(0, 5), false);
});

test('texts · trimmed, blank → null, at most 4,000 characters, never coerced', () => {
  assert.deepEqual(validarTextoRelatorio(undefined, 'diagnosis'), { ok: true, valor: null });
  assert.deepEqual(validarTextoRelatorio('   ', 'diagnosis'), { ok: true, valor: null });
  assert.deepEqual(validarTextoRelatorio('  ok  ', 'diagnosis'), { ok: true, valor: 'ok' });
  assert.equal(validarTextoRelatorio('x'.repeat(4000), 'diagnosis').ok, true);
  assert.equal(validarTextoRelatorio('x'.repeat(4001), 'diagnosis').ok, false);
  assert.equal(validarTextoRelatorio(42, 'diagnosis').ok, false);
  assert.equal(validarTextoRelatorio(['a'], 'causalLinks').ok, false);   // O5: one text, never an array
});

test('body · the four texts normalized; server-only fields refused', () => {
  const r = validarTextosRelatorio({ diagnosis: ' Boa semana. ', causalLinks: 'Sono → energia.' });
  assert.deepEqual(r, {
    ok: true,
    valor: { diagnosis: 'Boa semana.', trainingAdjustments: null, nutritionAdjustments: null, causalLinks: 'Sono → energia.' },
  });
  for (const campo of ['status', 'generatedBy', 'aiOriginalDraft', 'alerts', 'hypotheses', 'coachAudioPaths', 'publishedBy']) {
    assert.equal(validarTextosRelatorio({ diagnosis: 'x', [campo]: 'y' }).ok, false, campo);
  }
  assert.equal(validarTextosRelatorio(null).ok, false);
});

test('publishing needs at least one text', () => {
  assert.equal(temAlgumTexto({ diagnosis: null, trainingAdjustments: null, nutritionAdjustments: null, causalLinks: null }), false);
  assert.equal(temAlgumTexto({ diagnosis: null, trainingAdjustments: null, nutritionAdjustments: 'x', causalLinks: null }), true);
});

test('O7 · identical texts are detected (absent stored field counts as null)', () => {
  const t = { diagnosis: 'a', trainingAdjustments: null, nutritionAdjustments: 'b', causalLinks: null };
  assert.equal(textosIguais({ diagnosis: 'a', nutritionAdjustments: 'b' }, t), true);
  assert.equal(textosIguais({ diagnosis: 'a', nutritionAdjustments: 'c' }, t), false);
  assert.equal(textosIguais(null, { diagnosis: null, trainingAdjustments: null, nutritionAdjustments: null, causalLinks: null }), true);
});

test('RP-1 · structured layer and provenance present and empty; no audio paths; no free text in arrays', () => {
  const c = camposIniciaisRelatorio();
  assert.deepEqual(c.alerts, []);
  assert.deepEqual(c.hypotheses, []);
  assert.deepEqual(c.adjustments, []);
  assert.equal(c.expectation, null);
  assert.equal(c.coachInputText, null);
  assert.equal(c.coachAudioTranscript, null);
  assert.equal(c.generatedBy, 'coach');
  assert.equal(c.aiOriginalDraft, null);
  assert.equal(c.promptVersion, null);
  assert.equal(c.modelVersion, null);
  assert.deepEqual(c.coachInputRefs, []);
  assert.equal('coachAudioPaths' in c, false);   // O10
  // A fresh object every call: no caller can share and mutate the arrays.
  c.alerts.push({ code: 'x', status: 'open' });
  assert.deepEqual(camposIniciaisRelatorio().alerts, []);
  assert.deepEqual(TEXTOS_RELATORIO, ['diagnosis', 'trainingAdjustments', 'nutritionAdjustments', 'causalLinks']);
});
