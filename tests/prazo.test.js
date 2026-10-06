// tests/prazo.test.js
// Time limit and time budget used by submit-lead (netlify/functions/_prazo.ts).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarTs } = require('./_carregar-ts.js');

test('comPrazo devolve o valor quando a promessa termina a tempo', async () => {
  const { comPrazo } = await carregarTs('netlify/functions/_prazo.ts');
  assert.equal(await comPrazo(Promise.resolve(42), 100, 'x'), 42);
});

test('comPrazo rejeita com PrazoEsgotado e o rótulo quando estoura', async () => {
  const { comPrazo, PrazoEsgotado } = await carregarTs('netlify/functions/_prazo.ts');
  const t0 = Date.now();
  await assert.rejects(comPrazo(new Promise(() => {}), 40, 'gravação'), (e) => {
    assert.ok(e instanceof PrazoEsgotado);
    assert.equal(e.rotulo, 'gravação');
    assert.match(e.message, /gravação/);
    return true;
  });
  assert.ok(Date.now() - t0 < 500);
});

test('comPrazo repassa a rejeição original da promessa', async () => {
  const { comPrazo } = await carregarTs('netlify/functions/_prazo.ts');
  await assert.rejects(comPrazo(Promise.reject(new Error('falhou')), 100, 'x'), /falhou/);
});

test('promessa que rejeita DEPOIS do prazo não vira rejeição não tratada', async () => {
  const { comPrazo } = await carregarTs('netlify/functions/_prazo.ts');
  let naoTratada = null;
  const ouvinte = (e) => { naoTratada = e; };
  process.on('unhandledRejection', ouvinte);
  try {
    const tardia = new Promise((_, rej) => setTimeout(() => rej(new Error('tarde')), 60));
    await assert.rejects(comPrazo(tardia, 20, 'x'));
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(naoTratada, null);
  } finally { process.off('unhandledRejection', ouvinte); }
});

test('criarOrcamento: restante decresce com o relógio e nunca fica negativo', async () => {
  const { criarOrcamento } = await carregarTs('netlify/functions/_prazo.ts');
  let t = 1000; const o = criarOrcamento(8000, () => t);
  assert.equal(o.restante(), 8000);
  t += 3000; assert.equal(o.restante(), 5000);
  t += 9000; assert.equal(o.restante(), 0);
});

test('criarOrcamento.fatia: no máximo o pedido, menos a reserva, nunca negativa', async () => {
  const { criarOrcamento } = await carregarTs('netlify/functions/_prazo.ts');
  let t = 0; const o = criarOrcamento(8000, () => t);
  assert.equal(o.fatia(4000), 4000);
  assert.equal(o.fatia(15000, 1500), 6500);
  t = 7000; assert.equal(o.fatia(4000), 1000);
  assert.equal(o.fatia(4000, 1500), 0);
});
