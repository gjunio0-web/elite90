// tests/llm-caracterizacao.test.js
// Characterization of the two model calls that exist before T-17 (persistence
// plan v5.29, Phase 8, delivery 1): `ajusteIA` in `_scoring.ts` and the
// handler of `generate-evaluation.ts`.
//
// WRITTEN AGAINST THE CODE BEFORE THE MIGRATION, and kept unchanged after it.
// Each test pins either the exact request sent to the model or the observable
// result of one response branch. The migration to `_llm.ts` is accepted only if
// every test here passes with the same result. The two differences the plan
// allows are neutralized by `normalizarRequisicao`, and only those:
//   · the API key may move from the URL (`?key=`) to the `x-goog-api-key`
//     header — both are removed before comparing;
//   · a timeout may be added — the `signal` in the request options is ignored.
// Anything else in the request (path, method, other headers, the body byte by
// byte) must match the snapshot in tests/fotografias/.
//
// Snapshots are recorded only with E90_GRAVAR_FOTOGRAFIAS=1, and were recorded
// from the pre-migration code. Re-recording them is a deliberate act: it means
// the request changed on purpose.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { carregarTs, RAIZ } = require('./_carregar-ts.js');

const DIR_FOTOGRAFIAS = path.join(RAIZ, 'tests', 'fotografias');
const GRAVAR = process.env.E90_GRAVAR_FOTOGRAFIAS === '1';
const CHAVE = 'chave-de-teste-123';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Strips the two allowed differences; keeps everything else verbatim. */
function normalizarRequisicao(url, init) {
  const u = new URL(url);
  u.searchParams.delete('key');
  const cabecalhos = {};
  for (const [k, v] of Object.entries(init?.headers ?? {})) {
    if (k.toLowerCase() === 'x-goog-api-key') continue;
    cabecalhos[k] = v;
  }
  return { url: u.toString(), metodo: init?.method ?? 'GET', cabecalhos, corpo: init?.body ?? null };
}

function conferirFotografia(nome, valor) {
  const arquivo = path.join(DIR_FOTOGRAFIAS, nome);
  const texto = JSON.stringify(valor, null, 2) + '\n';
  if (GRAVAR) {
    fs.mkdirSync(DIR_FOTOGRAFIAS, { recursive: true });
    fs.writeFileSync(arquivo, texto);
    return;
  }
  assert.ok(fs.existsSync(arquivo), `snapshot ${nome} is missing`);
  assert.equal(texto, fs.readFileSync(arquivo, 'utf8'), `request differs from snapshot ${nome}`);
}

/** Response double with the parts of the Fetch API the code reads. */
function resposta({ status = 200, json, texto, jsonLanca }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (jsonLanca) throw jsonLanca;
      return json;
    },
    async text() {
      return texto ?? (json === undefined ? '' : JSON.stringify(json));
    },
  };
}

/** Gemini envelope with one candidate whose first part is `texto`. */
function envelope(texto, extra = {}) {
  return {
    candidates: [{ content: { parts: [{ text: texto }], role: 'model' }, finishReason: 'STOP', index: 0 }],
    modelVersion: 'gemini-2.5-flash',
    ...extra,
  };
}

/** Installs a fetch double; returns the list of captured calls. */
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

function definirChave(t, valor) {
  const anterior = process.env.GOOGLE_GEMINI_KEY;
  if (valor === undefined) delete process.env.GOOGLE_GEMINI_KEY;
  else process.env.GOOGLE_GEMINI_KEY = valor;
  t.after(() => {
    if (anterior === undefined) delete process.env.GOOGLE_GEMINI_KEY;
    else process.env.GOOGLE_GEMINI_KEY = anterior;
  });
}

function silenciarConsole(t) {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
}

// ── ajusteIA (_scoring.ts) ──────────────────────────────────────────────────

const LEAD_TRIAGEM = {
  objetivo_outro: 'Preparação para o primeiro campeonato',
  trt_detalhe: 'Testosterona 150 mg por semana com acompanhamento',
  competicao_detalhe: 'Men’s Physique estadual, 2025',
  lesao_detalhe: 'Tendinite no ombro, tratada',
  suplementos_detalhe: 'Creatina, whey, ômega 3',
};

async function carregarScoring() {
  return carregarTs('netlify/functions/_scoring.ts');
}

test('triagem · sem chave: ajuste 0, aviso de configuração, nenhuma chamada', async (t) => {
  definirChave(t, undefined);
  const chamadas = instalarFetch(t, () => { throw new Error('must not be called'); });
  const { ajusteIA } = await carregarScoring();
  const r = await ajusteIA(LEAD_TRIAGEM);
  assert.equal(r.ajuste, 0);
  assert.equal(r.justificativa, 'GOOGLE_GEMINI_KEY não configurada.');
  assert.equal(chamadas.length, 0);
});

test('triagem · sem campos de texto livre: ajuste 0, nenhuma chamada', async (t) => {
  definirChave(t, CHAVE);
  const chamadas = instalarFetch(t, () => { throw new Error('must not be called'); });
  const { ajusteIA } = await carregarScoring();
  const r = await ajusteIA({ objetivo: 'Hipertrofia' });
  assert.equal(r.ajuste, 0);
  assert.equal(r.justificativa, 'Sem campos de texto livre para análise qualitativa.');
  assert.equal(chamadas.length, 0);
});

test('triagem · sucesso: requisição exata e valor devolvido', async (t) => {
  definirChave(t, CHAVE);
  const chamadas = instalarFetch(t, () => resposta({ json: envelope('{"ajuste": 4, "justificativa": "Protocolo coerente."}') }));
  const { ajusteIA } = await carregarScoring();
  const r = await ajusteIA(LEAD_TRIAGEM);
  assert.equal(r.ajuste, 4);
  assert.equal(r.justificativa, 'Protocolo coerente.');
  assert.equal(chamadas.length, 1);
  conferirFotografia('requisicao-triagem-ajuste.json', normalizarRequisicao(chamadas[0].url, chamadas[0].init));
});

const RAMOS_INDISPONIVEL = [
  ['HTTP não-ok', () => resposta({ status: 500, texto: 'internal' })],
  ['falha de rede', () => { throw new TypeError('fetch failed'); }],
  ['envelope que não é JSON', () => resposta({ jsonLanca: new SyntaxError('Unexpected token < in JSON at position 0') })],
  ['texto que não é JSON', () => resposta({ json: envelope('não é json') })],
  ['JSON truncado', () => resposta({ json: envelope('{"ajuste": 3, "justif') })],
  ['texto "null"', () => resposta({ json: envelope('null') })],
  ['texto vazio', () => resposta({ json: envelope('') })],
  ['envelope null', () => resposta({ json: null })],
];

for (const [nome, comportamento] of RAMOS_INDISPONIVEL) {
  test(`triagem · ${nome}: ajuste 0, "indisponível"`, async (t) => {
    definirChave(t, CHAVE);
    silenciarConsole(t);
    instalarFetch(t, comportamento);
    const { ajusteIA } = await carregarScoring();
    const r = await ajusteIA(LEAD_TRIAGEM);
    assert.equal(r.ajuste, 0);
    assert.equal(r.justificativa, 'Ajuste qualitativo indisponível.');
  });
}

test('triagem · resposta sem candidato (vazia ou bloqueada): ajuste 0 e justificativa vazia', async (t) => {
  definirChave(t, CHAVE);
  for (const corpo of [
    {},
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'SAFETY' }] },
  ]) {
    instalarFetch(t, () => resposta({ json: corpo }));
    const { ajusteIA } = await carregarScoring();
    const r = await ajusteIA(LEAD_TRIAGEM);
    assert.equal(r.ajuste, 0);
    assert.equal(r.justificativa, '');
  }
});

test('triagem · ajuste não numérico: NaN é preservado (comportamento atual)', async (t) => {
  definirChave(t, CHAVE);
  instalarFetch(t, () => resposta({ json: envelope('{"ajuste": "alto", "justificativa": "x"}') }));
  const { ajusteIA } = await carregarScoring();
  const r = await ajusteIA(LEAD_TRIAGEM);
  assert.ok(Number.isNaN(r.ajuste));
  assert.equal(r.justificativa, 'x');
});

test('triagem · ajuste fora da faixa é limitado a ±10; campos ausentes viram 0 e ""', async (t) => {
  definirChave(t, CHAVE);
  const casos = [
    ['{"ajuste": 25, "justificativa": "a"}', 10, 'a'],
    ['{"ajuste": -30, "justificativa": "b"}', -10, 'b'],
    ['{"ajuste": 2.5}', 2.5, ''],
    ['{}', 0, ''],
  ];
  for (const [texto, ajuste, justificativa] of casos) {
    instalarFetch(t, () => resposta({ json: envelope(texto) }));
    const { ajusteIA } = await carregarScoring();
    const r = await ajusteIA(LEAD_TRIAGEM);
    assert.equal(r.ajuste, ajuste);
    assert.equal(r.justificativa, justificativa);
  }
});

// ── generate-evaluation.ts ──────────────────────────────────────────────────

const LEAD_AVALIACAO = {
  nome: 'Candidato (MOCK #01)',
  data_nascimento: '',            // keeps the rendered age fixed ("não informada")
  altura: '1,80',
  peso: '86',
  objetivo: 'Hipertrofia',
  atividade_fisica: 'Musculação',
  frequencia_semanal: '5',
  disponibilidade_diaria: '1,5',
  competicao: 'Sim',
  competicao_detalhe: 'Estadual 2025',
  trt: 'Não',
  lesao: 'Sim',
  lesao_detalhe: 'Ombro',
  suplementos: 'Sim',
  suplementos_detalhe: 'Creatina',
  agua_litros: '4',
  fotos_paths: ['leads/u1/foto-1.webp', 'leads/u1/foto-2.webp', 'leads/u1/foto-falha.webp'],
};

/** Firebase doubles for generate-evaluation; returns counters for assertions. */
function instalarFirebase(t, { lead = LEAD_AVALIACAO, admin = true } = {}) {
  const contador = { downloads: [] };
  globalThis.__e90Stubs = {
    './_firebase': {
      getApp: () => ({}),
      storageBucketName: () => 'bucket-de-teste',
      getDb: () => ({
        collection(nome) {
          if (nome === 'leads') {
            return { doc: () => ({ get: async () => ({ exists: lead !== null, data: () => lead }) }) };
          }
          if (nome === 'avaliacoes') {
            const consulta = {
              orderBy: () => consulta,
              limit: () => consulta,
              get: async () => ({
                docs: [
                  { data: () => ({ content_s1: 'Calibração A.' }) },
                  { data: () => ({}) },
                  { data: () => ({ content_s1: 'Calibração C.' }) },
                ],
              }),
            };
            return consulta;
          }
          throw new Error(`unexpected collection ${nome}`);
        },
      }),
    },
    'firebase-admin/auth': {
      getAuth: () => ({
        verifyIdToken: async (token) => {
          if (token === 'invalido') throw new Error('bad token');
          return { uid: 'coach', admin: admin === true };
        },
      }),
    },
    'firebase-admin/storage': {
      getStorage: () => ({
        bucket: () => ({
          file: (p) => ({
            download: async () => {
              contador.downloads.push(p);
              if (p.includes('falha')) throw new Error('not found');
              return [Buffer.from(`imagem:${p}`)];
            },
          }),
        }),
      }),
    },
  };
  t.after(() => { delete globalThis.__e90Stubs; });
  return contador;
}

function evento(corpo, { metodo = 'POST', token = 'admin' } = {}) {
  return {
    httpMethod: metodo,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  };
}

async function carregarAvaliacao() {
  return carregarTs('netlify/functions/generate-evaluation.ts');
}

const SECOES_OK = { s1: 'Um.', s2: 'Dois.', s3: 'Três.', s4: 'Quatro.', s5: 'Cinco.' };

test('avaliação · método, autenticação e entrada (sem chamada ao modelo)', async (t) => {
  definirChave(t, CHAVE);
  const chamadas = instalarFetch(t, () => { throw new Error('must not be called'); });
  const { handler } = await carregarAvaliacao();

  instalarFirebase(t);
  assert.deepEqual(await handler(evento({ leadId: 'L1' }, { metodo: 'GET' })), { statusCode: 405, body: 'Method Not Allowed' });
  assert.deepEqual(await handler(evento({ leadId: 'L1' }, { token: null })), { statusCode: 401, body: 'Unauthorized' });
  assert.deepEqual(await handler(evento({ leadId: 'L1' }, { token: 'invalido' })), { statusCode: 401, body: 'Invalid token' });
  assert.deepEqual(await handler(evento({})), { statusCode: 400, body: 'leadId obrigatório' });

  instalarFirebase(t, { admin: false });
  assert.deepEqual(await handler(evento({ leadId: 'L1' })), { statusCode: 403, body: 'Acesso não autorizado' });

  instalarFirebase(t, { lead: null });
  assert.deepEqual(await handler(evento({ leadId: 'L1' })), { statusCode: 404, body: 'Lead não encontrado' });

  assert.equal(chamadas.length, 0);
});

test('avaliação · sem chave: 500 depois de ler calibração e fotos, nenhuma chamada', async (t) => {
  definirChave(t, undefined);
  silenciarConsole(t);
  const chamadas = instalarFetch(t, () => { throw new Error('must not be called'); });
  const contador = instalarFirebase(t);
  const { handler } = await carregarAvaliacao();
  const r = await handler(evento({ leadId: 'L1' }));
  assert.deepEqual(r, { statusCode: 500, body: 'GOOGLE_GEMINI_KEY não configurada' });
  assert.equal(chamadas.length, 0);
  assert.equal(contador.downloads.length, 3);
});

test('avaliação · sucesso (pt, com fotos): requisição exata e seções devolvidas', async (t) => {
  definirChave(t, CHAVE);
  silenciarConsole(t);
  const chamadas = instalarFetch(t, () => resposta({ json: envelope(JSON.stringify(SECOES_OK)) }));
  instalarFirebase(t);
  const { handler } = await carregarAvaliacao();
  const r = await handler(evento({ leadId: 'L1' }));
  assert.equal(r.statusCode, 200);
  const corpo = JSON.parse(r.body);
  assert.equal(corpo.success, true);
  assert.deepEqual(corpo.sections, SECOES_OK);
  assert.equal(corpo.leadName, LEAD_AVALIACAO.nome);
  assert.equal(chamadas.length, 1);
  conferirFotografia('requisicao-avaliacao-rascunho-pt-fotos.json', normalizarRequisicao(chamadas[0].url, chamadas[0].init));
});

test('avaliação · sucesso (en, sem fotos): requisição exata', async (t) => {
  definirChave(t, CHAVE);
  const chamadas = instalarFetch(t, () => resposta({ json: envelope(JSON.stringify(SECOES_OK)) }));
  instalarFirebase(t, { lead: { ...LEAD_AVALIACAO, idioma: 'en', fotos_paths: [] } });
  const { handler } = await carregarAvaliacao();
  const r = await handler(evento({ leadId: 'L1' }));
  assert.equal(r.statusCode, 200);
  conferirFotografia('requisicao-avaliacao-rascunho-en.json', normalizarRequisicao(chamadas[0].url, chamadas[0].init));
});

test('avaliação · HTTP não-ok: 500 com o corpo devolvido pela API', async (t) => {
  definirChave(t, CHAVE);
  silenciarConsole(t);
  instalarFetch(t, () => resposta({ status: 400, texto: '{"error":"bad request"}' }));
  instalarFirebase(t);
  const { handler } = await carregarAvaliacao();
  const r = await handler(evento({ leadId: 'L1' }));
  assert.deepEqual(r, { statusCode: 500, body: JSON.stringify({ error: 'Gemini error: {"error":"bad request"}' }) });
});

test('avaliação · falha de rede: 500 com a mensagem da exceção', async (t) => {
  definirChave(t, CHAVE);
  silenciarConsole(t);
  instalarFetch(t, () => { throw new TypeError('fetch failed'); });
  instalarFirebase(t);
  const { handler } = await carregarAvaliacao();
  const r = await handler(evento({ leadId: 'L1' }));
  assert.deepEqual(r, { statusCode: 500, body: JSON.stringify({ error: 'fetch failed' }) });
});

test('avaliação · envelope que não é JSON: 500 com a mensagem do parser', async (t) => {
  definirChave(t, CHAVE);
  silenciarConsole(t);
  instalarFetch(t, () => resposta({ jsonLanca: new SyntaxError('Unexpected token < in JSON at position 0') }));
  instalarFirebase(t);
  const { handler } = await carregarAvaliacao();
  const r = await handler(evento({ leadId: 'L1' }));
  assert.deepEqual(r, { statusCode: 500, body: JSON.stringify({ error: 'Unexpected token < in JSON at position 0' }) });
});

async function secoesPara(t, corpoResposta) {
  definirChave(t, CHAVE);
  silenciarConsole(t);
  instalarFetch(t, () => resposta({ json: corpoResposta }));
  instalarFirebase(t);
  const { handler } = await carregarAvaliacao();
  const r = await handler(evento({ leadId: 'L1' }));
  assert.equal(r.statusCode, 200);
  return JSON.parse(r.body).sections;
}

test('avaliação · JSON truncado: reparo fecha a seção cortada e cria as que faltam', async (t) => {
  const s = await secoesPara(t, envelope('{"s1": "Um.", "s2": "Dois cort'));
  assert.deepEqual(s, { s1: 'Um.', s2: 'Dois cort', s3: '', s4: '', s5: '' });
});

test('avaliação · seção vazia: devolvida como veio', async (t) => {
  const s = await secoesPara(t, envelope(JSON.stringify({ ...SECOES_OK, s4: '' })));
  assert.deepEqual(s, { ...SECOES_OK, s4: '' });
});

test('avaliação · texto que não é JSON: vai inteiro para s1', async (t) => {
  const s = await secoesPara(t, envelope('texto livre sem estrutura'));
  assert.deepEqual(s, { s1: 'texto livre sem estrutura', s2: '', s3: '', s4: '', s5: '' });
});

test('avaliação · resposta sem candidato (vazia ou bloqueada): seções vazias', async (t) => {
  for (const corpo of [{}, { promptFeedback: { blockReason: 'SAFETY' } }, { candidates: [{ finishReason: 'SAFETY' }] }]) {
    const s = await secoesPara(t, corpo);
    assert.deepEqual(s, {});
  }
});

test('avaliação · envelope null: 500 com a mensagem do acesso a candidates', async (t) => {
  definirChave(t, CHAVE);
  silenciarConsole(t);
  instalarFetch(t, () => resposta({ json: null }));
  instalarFirebase(t);
  const { handler } = await carregarAvaliacao();
  const r = await handler(evento({ leadId: 'L1' }));
  assert.deepEqual(r, { statusCode: 500, body: JSON.stringify({ error: "Cannot read properties of null (reading 'candidates')" }) });
});

test('avaliação · HTTP não-ok cujo corpo não pode ser lido: 500 com a mensagem da leitura', async (t) => {
  definirChave(t, CHAVE);
  silenciarConsole(t);
  instalarFetch(t, () => ({ ok: false, status: 502, async text() { throw new Error('body unavailable'); } }));
  instalarFirebase(t);
  const { handler } = await carregarAvaliacao();
  const r = await handler(evento({ leadId: 'L1' }));
  assert.deepEqual(r, { statusCode: 500, body: JSON.stringify({ error: 'body unavailable' }) });
});

test('avaliação · texto vazio: reparo devolve as cinco seções vazias', async (t) => {
  const s = await secoesPara(t, envelope(''));
  assert.deepEqual(s, { s1: '', s2: '', s3: '', s4: '', s5: '' });
});
