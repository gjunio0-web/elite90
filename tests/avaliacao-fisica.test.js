// tests/avaliacao-fisica.test.js
// Pure rules of the physical evaluation (M2 Phase 6, persistence plan v5.26):
// the biweekly slot (O1), the provisional measurement validation, measuredBy
// (O4), measuredAt (O2) and the weight refusal. Transactions, the actor check
// and traceability need Firestore and Auth, and are exercised in homologation
// by scripts/testar-avaliacao-relatorio.mjs.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERIMETROS,
  DOBRAS,
  SEMANAS_DE_AVALIACAO,
  ehSemanaDeAvaliacao,
  decidirVagaAvaliacao,
  validarPerimetros,
  validarDobras,
  validarMedidoPor,
  validarMedidoEm,
  validarSemPesoAvaliacao,
} = require('../netlify/functions/_avaliacao-fisica.js');
const { semanaDoCiclo } = require('../netlify/functions/_checkin.js');
const { dataCivilNoFuso, validarMeasuredOn, validarInicioCiclo } = require('../netlify/functions/_serie-peso.js');

const perimetrosOk = () => ({
  shouldersCm: 118.5, chestCm: 104, waistAbdomenCm: 86.2, hipCm: 99,
  armLeftRelaxedCm: 36, armLeftFlexedCm: 39.5, armRightRelaxedCm: 36.4, armRightFlexedCm: 40,
  thighLeftProximalCm: 60, thighLeftMedialCm: 55, thighRightProximalCm: 60.5, thighRightMedialCm: 55.2,
  calfLeftCm: 38, calfRightCm: 38.3,
});
const dobrasOk = () => Object.fromEntries(Object.keys(DOBRAS).map((k, i) => [k, 5 + i * 1.5]));

test('the schema §10 field lists: 14 perimeters, 12 skinfolds', () => {
  assert.equal(Object.keys(PERIMETROS).length, 14);
  assert.equal(Object.keys(DOBRAS).length, 12);
  assert.deepEqual(Object.keys(perimetrosOk()).sort(), Object.keys(PERIMETROS).sort());
});

test('O1 · evaluation slots are the odd weeks 1 to 13', () => {
  assert.deepEqual(SEMANAS_DE_AVALIACAO, [1, 3, 5, 7, 9, 11, 13]);
  assert.equal(ehSemanaDeAvaliacao(5), true);
  assert.equal(ehSemanaDeAvaliacao(6), false);
});

test('O1 · odd arrival week → slot A; even arrival week → slot A − 1 (two-week window)', () => {
  assert.deepEqual(decidirVagaAvaliacao(1, 0), { ok: true, semana: 1, correcao: false });
  assert.deepEqual(decidirVagaAvaliacao(2, 0), { ok: true, semana: 1, correcao: false });
  assert.deepEqual(decidirVagaAvaliacao(3, 1), { ok: true, semana: 3, correcao: false });
  assert.deepEqual(decidirVagaAvaliacao(4, 1), { ok: true, semana: 3, correcao: false });
});

test('O1 + O3 · a resend inside the window corrects the same slot', () => {
  assert.deepEqual(decidirVagaAvaliacao(1, 1), { ok: true, semana: 1, correcao: true });
  assert.deepEqual(decidirVagaAvaliacao(2, 1), { ok: true, semana: 1, correcao: true });
  assert.deepEqual(decidirVagaAvaliacao(6, 5), { ok: true, semana: 5, correcao: true });
});

test('O1 · late beyond the window → current slot; the skipped slots stay empty (never shifted back)', () => {
  // The week-5 measurement is never recorded as week 3, which is what
  // decidirSemana applied to slots would have done.
  assert.deepEqual(decidirVagaAvaliacao(5, 1), { ok: true, semana: 5, correcao: false });
  assert.deepEqual(decidirVagaAvaliacao(8, 1), { ok: true, semana: 7, correcao: false });
  assert.deepEqual(decidirVagaAvaliacao(3, 0), { ok: true, semana: 3, correcao: false });
});

test('O1 · week 13 is a one-week window; before the start or after the cycle → refused', () => {
  assert.deepEqual(decidirVagaAvaliacao(13, 11), { ok: true, semana: 13, correcao: false });
  assert.deepEqual(decidirVagaAvaliacao(13, 13), { ok: true, semana: 13, correcao: true });
  assert.deepEqual(decidirVagaAvaliacao(14, 13), { ok: false, motivo: 'ciclo-encerrado' });
  assert.deepEqual(decidirVagaAvaliacao(0, 0), { ok: false, motivo: 'antes-do-inicio' });
  assert.deepEqual(decidirVagaAvaliacao(-2, 0), { ok: false, motivo: 'antes-do-inicio' });
});

test('O1 · a recorded slot ahead of the arrival slot is refused (D-AT keeps it impossible)', () => {
  assert.deepEqual(decidirVagaAvaliacao(4, 5), { ok: false, motivo: 'historico-inconsistente' });
});

test('O1 · with the real cycle-week function: day 8 to 14 is week 2, which is slot 1', () => {
  const A = semanaDoCiclo('2026-09-01', '2026-09-10');
  assert.equal(A, 2);
  assert.deepEqual(decidirVagaAvaliacao(A, 0), { ok: true, semana: 1, correcao: false });
});

test('perimeters · all 14 required, ranges, one decimal, refused not rounded, unknown keys refused', () => {
  const ok = validarPerimetros(perimetrosOk());
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.valor, perimetrosOk());
  assert.equal(validarPerimetros({ ...perimetrosOk(), waistAbdomenCm: 80.3 }).ok, true); // binary noise tolerated
  const recusados = [
    (() => { const m = perimetrosOk(); delete m.calfRightCm; return m; })(),  // missing
    { ...perimetrosOk(), shouldersCm: 59.9 },
    { ...perimetrosOk(), hipCm: 200.1 },
    { ...perimetrosOk(), armLeftFlexedCm: 14.9 },
    { ...perimetrosOk(), thighLeftMedialCm: 121 },
    { ...perimetrosOk(), chestCm: 104.25 },                                  // two decimals
    { ...perimetrosOk(), chestCm: '104' },
    { ...perimetrosOk(), neckCm: 40 },                                       // unknown
    { ...perimetrosOk(), weightKg: 80 },                                     // weight inside
  ];
  for (const m of recusados) assert.equal(validarPerimetros(m).ok, false, JSON.stringify(m));
  for (const v of [null, undefined, [], 'x']) assert.equal(validarPerimetros(v).ok, false, String(v));
});

test('skinfolds · complete block or null; partial block refused; 1–80 mm, one decimal', () => {
  assert.deepEqual(validarDobras(undefined), { ok: true, valor: null });
  assert.deepEqual(validarDobras(null), { ok: true, valor: null });
  assert.equal(validarDobras(dobrasOk()).ok, true);
  const parcial = dobrasOk(); delete parcial.pectoralMm;
  assert.equal(validarDobras(parcial).ok, false);
  assert.equal(validarDobras({ ...dobrasOk(), abdominalMm: 0.9 }).ok, false);
  assert.equal(validarDobras({ ...dobrasOk(), abdominalMm: 80.1 }).ok, false);
  assert.equal(validarDobras({ ...dobrasOk(), abdominalMm: 12.25 }).ok, false);
  assert.equal(validarDobras({ ...dobrasOk(), chestMm: 10 }).ok, false);
  assert.equal(validarDobras([]).ok, false);
});

test('O4 · measuredBy identifies no one: { type, sameAsPrevious } and nothing else', () => {
  assert.deepEqual(validarMedidoPor({ type: 'professional', sameAsPrevious: null }, false),
    { ok: true, valor: { type: 'professional', sameAsPrevious: null } });
  assert.deepEqual(validarMedidoPor({ type: 'self' }, false),
    { ok: true, valor: { type: 'self', sameAsPrevious: null } });
  assert.deepEqual(validarMedidoPor({ type: 'professional', sameAsPrevious: false }, true),
    { ok: true, valor: { type: 'professional', sameAsPrevious: false } });
  const recusados = [
    [{ type: 'professional', sameAsPrevious: null, name: 'Fulano' }, false],   // CE-12
    [{ type: 'professional', sameAsPrevious: null, councilNumber: '123' }, false],
    [{ type: 'professional', sameAsPrevious: null, uid: 'x' }, false],
    [{ type: 'coach', sameAsPrevious: null }, false],
    [{ type: 'professional', sameAsPrevious: true }, false],                    // first: must be null
    [{ type: 'professional', sameAsPrevious: null }, true],                     // later: must be boolean
    [{ type: 'professional', sameAsPrevious: 'sim' }, true],
    [null, false], [[], false], ['professional', false],
  ];
  for (const [v, ant] of recusados) assert.equal(validarMedidoPor(v, ant).ok, false, JSON.stringify(v) + ant);
});

test('O2 · measuredAt: required ISO date-time; decides nothing; its civil date follows D-AJ', () => {
  assert.equal(validarMedidoEm(undefined).ok, false);
  assert.equal(validarMedidoEm('2026-09-10').ok, false);           // no time of day
  assert.equal(validarMedidoEm('ontem').ok, false);
  assert.equal(validarMedidoEm(1727540000000).ok, false);
  const r = validarMedidoEm('2026-09-10T08:30:00-03:00');
  assert.equal(r.ok, true);
  assert.equal(r.valor.toISOString(), '2026-09-10T11:30:00.000Z');
  // The bounds are the weight-series rules, applied to the civil date in Brasília.
  const civil = dataCivilNoFuso(r.valor, 'America/Sao_Paulo');
  assert.equal(civil, '2026-09-10');
  const agora = new Date('2026-09-11T12:00:00Z');
  assert.equal(validarMeasuredOn(civil, agora).ok, true);
  assert.equal(validarMeasuredOn('2026-09-13', agora).ok, false);  // future
  assert.equal(validarInicioCiclo(civil, '2026-09-01').ok, true);
  assert.equal(validarInicioCiclo('2026-08-31', '2026-09-01').ok, false);
});

test('weight never travels with the evaluation', () => {
  assert.equal(validarSemPesoAvaliacao({ perimeters: {} }).ok, true);
  for (const campo of ['weightKg', 'weight', 'peso']) {
    assert.equal(validarSemPesoAvaliacao({ [campo]: 80 }).ok, false, campo);
  }
});
