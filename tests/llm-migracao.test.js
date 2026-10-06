// tests/llm-migracao.test.js
// What T-17 adds on top of the characterized behavior (persistence plan v5.29,
// Phase 8, delivery 1). tests/llm-caracterizacao.test.js proves that nothing
// else changed; this file proves the two allowed differences and the recorded
// versions:
//   · the API key travels in the `x-goog-api-key` header, not in the URL;
//   · each call has its timeout (DP-13), wired with the per-task value;
//   · prompt and model versions come back from both calls (DP-12), and are
//     null when the triage adjustment is a fixed fallback.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarTs } = require('./_carregar-ts.js');

const CHAVE = 'chave-de-teste-123';

function definirChave(t, valor) {
  const anterior = process.env.GOOGLE_GEMINI_KEY;
  if (valor === undefined) delete process.env.GOOGLE_GEMINI_KEY;
  else process.env.GOOGLE_GEMINI_KEY = valor;
  t.after(() => {
    if (anterior === undefined) delete process.env.GOOGLE_GEMINI_KEY;
    else process.env.GOOGLE_GEMINI_KEY = anterior;
  });
}

function instalarFetch(t, comportamento) {
  const chamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    chamadas.push({ url: String(url), init });
    return comportamento(url, init);
  };
  t.after(() => { globalThis.fetch = original; });
  return chamadas;
}

function resposta(corpo, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

function envelope(texto, modelVersion = 'gemini-2.5-flash-001') {
  return { candidates: [{ content: { parts: [{ text: texto }] }, finishReason: 'STOP' }], modelVersion };
}

const LEAD_TRIAGEM = { trt_detalhe: 'Testosterona 150 mg' };

function silenciarConsole(t) {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
}

/** Lets pending promise callbacks run without advancing mocked timers. */
const escoar = () => new Promise((r) => setImmediate(r));

// ── triage ──────────────────────────────────────────────────────────────────

test('triagem · chave no cabeçalho, nunca na URL', async (t) => {
  definirChave(t, CHAVE);
  const chamadas = instalarFetch(t, () => resposta(envelope('{"ajuste":1,"justificativa":"a"}')));
  const { ajusteIA } = await carregarTs('netlify/functions/_scoring.ts');
  await ajusteIA(LEAD_TRIAGEM);
  assert.ok(!chamadas[0].url.includes(CHAVE));
  assert.ok(!new URL(chamadas[0].url).searchParams.has('key'));
  assert.equal(chamadas[0].init.headers['x-goog-api-key'], CHAVE);
});

test('triagem · versões: presentes quando o ajuste vem da resposta do modelo', async (t) => {
  definirChave(t, CHAVE);
  const { ajusteIA } = await carregarTs('netlify/functions/_scoring.ts');
  instalarFetch(t, () => resposta(envelope('{"ajuste":2,"justificativa":"b"}')));
  assert.deepEqual(await ajusteIA(LEAD_TRIAGEM), {
    ajuste: 2, justificativa: 'b', promptVersion: 'triagem-ajuste/v1', modelVersion: 'gemini-2.5-flash-001',
  });
  instalarFetch(t, () => resposta({ promptFeedback: { blockReason: 'SAFETY' }, modelVersion: 'gemini-2.5-flash-002' }));
  assert.deepEqual(await ajusteIA(LEAD_TRIAGEM), {
    ajuste: 0, justificativa: '', promptVersion: 'triagem-ajuste/v1', modelVersion: 'gemini-2.5-flash-002',
  });
});

test('triagem · versões nulas quando o ajuste é texto fixo do módulo', async (t) => {
  silenciarConsole(t);
  const { ajusteIA } = await carregarTs('netlify/functions/_scoring.ts');
  const nulas = { promptVersion: null, modelVersion: null };

  definirChave(t, undefined);
  assert.deepEqual(await ajusteIA(LEAD_TRIAGEM), { ajuste: 0, justificativa: 'GOOGLE_GEMINI_KEY não configurada.', ...nulas });

  definirChave(t, CHAVE);
  assert.deepEqual(await ajusteIA({}), { ajuste: 0, justificativa: 'Sem campos de texto livre para análise qualitativa.', ...nulas });

  instalarFetch(t, () => resposta({}, 503));
  assert.deepEqual(await ajusteIA(LEAD_TRIAGEM), { ajuste: 0, justificativa: 'Ajuste qualitativo indisponível.', ...nulas });

  instalarFetch(t, () => resposta(envelope('não é json')));
  assert.deepEqual(await ajusteIA(LEAD_TRIAGEM), { ajuste: 0, justificativa: 'Ajuste qualitativo indisponível.', ...nulas });

  instalarFetch(t, () => resposta(envelope('null')));
  assert.deepEqual(await ajusteIA(LEAD_TRIAGEM), { ajuste: 0, justificativa: 'Ajuste qualitativo indisponível.', ...nulas });
});

test('triagem · tempo limite de 15 s: indisponível, sem lançar', async (t) => {
  definirChave(t, CHAVE);
  silenciarConsole(t);
  const { ajusteIA } = await carregarTs('netlify/functions/_scoring.ts');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  instalarFetch(t, () => new Promise(() => {}));
  let resolvido = false;
  const p = ajusteIA(LEAD_TRIAGEM).then((r) => { resolvido = true; return r; });
  await escoar();
  t.mock.timers.tick(14999);
  await escoar();
  assert.equal(resolvido, false, 'still waiting just before 15 s');
  t.mock.timers.tick(1);
  const r = await p;
  assert.deepEqual(r, { ajuste: 0, justificativa: 'Ajuste qualitativo indisponível.', promptVersion: null, modelVersion: null });
});

// ── evaluation draft ────────────────────────────────────────────────────────

function instalarFirebase(t) {
  globalThis.__e90Stubs = {
    './_firebase': {
      getApp: () => ({}),
      storageBucketName: () => 'b',
      getDb: () => ({
        collection(nome) {
          if (nome === 'leads') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ nome: 'X (MOCK #01)', fotos_paths: [] }) }) }) };
          const consulta = { orderBy: () => consulta, limit: () => consulta, get: async () => ({ docs: [] }) };
          return consulta;
        },
      }),
    },
    'firebase-admin/auth': { getAuth: () => ({ verifyIdToken: async () => ({ uid: 'c', admin: true }) }) },
    'firebase-admin/storage': { getStorage: () => ({ bucket: () => ({ file: () => ({ download: async () => [Buffer.from('')] }) }) }) },
  };
  t.after(() => { delete globalThis.__e90Stubs; });
}

const evento = { httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ leadId: 'L1' }) };

test('avaliação · chave no cabeçalho; versões devolvidas ao painel', async (t) => {
  definirChave(t, CHAVE);
  instalarFirebase(t);
  const chamadas = instalarFetch(t, () => resposta(envelope('{"s1":"a","s2":"b","s3":"c","s4":"d","s5":"e"}')));
  const { handler } = await carregarTs('netlify/functions/generate-evaluation.ts');
  const r = await handler(evento);
  assert.equal(r.statusCode, 200);
  const corpo = JSON.parse(r.body);
  assert.equal(corpo.promptVersion, 'avaliacao-rascunho/v1');
  assert.equal(corpo.modelVersion, 'gemini-2.5-flash-001');
  assert.equal('truncated' in corpo, false, 'no new field beyond the versions');
  assert.ok(!new URL(chamadas[0].url).searchParams.has('key'));
  assert.equal(chamadas[0].init.headers['x-goog-api-key'], CHAVE);
});

test('avaliação · tempo limite de 45 s: 500 com mensagem própria', async (t) => {
  definirChave(t, CHAVE);
  silenciarConsole(t);
  instalarFirebase(t);
  const { handler } = await carregarTs('netlify/functions/generate-evaluation.ts');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  instalarFetch(t, () => new Promise(() => {}));
  let resolvido = false;
  const p = handler(evento).then((r) => { resolvido = true; return r; });
  for (let i = 0; i < 5; i++) await escoar();
  t.mock.timers.tick(44999);
  await escoar();
  assert.equal(resolvido, false, 'still waiting just before 45 s');
  t.mock.timers.tick(1);
  const r = await p;
  assert.deepEqual(r, { statusCode: 500, body: JSON.stringify({ error: 'Tempo limite da chamada ao modelo esgotado.' }) });
});

test('triagem · resposta cercada de prosa ("Here is the JSON…") aplica o ajuste em vez de cair no fallback', async (t) => {
  definirChave(t, CHAVE);
  t.mock.method(console, 'info', () => {});
  instalarFetch(t, () => resposta(envelope('Here is the JSON requested:\n```json\n{"ajuste": 4, "justificativa": "TRT detalhado."}\n```')));
  const { ajusteIA } = await carregarTs('netlify/functions/_scoring.ts');
  assert.deepEqual(await ajusteIA(LEAD_TRIAGEM), {
    ajuste: 4, justificativa: 'TRT detalhado.', promptVersion: 'triagem-ajuste/v1', modelVersion: 'gemini-2.5-flash-001',
  });
});

test('triagem · prosa sem nenhum JSON continua no fallback "indisponível"', async (t) => {
  definirChave(t, CHAVE);
  silenciarConsole(t);
  instalarFetch(t, () => resposta(envelope('Desculpe, não consigo ajudar com isso.')));
  const { ajusteIA } = await carregarTs('netlify/functions/_scoring.ts');
  const r = await ajusteIA(LEAD_TRIAGEM);
  assert.equal(r.ajuste, 0);
  assert.equal(r.justificativa, 'Ajuste qualitativo indisponível.');
  assert.equal(r.promptVersion, null);
});
