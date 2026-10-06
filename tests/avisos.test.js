// tests/avisos.test.js
// Filter of the punycode deprecation warning (netlify/functions/_avisos.ts).
// It must silence DEP0040 and nothing else.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarTs } = require('./_carregar-ts.js');

test('codigoDoAviso lê o código nas duas formas de process.emitWarning', async () => {
  const { codigoDoAviso } = await carregarTs('netlify/functions/_avisos.ts');
  assert.equal(codigoDoAviso(['msg', 'DeprecationWarning', 'DEP0040']), 'DEP0040');
  assert.equal(codigoDoAviso(['msg', { type: 'DeprecationWarning', code: 'DEP0040' }]), 'DEP0040');
  assert.equal(codigoDoAviso(['msg']), undefined);
  assert.equal(codigoDoAviso(['msg', 'Warning']), undefined);
  assert.equal(codigoDoAviso([new Error('x')]), undefined);
});

test('instalado: DEP0040 é descartado; outros avisos e outras depreciações passam', async (t) => {
  const original = process.emitWarning;
  const MARCA = Symbol.for('elite90.avisos.instalado');
  const tinha = process[MARCA];
  const recebidos = [];
  // The "real" emitter that the filter wraps: records instead of printing.
  process.emitWarning = function (...args) { recebidos.push(args); };
  delete process[MARCA];
  t.after(() => { process.emitWarning = original; if (tinha) process[MARCA] = tinha; else delete process[MARCA]; });

  await carregarTs('netlify/functions/_avisos.ts'); // installs on load

  process.emitWarning('punycode', 'DeprecationWarning', 'DEP0040');
  process.emitWarning('punycode (forma com opções)', { type: 'DeprecationWarning', code: 'DEP0040' });
  assert.equal(recebidos.length, 0, 'DEP0040 descartado nas duas formas');

  process.emitWarning('outra', 'DeprecationWarning', 'DEP0005');
  process.emitWarning('sem código', 'Warning');
  process.emitWarning('forma com opções', { type: 'DeprecationWarning', code: 'DEP0111' });
  assert.equal(recebidos.length, 3, 'o resto continua passando');
  assert.equal(recebidos[0][2], 'DEP0005');
});

test('instalar duas vezes não empilha filtros (idempotente)', async (t) => {
  const original = process.emitWarning;
  const MARCA = Symbol.for('elite90.avisos.instalado');
  const tinha = process[MARCA];
  process.emitWarning = function () {};
  delete process[MARCA];
  t.after(() => { process.emitWarning = original; if (tinha) process[MARCA] = tinha; else delete process[MARCA]; });
  const m = await carregarTs('netlify/functions/_avisos.ts');
  const depois = process.emitWarning;
  m.silenciarAvisosConhecidos();
  assert.equal(process.emitWarning, depois);
});
