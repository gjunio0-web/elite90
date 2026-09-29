// tests/checkin.test.js
// Pure rules of the weekly check-in (M2 Phase 4, persistence plan v5.23):
// cycle week of arrival, the week decision (F4-2, F4-3), measurements and text
// (F4-6), photo paths (F4-5), the declared instant (F4-2b) and week ids.
// Transactions, the actor check and traceability need Firestore and Auth, and
// are exercised in homologation by scripts/testar-checkin.mjs.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  idDaSemana,
  numeroDaSemana,
  semanaDoCiclo,
  decidirSemana,
  validarMedidas,
  validarTexto,
  validarFotos,
  validarDeclaradoEm,
  validarSemanaId,
} = require('../netlify/functions/_checkin.js');

test('week ids are zero-padded w01…w13 and round-trip', () => {
  assert.equal(idDaSemana(5), 'w05');
  assert.equal(idDaSemana(13), 'w13');
  assert.equal(numeroDaSemana('w05'), 5);
  for (const v of ['w00', 'w14', 'w5', 'W05', '05', null, 5]) assert.equal(numeroDaSemana(v), null, String(v));
  assert.equal(validarSemanaId('w13').ok, true);
  assert.equal(validarSemanaId('w14').ok, false);
});

test('cycle week of arrival: the start day is day 1 of week 1; not clamped', () => {
  assert.equal(semanaDoCiclo('2026-09-01', '2026-08-31'), 0); // before the start
  assert.equal(semanaDoCiclo('2026-09-01', '2026-09-01'), 1);
  assert.equal(semanaDoCiclo('2026-09-01', '2026-09-07'), 1);
  assert.equal(semanaDoCiclo('2026-09-01', '2026-09-08'), 2);
  assert.equal(semanaDoCiclo('2026-09-01', '2026-11-30'), 13); // day 91
  assert.equal(semanaDoCiclo('2026-09-01', '2026-12-01'), 14); // after the cycle
});

test('F4-2 · (1) U + 1 = A → new week A', () => {
  assert.deepEqual(decidirSemana(1, 0), { ok: true, semana: 1, correcao: false });
  assert.deepEqual(decidirSemana(6, 5), { ok: true, semana: 6, correcao: false });
});

test('F4-2 · (2) U = A → correction of week A (F4-3)', () => {
  assert.deepEqual(decidirSemana(6, 6), { ok: true, semana: 6, correcao: true });
});

test('F4-2 · (3) U + 1 = A − 1 → week U + 1 (one week late accepted)', () => {
  assert.deepEqual(decidirSemana(6, 4), { ok: true, semana: 5, correcao: false });
  assert.deepEqual(decidirSemana(2, 0), { ok: true, semana: 1, correcao: false });
});

test('F4-2 · (4) U + 1 < A − 1 → week A, skipped weeks stay empty', () => {
  assert.deepEqual(decidirSemana(6, 2), { ok: true, semana: 6, correcao: false });
  assert.deepEqual(decidirSemana(3, 0), { ok: true, semana: 3, correcao: false });
});

test('F4-2 · (5) before the start or after week 13 → refused', () => {
  assert.deepEqual(decidirSemana(0, 0), { ok: false, motivo: 'antes-do-inicio' });
  assert.deepEqual(decidirSemana(14, 12), { ok: false, motivo: 'ciclo-encerrado' });
  assert.deepEqual(decidirSemana(13, 12), { ok: true, semana: 13, correcao: false });
});

test('F4-2 · a recorded week ahead of the arrival week is refused (D-AT keeps it impossible)', () => {
  assert.deepEqual(decidirSemana(4, 6), { ok: false, motivo: 'historico-inconsistente' });
});

test('F4-6 · measurements: ranges, required waist and hip, one decimal, refused not rounded', () => {
  const ok = validarMedidas({ waistCm: 82.5, hipCm: 98 });
  assert.deepEqual(ok, { ok: true, valor: { waistCm: 82.5, hipCm: 98, armCm: null, chestCm: null } });
  assert.equal(validarMedidas({ waistCm: 40, hipCm: 50, armCm: 15, chestCm: 50 }).ok, true);
  assert.equal(validarMedidas({ waistCm: 200, hipCm: 200, armCm: 70, chestCm: 200 }).ok, true);
  assert.equal(validarMedidas({ waistCm: 80.3, hipCm: 98.1 }).ok, true); // binary noise tolerated
  const recusados = [
    { hipCm: 98 },                                    // waist missing
    { waistCm: 82 },                                  // hip missing
    { waistCm: 39.9, hipCm: 98 },
    { waistCm: 82, hipCm: 201 },
    { waistCm: 82, hipCm: 98, armCm: 14.9 },
    { waistCm: 82, hipCm: 98, chestCm: 200.1 },
    { waistCm: 82.25, hipCm: 98 },                    // two decimals
    { waistCm: '82', hipCm: 98 },
    { waistCm: 82, hipCm: 98, weightKg: 80 },         // F4-4: no weight in the check-in
    { waistCm: 82, hipCm: 98, thighCm: 60 },
  ];
  for (const m of recusados) assert.equal(validarMedidas(m).ok, false, JSON.stringify(m));
  for (const v of [null, [], 'x', undefined]) assert.equal(validarMedidas(v).ok, false, String(v));
});

test('F4-6 · free text: trimmed, up to 4,000 characters, optional or required', () => {
  assert.deepEqual(validarTexto(undefined, 'perception', false), { ok: true, valor: null });
  assert.deepEqual(validarTexto('   ', 'perception', false), { ok: true, valor: null });
  assert.deepEqual(validarTexto('  bem  ', 'perception', false), { ok: true, valor: 'bem' });
  assert.equal(validarTexto('x'.repeat(4000), 'text', true).ok, true);
  assert.equal(validarTexto('x'.repeat(4001), 'text', true).ok, false);
  assert.equal(validarTexto('', 'text', true).ok, false);
  assert.equal(validarTexto(undefined, 'text', true).ok, false);
  assert.equal(validarTexto(42, 'text', true).ok, false);
});

test('F4-5 · photos: own prefix, one key folder, at most five, no traversal, no repeats', () => {
  const u = 'abc123';
  const p = (k, f) => `athletes/${u}/checkins/${k}/${f}`;
  assert.deepEqual(validarFotos(undefined, u), { ok: true, valor: [] });
  assert.equal(validarFotos([p('k1', 'foto-1.webp'), p('k1', 'foto-2.webp')], u).ok, true);
  assert.equal(validarFotos([1, 2, 3, 4, 5].map((i) => p('k1', `foto-${i}.webp`)), u).ok, true);
  const recusados = [
    [1, 2, 3, 4, 5, 6].map((i) => p('k1', `foto-${i}.webp`)),   // six
    ['athletes/outro/checkins/k1/foto-1.webp'],                  // another athlete
    ['leads/x/foto-1.webp'],
    [`athletes/${u}/checkins/foto-1.webp`],                      // no key folder
    [`athletes/${u}/checkins/k1/sub/foto-1.webp`],               // too deep
    [`athletes/${u}/checkins/../k1/foto-1.webp`],
    [p('k1', 'foto-1.webp'), p('k1', 'foto-1.webp')],            // repeated
    [42],
  ];
  for (const f of recusados) assert.equal(validarFotos(f, u).ok, false, JSON.stringify(f));
  assert.equal(validarFotos('athletes/x', u).ok, false);
});

test('F4-2b · declared instant: optional, must parse, decides nothing', () => {
  assert.deepEqual(validarDeclaradoEm(undefined), { ok: true, valor: null });
  const r = validarDeclaradoEm('2026-09-28T14:00:00-03:00');
  assert.equal(r.ok, true);
  assert.equal(r.valor.toISOString(), '2026-09-28T17:00:00.000Z');
  assert.equal(validarDeclaradoEm('ontem').ok, false);
  assert.equal(validarDeclaradoEm(1727540000000).ok, false);
});
