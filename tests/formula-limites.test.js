// tests/formula-limites.test.js
// Plausibility bounds of the nutrition formula coefficients
// (netlify/functions/_formula-nutricional.ts, validarCoeficientesFormula).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarTs } = require('./_carregar-ts.js');

const MOD = 'netlify/functions/_formula-nutricional.ts';

function fases(sobrescrever) {
  const base = {
    Bulking: { proteinPerKg: 2.0, carbPerKg: 5.0, fatPerKg: 1.1 },
    Cutting: { proteinPerKg: 2.4, carbPerKg: 3.0, fatPerKg: 0.8 },
    'Diet Break': { proteinPerKg: 2.2, carbPerKg: 3.5, fatPerKg: 0.9 },
    Maintenance: { proteinPerKg: 2.0, carbPerKg: 4.0, fatPerKg: 1.0 },
  };
  return { ...base, ...sobrescrever };
}

test('valores de origem são aceitos', async () => {
  const { validarCoeficientesFormula, FORMULA_DEFAULTS } = await carregarTs(MOD);
  assert.equal(validarCoeficientesFormula(FORMULA_DEFAULTS).ok, true);
});

test('limites exatos são aceitos (faixa fechada)', async () => {
  const { validarCoeficientesFormula } = await carregarTs(MOD);
  const r1 = validarCoeficientesFormula(fases({ Cutting: { proteinPerKg: 0.8, carbPerKg: 0.2, fatPerKg: 0.3 } }));
  const r2 = validarCoeficientesFormula(fases({ Bulking: { proteinPerKg: 5.0, carbPerKg: 12.0, fatPerKg: 3.5 } }));
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
});

test('dieta cetogênica estrita passa (carboidrato 0,3 g/kg, gordura 2,6 g/kg)', async () => {
  const { validarCoeficientesFormula } = await carregarTs(MOD);
  const r = validarCoeficientesFormula(fases({ Maintenance: { proteinPerKg: 2.0, carbPerKg: 0.3, fatPerKg: 2.6 } }));
  assert.equal(r.ok, true);
});

test('vírgula fora do lugar é recusada, com fase e campo na mensagem', async () => {
  const { validarCoeficientesFormula } = await carregarTs(MOD);
  const casos = [
    [{ Cutting: { proteinPerKg: 22, carbPerKg: 3.0, fatPerKg: 0.8 } }, /Cutting\.proteinPerKg/],
    [{ Cutting: { proteinPerKg: 0.22, carbPerKg: 3.0, fatPerKg: 0.8 } }, /Cutting\.proteinPerKg/],
    [{ Bulking: { proteinPerKg: 2.0, carbPerKg: 50, fatPerKg: 1.1 } }, /Bulking\.carbPerKg/],
    [{ Maintenance: { proteinPerKg: 2.0, carbPerKg: 4.0, fatPerKg: 10 } }, /Maintenance\.fatPerKg/],
    [{ Maintenance: { proteinPerKg: 2.0, carbPerKg: 4.0, fatPerKg: 0.1 } }, /Maintenance\.fatPerKg/],
  ];
  for (const [entrada, padrao] of casos) {
    const r = validarCoeficientesFormula(fases(entrada));
    assert.equal(r.ok, false);
    assert.match(r.erro, padrao);
    assert.match(r.erro, /fora da faixa/);
  }
});

test('zero e não-número seguem recusados pela regra anterior', async () => {
  const { validarCoeficientesFormula } = await carregarTs(MOD);
  assert.equal(validarCoeficientesFormula(fases({ Cutting: { proteinPerKg: 0, carbPerKg: 3, fatPerKg: 0.8 } })).ok, false);
  assert.equal(validarCoeficientesFormula(fases({ Cutting: { proteinPerKg: '2.4', carbPerKg: 3, fatPerKg: 0.8 } })).ok, false);
});

// calcularFormulaSnapshot: a stored coefficient outside the bounds (saved
// before they existed) must not be frozen into a published plan.
function dbCom(phases) {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, data: () => ({ phases }) }),
      }),
    }),
  };
}

test('retrato é calculado quando a fórmula vigente está dentro da faixa', async () => {
  const { calcularFormulaSnapshot, FORMULA_DEFAULTS } = await carregarTs(MOD);
  const r = await calcularFormulaSnapshot(dbCom(FORMULA_DEFAULTS), 'Cutting', 80);
  assert.deepEqual(r.targets, { proteinG: 192, carbG: 240, fatG: 64, kcal: 2304 });
});

test('retrato recusa coeficiente gravado fora da faixa, nomeando fase e campo', async () => {
  const { calcularFormulaSnapshot, FormulaForaDaFaixaError } = await carregarTs(MOD);
  const db = dbCom(fases({ Cutting: { proteinPerKg: 2.4, carbPerKg: 3.0, fatPerKg: 0.1 } }));
  await assert.rejects(calcularFormulaSnapshot(db, 'Cutting', 80), (e) => {
    assert.ok(e instanceof FormulaForaDaFaixaError);
    assert.equal(e.fase, 'Cutting');
    assert.equal(e.campo, 'fatPerKg');
    assert.equal(e.valor, 0.1);
    return true;
  });
});

test('valor fora da faixa em outra fase não bloqueia a fase do atleta', async () => {
  const { calcularFormulaSnapshot } = await carregarTs(MOD);
  const db = dbCom(fases({ Bulking: { proteinPerKg: 2.0, carbPerKg: 50, fatPerKg: 1.1 } }));
  const r = await calcularFormulaSnapshot(db, 'Cutting', 80);
  assert.equal(r.targets.kcal, 2304);
});
