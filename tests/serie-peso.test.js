// tests/serie-peso.test.js
// Pure rules of the daily weight series (M2 Phase 3, persistence plan):
// shape of weightKg and measuredOn, the cycle-start lower bound, and the
// 7-day moving average over a calendar window. Transactions, the actor check
// and traceability need Firestore and Auth, and are exercised in homologation
// by scripts/testar-serie-peso.mjs.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDataCivil,
  dataCivilDoInicio,
  limiteSuperiorMeasuredOn,
  validarPesoKg,
  validarMeasuredOn,
  validarInicioCiclo,
  calcularMediaMovel,
} = require('../netlify/functions/_serie-peso.js');

test('isDataCivil accepts real dates and rejects impossible or malformed ones', () => {
  assert.equal(isDataCivil('2026-09-25'), true);
  assert.equal(isDataCivil('2028-02-29'), true);
  for (const v of ['2026-02-30', '2026-13-01', '2026-9-25', '25/09/2026', '', null, 20260925]) {
    assert.equal(isDataCivil(v), false, String(v));
  }
});

test('weightKg: 30 to 300 kg, at most 2 decimals, rejected rather than rounded', () => {
  for (const v of [30, 300, 85.5, 85.35, 72.05]) assert.equal(validarPesoKg(v).ok, true, String(v));
  for (const v of [29.99, 300.01, 85.123, NaN, Infinity, '85', null, undefined]) {
    assert.equal(validarPesoKg(v).ok, false, String(v));
  }
});

test('measuredOn upper bound is today in UTC+14', () => {
  // 2026-09-25 12:00 UTC → already 2026-09-26 in UTC+14.
  const agora = new Date('2026-09-25T12:00:00Z');
  assert.equal(limiteSuperiorMeasuredOn(agora), '2026-09-26');
  assert.equal(validarMeasuredOn('2026-09-26', agora).ok, true);
  assert.equal(validarMeasuredOn('2026-09-27', agora).ok, false);
  assert.equal(validarMeasuredOn('2026-02-30', agora).ok, false);
});

test('an evening entry in São Paulo is not taken as future', () => {
  // 23:30 in São Paulo = 02:30 UTC of the next day.
  const agora = new Date('2026-09-26T02:30:00Z');
  assert.equal(validarMeasuredOn('2026-09-25', agora).ok, true);
});

test('cycle start is read as a civil date in America/Sao_Paulo', () => {
  // 01:00 UTC on the 1st is still the 30th in São Paulo (UTC-3).
  assert.equal(dataCivilDoInicio(new Date('2026-10-01T01:00:00Z')), '2026-09-30');
  // Firestore Timestamp shape: anything with toDate().
  assert.equal(dataCivilDoInicio({ toDate: () => new Date('2026-09-10T15:00:00Z') }), '2026-09-10');
  assert.equal(dataCivilDoInicio(null), null);
  assert.equal(dataCivilDoInicio('10/09/2026'), null);
});

test('measuredOn before the cycle start is refused; without a start, no lower bound', () => {
  assert.equal(validarInicioCiclo('2026-09-09', '2026-09-10').ok, false);
  assert.equal(validarInicioCiclo('2026-09-10', '2026-09-10').ok, true);
  assert.equal(validarInicioCiclo('2020-01-01', null).ok, true);
});

test('moving average uses a 7-day calendar window, not the last 7 points', () => {
  const pontos = [
    { measuredOn: '2026-09-01', weightKg: 80 },
    { measuredOn: '2026-09-02', weightKg: 82 },
    { measuredOn: '2026-09-07', weightKg: 84 }, // window 09-01..09-07: 80, 82, 84
    { measuredOn: '2026-09-08', weightKg: 86 }, // window 09-02..09-08: 82, 84, 86
    { measuredOn: '2026-09-20', weightKg: 90 }, // window 09-14..09-20: 90 alone
  ];
  const r = calcularMediaMovel(pontos);
  assert.deepEqual(r.map((p) => [p.mma7, p.n7]), [
    [80, 1],
    [81, 2],
    [82, 3],
    [84, 3],
    [90, 1],
  ]);
  assert.equal(r[3].measuredOn, '2026-09-08');
  assert.equal(r[3].weightKg, 86);
});

test('moving average rounds to 2 decimals and handles an empty series', () => {
  const r = calcularMediaMovel([
    { measuredOn: '2026-09-01', weightKg: 80.1 },
    { measuredOn: '2026-09-02', weightKg: 80.2 },
    { measuredOn: '2026-09-03', weightKg: 80.2 },
  ]);
  assert.equal(r[2].mma7, 80.17);
  assert.deepEqual(calcularMediaMovel([]), []);
});
