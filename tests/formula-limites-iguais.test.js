// tests/formula-limites-iguais.test.js
// The formula panel keeps a client copy of the plausibility bounds
// (NTE_FORMULA_LIMITS, packages/editor-plano/nucleo.js); the server holds the
// authority (FORMULA_LIMITS, netlify/functions/_formula-nutricional.ts).
// Adendo 03 v1.6, AF-15 / CF-18: this test fails if the two copies diverge.
//
// nucleo.js is a classic browser script (no import/export), so it is run as-is
// in a VM context. Its only top-level side effects are two event listeners,
// satisfied here by no-op stubs; the file itself is not changed.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { carregarTs } = require('./_carregar-ts.js');

const RAIZ = path.resolve(__dirname, '..');

function limitesDoCliente() {
  const codigo = fs.readFileSync(path.join(RAIZ, 'packages/editor-plano/nucleo.js'), 'utf8');
  const semEfeito = { addEventListener() {} };
  const ctx = { document: semEfeito, window: semEfeito };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx, { filename: 'nucleo.js' });
  return ctx.NTE_FORMULA_LIMITS;
}

// Client key ↔ server key.
const PARES = [
  ['p', 'proteinPerKg'],
  ['c', 'carbPerKg'],
  ['g', 'fatPerKg'],
];

test('limites da tela e do servidor são iguais, campo a campo', async () => {
  const cliente = limitesDoCliente();
  const { FORMULA_LIMITS: servidor } = await carregarTs('netlify/functions/_formula-nutricional.ts');

  assert.ok(cliente, 'NTE_FORMULA_LIMITS não encontrado em nucleo.js');
  assert.deepEqual(Object.keys(cliente).sort(), PARES.map(([c]) => c).sort(), 'campos da tela');
  assert.deepEqual(Object.keys(servidor).sort(), PARES.map(([, s]) => s).sort(), 'campos do servidor');

  for (const [c, s] of PARES) {
    assert.equal(cliente[c].min, servidor[s].min, `mínimo de ${c} (tela) ≠ ${s} (servidor)`);
    assert.equal(cliente[c].max, servidor[s].max, `máximo de ${c} (tela) ≠ ${s} (servidor)`);
  }
});
