// tests/formula-sem-peso.test.js
// Adendo 03 v1.6, AF-16 / CF-19: a nutrition plan for an athlete without a
// usable weight is refused (400 "sem-peso"); no version with zero targets is
// written. Covers calcularFormulaSnapshot and the direct-publish handler.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarTs } = require('./_carregar-ts.js');

const MOD = 'netlify/functions/_formula-nutricional.ts';

const DEFAULTS = {
  Bulking: { proteinPerKg: 2.0, carbPerKg: 5.0, fatPerKg: 1.1 },
  Cutting: { proteinPerKg: 2.4, carbPerKg: 3.0, fatPerKg: 0.8 },
  'Diet Break': { proteinPerKg: 2.2, carbPerKg: 3.5, fatPerKg: 0.9 },
  Maintenance: { proteinPerKg: 2.0, carbPerKg: 4.0, fatPerKg: 1.0 },
};

// Config reader for calcularFormulaSnapshot; counts reads.
function dbConfig() {
  const db = {
    leituras: 0,
    collection: () => ({
      doc: () => ({
        get: async () => { db.leituras += 1; return { exists: true, data: () => ({ phases: DEFAULTS }) }; },
      }),
    }),
  };
  return db;
}

const INVALIDOS = [
  ['nulo', null],
  ['ausente', undefined],
  ['zero', 0],
  ['texto numérico', '85'],
  ['texto', 'oitenta'],
  ['negativo', -80],
  ['NaN', NaN],
  ['infinito', Infinity],
];

for (const [nome, peso] of INVALIDOS) {
  test(`retrato recusa peso ${nome}, sem ler a configuração`, async () => {
    const { calcularFormulaSnapshot, PesoAusenteError } = await carregarTs(MOD);
    const db = dbConfig();
    await assert.rejects(calcularFormulaSnapshot(db, 'Cutting', peso), (e) => {
      assert.ok(e instanceof PesoAusenteError);
      return true;
    });
    assert.equal(db.leituras, 0);
  });
}

test('peso válido segue o caminho atual: mesmas metas de antes', async () => {
  const { calcularFormulaSnapshot } = await carregarTs(MOD);
  const r = await calcularFormulaSnapshot(dbConfig(), 'Cutting', 80);
  assert.equal(r.weightKgUsed, 80);
  assert.deepEqual(r.targets, { proteinG: 192, carbG: 240, fatG: 64, kcal: 2304 });
  const r2 = await calcularFormulaSnapshot(dbConfig(), 'Bulking', 85.4);
  assert.deepEqual(r2.targets, { proteinG: 171, carbG: 427, fatG: 94, kcal: 3238 });
});

test('fase inválida continua tendo precedência sobre peso ausente', async () => {
  const { calcularFormulaSnapshot, FaseInvalidaError } = await carregarTs(MOD);
  await assert.rejects(calcularFormulaSnapshot(dbConfig(), 'Manutenção', null), FaseInvalidaError);
});

// ---------- handler: publicar-plano-direto ----------

// Firestore stand-in for the handler. The athlete document is configurable;
// every write path records itself, so the test can assert that nothing was
// written when the publication is refused.
function dbHandler(atleta) {
  const escritas = [];
  const doc = (colecao, id) => ({
    id,
    collection: (sub) => ({ doc: (i) => doc(`${colecao}/${id}/${sub}`, i) }),
    get: async () => {
      if (colecao === 'athletes') return { exists: true, data: () => atleta, get: (k) => atleta[k] };
      if (colecao === 'config') return { exists: true, data: () => ({ phases: DEFAULTS }) };
      return { exists: false, data: () => undefined, get: () => undefined };
    },
    set: async () => { escritas.push(`set ${colecao}/${id}`); },
    update: async () => { escritas.push(`update ${colecao}/${id}`); },
    create: async () => { escritas.push(`create ${colecao}/${id}`); },
  });
  const db = {
    escritas,
    collection: (c) => ({ doc: (id) => doc(c, id) }),
    runTransaction: async () => {
      escritas.push('runTransaction');
      throw new Error('STOP_AT_TRANSACTION');
    },
    batch: () => { escritas.push('batch'); return { set() {}, update() {}, commit: async () => {} }; },
  };
  return db;
}

async function publicar(t, atleta, planType) {
  const db = dbHandler(atleta);
  globalThis.__e90Stubs = {
    'firebase-admin/auth': { getAuth: () => ({ verifyIdToken: async () => ({ admin: true, uid: 'coach', email: 'c@x.test' }) }) },
    'firebase-admin/firestore': {
      getFirestore: () => db,
      FieldValue: { serverTimestamp: () => 'ts', increment: (n) => n },
      Timestamp: { now: () => ({ toMillis: () => 0 }), fromMillis: (n) => n },
      FieldPath: { documentId: () => '__name__' },
    },
    './_firebase': { getApp: () => ({}), getDb: () => db, storageBucketName: () => 'b' },
    './_rastreabilidade': { registrar: async () => {} },
  };
  t.after(() => { delete globalThis.__e90Stubs; });
  const { handler } = await carregarTs('netlify/functions/publicar-plano-direto.ts');
  const content = planType === 'nutrition'
    ? { days: { treino: { meals: [{ name: 'Café', foods: [{ foodId: 'x', name: 'Ovo', qty: 100 }] }] } } }
    : { order: ['A'], days: { A: { exercises: [{ name: 'Supino' }] } } };
  let resp;
  try {
    resp = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer t' },
      body: JSON.stringify({ athleteUid: 'mock-01', planType, content }),
    });
  } catch (e) {
    resp = { erroLancado: e };
  }
  return { resp, db };
}

for (const [nome, peso] of [['nulo', null], ['zero', 0], ['texto', '85'], ['negativo', -80]]) {
  test(`publicar plano nutricional com peso ${nome}: 400 sem-peso, nada gravado`, async (t) => {
    const { resp, db } = await publicar(t, { phase: 'Cutting', weightCurrentKg: peso }, 'nutrition');
    assert.equal(resp.statusCode, 400);
    const corpo = JSON.parse(resp.body);
    assert.equal(corpo.reason, 'sem-peso');
    assert.match(corpo.erro, /peso/);
    assert.deepEqual(db.escritas, []);
  });
}

test('publicar plano nutricional com peso válido passa do retrato (chega à transação)', async (t) => {
  const { resp, db } = await publicar(t, { phase: 'Cutting', weightCurrentKg: 80 }, 'nutrition');
  assert.notEqual(resp && resp.statusCode, 400);
  assert.ok(db.escritas.includes('runTransaction'), JSON.stringify({ resp, escritas: db.escritas }));
});

test('plano de treino não é afetado por peso ausente', async (t) => {
  const { resp, db } = await publicar(t, { phase: 'Cutting', weightCurrentKg: null }, 'training');
  assert.notEqual(resp && resp.statusCode, 400);
  assert.ok(db.escritas.includes('runTransaction'), JSON.stringify({ resp, escritas: db.escritas }));
});
