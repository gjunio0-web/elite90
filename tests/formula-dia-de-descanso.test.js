// tests/formula-dia-de-descanso.test.js
// Rest-day target (governance instruction of 10/10/2026, §5; Adendo 03 R-1 to R-9):
// - config/nutritionFormula gains `restDayPhases`; without it, the rest day uses `phases`;
// - the plausibility bounds and the publication refusals apply to the rest-day table;
// - `formulaSnapshot` keeps the training day in its existing fields and adds `restDay`;
// - old snapshots (no `restDay`) and old drafts (no `targetRest`) still work.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { carregarTs, RAIZ } = require('./_carregar-ts.js');

const MOD = 'netlify/functions/_formula-nutricional.ts';

const TREINO = {
  Bulking: { proteinPerKg: 2.0, carbPerKg: 5.0, fatPerKg: 1.1 },
  Cutting: { proteinPerKg: 2.4, carbPerKg: 3.0, fatPerKg: 0.8 },
  'Diet Break': { proteinPerKg: 2.2, carbPerKg: 3.5, fatPerKg: 0.9 },
  Maintenance: { proteinPerKg: 2.0, carbPerKg: 4.0, fatPerKg: 1.0 },
};
const copia = (o) => JSON.parse(JSON.stringify(o));
const DESCANSO = (() => { const d = copia(TREINO); d.Cutting = { proteinPerKg: 2.4, carbPerKg: 2.0, fatPerKg: 0.8 }; return d; })();

function dbConfig(config) {
  return {
    collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => config }) }) }),
  };
}

// ---------- snapshot (server) ----------

test('sem restDayPhases, as metas do descanso são iguais às do treino', async () => {
  const { calcularFormulaSnapshot } = await carregarTs(MOD);
  const r = await calcularFormulaSnapshot(dbConfig({ phases: TREINO }), 'Cutting', 80);
  assert.deepEqual(r.targets, { proteinG: 192, carbG: 240, fatG: 64, kcal: 2304 });
  assert.deepEqual(r.restDay.targets, r.targets);
  assert.equal(r.restDay.carbPerKg, 3.0);
});

test('com restDayPhases, as metas do descanso são as próprias; as do treino não mudam', async () => {
  const { calcularFormulaSnapshot } = await carregarTs(MOD);
  const r = await calcularFormulaSnapshot(dbConfig({ phases: TREINO, restDayPhases: DESCANSO }), 'Cutting', 80);
  assert.deepEqual(r.targets, { proteinG: 192, carbG: 240, fatG: 64, kcal: 2304 });
  assert.deepEqual(r.restDay.targets, { proteinG: 192, carbG: 160, fatG: 64, kcal: 1984 });
  assert.equal(r.restDay.carbPerKg, 2.0);
  // Existing fields keep their meaning (training day).
  assert.equal(r.carbPerKg, 3.0);
  assert.equal(r.weightKgUsed, 80);
});

test('restDayPhases sem a fase do atleta: o descanso usa a fase do treino', async () => {
  const { calcularFormulaSnapshot } = await carregarTs(MOD);
  const parcial = copia(DESCANSO); delete parcial.Bulking;
  const r = await calcularFormulaSnapshot(dbConfig({ phases: TREINO, restDayPhases: parcial }), 'Bulking', 80);
  assert.deepEqual(r.restDay.targets, r.targets);
});

test('coeficiente do descanso fora da faixa, na fase do atleta: recusa nomeando o dia de descanso', async () => {
  const { calcularFormulaSnapshot, FormulaForaDaFaixaError } = await carregarTs(MOD);
  const ruim = copia(DESCANSO); ruim.Cutting.fatPerKg = 0.1;
  await assert.rejects(calcularFormulaSnapshot(dbConfig({ phases: TREINO, restDayPhases: ruim }), 'Cutting', 80), (e) => {
    assert.ok(e instanceof FormulaForaDaFaixaError);
    assert.equal(e.dia, 'descanso');
    assert.equal(e.campo, 'fatPerKg');
    assert.match(e.message, /dia de descanso/);
    return true;
  });
});

test('coeficiente do descanso fora da faixa em outra fase não bloqueia', async () => {
  const { calcularFormulaSnapshot } = await carregarTs(MOD);
  const ruim = copia(DESCANSO); ruim.Bulking.carbPerKg = 50;
  const r = await calcularFormulaSnapshot(dbConfig({ phases: TREINO, restDayPhases: ruim }), 'Cutting', 80);
  assert.equal(r.restDay.carbPerKg, 2.0);
});

test('coeficiente do treino fora da faixa continua marcado como treino', async () => {
  const { calcularFormulaSnapshot, FormulaForaDaFaixaError } = await carregarTs(MOD);
  const ruim = copia(TREINO); ruim.Cutting.proteinPerKg = 22;
  await assert.rejects(calcularFormulaSnapshot(dbConfig({ phases: ruim }), 'Cutting', 80), (e) => {
    assert.ok(e instanceof FormulaForaDaFaixaError);
    assert.equal(e.dia, 'treino');
    assert.doesNotMatch(e.message, /descanso/);
    return true;
  });
});

test('peso ausente continua recusado antes de qualquer tabela', async () => {
  const { calcularFormulaSnapshot, PesoAusenteError } = await carregarTs(MOD);
  await assert.rejects(calcularFormulaSnapshot(dbConfig({ phases: TREINO, restDayPhases: DESCANSO }), 'Cutting', null), PesoAusenteError);
});

test('validação da tabela do descanso: mesmas faixas, mensagem com restDayPhases', async () => {
  const { validarCoeficientesFormula } = await carregarTs(MOD);
  assert.equal(validarCoeficientesFormula(DESCANSO, 'restDayPhases').ok, true);
  const ruim = copia(DESCANSO); ruim.Cutting.carbPerKg = 0.1;
  const r = validarCoeficientesFormula(ruim, 'restDayPhases');
  assert.equal(r.ok, false);
  assert.match(r.erro, /^restDayPhases\.Cutting\.carbPerKg fora da faixa/);
  // Default label unchanged for the training table.
  assert.match(validarCoeficientesFormula(ruim).erro, /^phases\.Cutting\.carbPerKg/);
});

// ---------- salvar-config-formula / ler-config-formula ----------

function stubs(t, db) {
  globalThis.__e90Stubs = {
    'firebase-admin/auth': { getAuth: () => ({ verifyIdToken: async () => ({ admin: true, uid: 'coach', email: 'c@x.test' }) }) },
    'firebase-admin/firestore': {
      FieldValue: { serverTimestamp: () => 'ts' },
      Timestamp: {}, FieldPath: {}, getFirestore: () => db,
    },
    './_firebase': { getApp: () => ({}), getDb: () => db, storageBucketName: () => 'b' },
    './_rastreabilidade': { registrar: async () => {} },
  };
  t.after(() => { delete globalThis.__e90Stubs; });
}

function dbGravacao() {
  const db = {
    gravado: null,
    collection: () => ({ doc: () => ({ set: async (dados) => { db.gravado = dados; } }) }),
  };
  return db;
}

async function salvar(t, corpo) {
  const db = dbGravacao();
  stubs(t, db);
  const { handler } = await carregarTs('netlify/functions/salvar-config-formula.ts');
  const resp = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(corpo) });
  return { resp, db };
}

test('salvar com as duas tabelas grava phases e restDayPhases', async (t) => {
  const { resp, db } = await salvar(t, { phases: TREINO, restDayPhases: DESCANSO });
  assert.equal(resp.statusCode, 200);
  assert.deepEqual(db.gravado.phases, TREINO);
  assert.deepEqual(db.gravado.restDayPhases, DESCANSO);
});

test('salvar sem restDayPhases (cliente antigo) não grava a chave', async (t) => {
  const { resp, db } = await salvar(t, { phases: TREINO });
  assert.equal(resp.statusCode, 200);
  assert.ok(!('restDayPhases' in db.gravado));
});

test('salvar com tabela do descanso fora da faixa: 400, nada gravado', async (t) => {
  const ruim = copia(DESCANSO); ruim['Diet Break'].proteinPerKg = 0.5;
  const { resp, db } = await salvar(t, { phases: TREINO, restDayPhases: ruim });
  assert.equal(resp.statusCode, 400);
  assert.match(JSON.parse(resp.body).erro, /restDayPhases\.Diet Break\.proteinPerKg/);
  assert.equal(db.gravado, null);
});

async function ler(t, config) {
  stubs(t, dbConfig(config));
  const { handler } = await carregarTs('netlify/functions/ler-config-formula.ts');
  const resp = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: '{}' });
  return JSON.parse(resp.body);
}

test('ler devolve restDayPhases null quando nunca foi salva', async (t) => {
  const corpo = await ler(t, { phases: TREINO });
  assert.equal(corpo.restDayPhases, null);
  assert.deepEqual(corpo.phases, TREINO);
});

test('ler devolve restDayPhases quando existe', async (t) => {
  const corpo = await ler(t, { phases: TREINO, restDayPhases: DESCANSO });
  assert.deepEqual(corpo.restDayPhases, DESCANSO);
});

// ---------- roteiro de diagnóstico ----------

async function linhas() {
  const url = pathToFileURL(path.join(RAIZ, 'scripts/_linhas-retrato-nutricional.mjs')).href;
  return (await import(url)).linhasFormulaSnapshot;
}

test('roteiro lê retrato antigo, sem restDay', async () => {
  const linhasFormulaSnapshot = await linhas();
  const antigo = { phase: 'Cutting', weightKgUsed: 80, targets: { proteinG: 192, carbG: 240, fatG: 64, kcal: 2304 } };
  const l = linhasFormulaSnapshot(antigo);
  assert.equal(l.length, 2);
  assert.match(l[0], /presente · fase=Cutting · peso=80kg/);
  assert.match(l[1], /sem restDay/);
});

test('roteiro mostra a linha do descanso quando existe', async () => {
  const linhasFormulaSnapshot = await linhas();
  const novo = {
    phase: 'Cutting', weightKgUsed: 80, targets: { proteinG: 192, carbG: 240, fatG: 64, kcal: 2304 },
    restDay: { proteinPerKg: 2.4, carbPerKg: 2.0, fatPerKg: 0.8, targets: { proteinG: 192, carbG: 160, fatG: 64, kcal: 1984 } },
  };
  const l = linhasFormulaSnapshot(novo);
  assert.match(l[1], /dia de descanso: coeficientes=2.4\/2\/0.8 · metas=\{"proteinG":192,"carbG":160/);
  assert.deepEqual(linhasFormulaSnapshot(null), ['      formulaSnapshot: AUSENTE']);
});

// ---------- editor (packages/editor-plano/nucleo.js) ----------

function nucleo() {
  const codigo = fs.readFileSync(path.join(RAIZ, 'packages/editor-plano/nucleo.js'), 'utf8');
  const semEfeito = { addEventListener() {} };
  const ctx = { document: semEfeito, window: semEfeito, console };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx, { filename: 'nucleo.js' });
  vm.runInContext('nteFormulaConfig = JSON.parse(JSON.stringify(NTE_FORMULA_DEFAULTS));', ctx);
  return ctx;
}

test('editor: sem tabela do descanso, targetRest é igual a target', () => {
  const ctx = nucleo();
  const m = vm.runInContext("nteCalcularMetas({ phase: 'Cutting', weightCurrentKg: 80 })", ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(m.targetRest)), JSON.parse(JSON.stringify(m.target)));
  assert.equal(m.target.kcal, 2304);
});

test('editor: com tabela do descanso, targetRest é o próprio', () => {
  const ctx = nucleo();
  vm.runInContext("nteFormulaConfigRest = JSON.parse(JSON.stringify(NTE_FORMULA_DEFAULTS)); nteFormulaConfigRest['Cutting'] = { p: 2.4, c: 2.0, g: 0.8 };", ctx);
  const m = vm.runInContext("nteCalcularMetas({ phase: 'Cutting', weightCurrentKg: 80 })", ctx);
  assert.equal(m.target.c, 240);
  assert.equal(m.targetRest.c, 160);
  assert.equal(m.targetRest.kcal, 1984);
});

test('editor: rascunho antigo sem targetRest abre com a meta do descanso calculada', () => {
  const ctx = nucleo();
  vm.runInContext("nteFormulaConfigRest = JSON.parse(JSON.stringify(NTE_FORMULA_DEFAULTS)); nteFormulaConfigRest['Cutting'] = { p: 2.4, c: 2.0, g: 0.8 };", ctx);
  vm.runInContext("nteState.athlete = { phase: 'Cutting', weightCurrentKg: 80 }; nteState.plan = { target: { p: 192, c: 240, g: 64, kcal: 2304 }, dayType: 'treino', days: {} };", ctx);
  assert.equal(vm.runInContext('nteMetaDoDia().c', ctx), 240);
  assert.equal(vm.runInContext('nteState.plan.targetRest', ctx), undefined);
  vm.runInContext("nteState.plan.dayType = 'descanso';", ctx);
  assert.equal(vm.runInContext('nteMetaDoDia().c', ctx), 160);
  assert.equal(vm.runInContext('nteState.plan.targetRest.c', ctx), 160);
});

test('editor: plano-base já nasce com target e targetRest', () => {
  const ctx = nucleo();
  vm.runInContext('var NTE_FOOD_DB = [];', ctx);
  const p = vm.runInContext("nteBuildBasePlan({ phase: 'Bulking', weightCurrentKg: 80 })", ctx);
  assert.equal(p.target.kcal, 3032);
  assert.equal(p.targetRest.kcal, 3032);
});

// ---------- publicação direta com tabela do descanso fora da faixa ----------

test('publicar com coeficiente do descanso fora da faixa: 400 formula-fora-da-faixa, nada gravado', async (t) => {
  const ruim = copia(DESCANSO); ruim.Cutting.carbPerKg = 50;
  const escritas = [];
  const doc = (colecao) => ({
    collection: (sub) => ({ doc: () => doc(colecao + '/' + sub) }),
    get: async () => {
      if (colecao === 'athletes') return { exists: true, data: () => ({ phase: 'Cutting', weightCurrentKg: 80 }) };
      if (colecao === 'config') return { exists: true, data: () => ({ phases: TREINO, restDayPhases: ruim }) };
      return { exists: false, data: () => undefined };
    },
    set: async () => { escritas.push('set'); },
    update: async () => { escritas.push('update'); },
    create: async () => { escritas.push('create'); },
  });
  const db = {
    collection: (c) => ({ doc: () => doc(c) }),
    runTransaction: async () => { escritas.push('runTransaction'); throw new Error('STOP'); },
    batch: () => { escritas.push('batch'); return { set() {}, update() {}, commit: async () => {} }; },
  };
  stubs(t, db);
  const { handler } = await carregarTs('netlify/functions/publicar-plano-direto.ts');
  const resp = await handler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer t' },
    body: JSON.stringify({ athleteUid: 'mock-01', planType: 'nutrition', content: { days: { treino: { meals: [{ name: 'Café', foods: [{ foodId: 'x', name: 'Ovo', qty: 100 }] }] } } } }),
  });
  assert.equal(resp.statusCode, 400);
  const corpo = JSON.parse(resp.body);
  assert.equal(corpo.reason, 'formula-fora-da-faixa');
  assert.match(corpo.erro, /dia de descanso/);
  assert.deepEqual(escritas, []);
});
