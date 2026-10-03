// tests/llm-nucleo.test.js
// Pure core of the shared model-access module — T-17 (Addendum 10 v1.4, §3.7;
// persistence plan v5.29, Phase 8, delivery 1): request validation, request
// shape (key in the header), the closed error vocabulary, the mandatory
// timeout, the model version, optional validation, and the draft provenance
// read by send-evaluation (DP-12).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MODELO_PADRAO,
  TAREFAS,
  ERROS,
  TEMPO_LIMITE_MAXIMO_MS,
  versaoDeComandoValida,
  versaoDeModeloValida,
  defeitoDoPedido,
  montarRequisicao,
  chamarModelo,
  lerProcedencia,
} = require('../netlify/functions/_llm-nucleo.js');

const CHAVE = 'chave-xyz';

function pedido(extra = {}) {
  return {
    tarefa: 'triagem-ajuste',
    promptVersion: 'triagem-ajuste/v1',
    partes: [{ texto: 'olá' }],
    esquema: { type: 'OBJECT' },
    temperatura: 0.2,
    maxTokensSaida: 256,
    tempoLimiteMs: 1000,
    ...extra,
  };
}

function resposta(corpo, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

function envelope(texto, extra = {}) {
  return { candidates: [{ content: { parts: [{ text: texto }] }, finishReason: 'STOP' }], modelVersion: 'gemini-2.5-flash-001', ...extra };
}

test('vocabulários fechados', () => {
  assert.deepEqual([...TAREFAS], ['triagem-ajuste', 'avaliacao-rascunho']);
  assert.ok(!TAREFAS.includes('anonimizacao'), 'anonimização é especificada, não implementada nesta entrega');
  assert.deepEqual([...ERROS], ['sem-chave', 'tempo-esgotado', 'http', 'bloqueado', 'fora-do-formato', 'vazio', 'pedido-invalido']);
  assert.equal(TEMPO_LIMITE_MAXIMO_MS, 60000);
});

test('promptVersion: "<tarefa>/v<n>", tarefa do vocabulário, n ≥ 1', () => {
  assert.equal(versaoDeComandoValida('triagem-ajuste', 'triagem-ajuste/v1'), true);
  assert.equal(versaoDeComandoValida('avaliacao-rascunho', 'avaliacao-rascunho/v12'), true);
  assert.equal(versaoDeComandoValida('triagem-ajuste', 'avaliacao-rascunho/v1'), false);
  assert.equal(versaoDeComandoValida('triagem-ajuste', 'triagem-ajuste/v0'), false);
  assert.equal(versaoDeComandoValida('triagem-ajuste', 'triagem-ajuste/v01'), false);
  assert.equal(versaoDeComandoValida('triagem-ajuste', 'triagem-ajuste/1'), false);
  assert.equal(versaoDeComandoValida('anonimizacao', 'anonimizacao/v1'), false);
  assert.equal(versaoDeModeloValida('gemini-2.5-flash'), true);
  assert.equal(versaoDeModeloValida('models/gemini-2.5-flash-001'), true);
  assert.equal(versaoDeModeloValida('com espaço'), false);
  assert.equal(versaoDeModeloValida(''), false);
  assert.equal(versaoDeModeloValida(null), false);
});

test('pedido inválido: recusado sem chamada e sem lançar', async () => {
  const casos = [
    [null, 'pedido ausente'],
    [pedido({ tarefa: 'anonimizacao', promptVersion: 'anonimizacao/v1' }), 'tarefa fora do vocabulário'],
    [pedido({ promptVersion: 'v1' }), 'promptVersion'],
    [pedido({ partes: [] }), 'partes vazias'],
    [pedido({ partes: [{ html: 'x' }] }), 'parte inválida'],
    [pedido({ temperatura: 3 }), 'temperatura'],
    [pedido({ maxTokensSaida: 0 }), 'maxTokensSaida'],
    [pedido({ tempoLimiteMs: undefined }), 'tempoLimiteMs'],
    [pedido({ tempoLimiteMs: 60001 }), 'tempoLimiteMs'],
    [pedido({ esquema: null }), 'esquema'],
  ];
  for (const [p, trecho] of casos) {
    assert.match(String(defeitoDoPedido(p)), new RegExp(trecho));
    let chamou = false;
    const r = await chamarModelo(p, { chave: CHAVE, fetch: () => { chamou = true; } });
    assert.equal(r.ok, false);
    assert.equal(r.erro, 'pedido-invalido');
    assert.equal(chamou, false);
  }
  assert.equal(defeitoDoPedido(pedido()), null);
});

test('requisição: chave no cabeçalho, nunca na URL; corpo na ordem das chamadas originais', () => {
  const { url, init } = montarRequisicao(pedido({
    partes: [{ texto: 'a' }, { imagem: { mimeType: 'image/webp', base64: 'QUJD' } }],
  }), CHAVE);
  assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_PADRAO}:generateContent`);
  assert.ok(!url.includes(CHAVE));
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json', 'x-goog-api-key': CHAVE });
  assert.equal(init.body, JSON.stringify({
    contents: [{ parts: [{ text: 'a' }, { inlineData: { mimeType: 'image/webp', data: 'QUJD' } }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 256, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } },
  }));
  const semEsquema = JSON.parse(montarRequisicao(pedido({ esquema: undefined }), CHAVE).init.body);
  assert.deepEqual(semEsquema.generationConfig, { temperature: 0.2, maxOutputTokens: 256 });
  assert.match(montarRequisicao(pedido({ modelo: 'gemini-x' }), CHAVE).url, /models\/gemini-x:generateContent$/);
});

test('sem chave: nenhuma chamada', async () => {
  let chamou = false;
  const r = await chamarModelo(pedido(), { chave: '', fetch: () => { chamou = true; } });
  assert.deepEqual(r, { ok: false, erro: 'sem-chave', promptVersion: 'triagem-ajuste/v1', modelVersion: null });
  assert.equal(chamou, false);
});

test('sucesso: valor, texto, versões, motivo de término; o sinal de aborto vai na requisição', async () => {
  let recebido;
  const r = await chamarModelo(pedido(), {
    chave: CHAVE,
    fetch: async (url, init) => { recebido = init; return resposta(envelope('{"a":1}')); },
  });
  assert.deepEqual(r, {
    ok: true, valor: { a: 1 }, texto: '{"a":1}', promptVersion: 'triagem-ajuste/v1',
    modelVersion: 'gemini-2.5-flash-001', finishReason: 'STOP', truncado: false,
  });
  assert.ok(recebido.signal instanceof AbortSignal);
});

test('modelVersion: da resposta; na falta (ou inválido), o modelo pedido', async () => {
  for (const [extra, esperado] of [[{ modelVersion: undefined }, MODELO_PADRAO], [{ modelVersion: 'x y' }, MODELO_PADRAO]]) {
    const r = await chamarModelo(pedido(), { chave: CHAVE, fetch: async () => resposta(envelope('1', extra)) });
    assert.equal(r.modelVersion, esperado);
  }
  const r = await chamarModelo(pedido({ modelo: 'gemini-x' }), { chave: CHAVE, fetch: async () => resposta(envelope('1', { modelVersion: undefined })) });
  assert.equal(r.modelVersion, 'gemini-x');
});

test('http: rede, status e envelope distinguidos por `etapa`', async () => {
  const rede = await chamarModelo(pedido(), { chave: CHAVE, fetch: async () => { throw new TypeError('fetch failed'); } });
  assert.deepEqual(rede, { ok: false, erro: 'http', etapa: 'rede', status: null, detalhe: 'fetch failed', promptVersion: 'triagem-ajuste/v1', modelVersion: null });

  const status = await chamarModelo(pedido(), { chave: CHAVE, fetch: async () => ({ ok: false, status: 429, text: async () => 'quota' }) });
  assert.equal(status.etapa, 'status');
  assert.equal(status.status, 429);
  assert.equal(status.detalhe, 'quota');

  const corpoIlegivel = await chamarModelo(pedido(), { chave: CHAVE, fetch: async () => ({ ok: false, status: 502, text: async () => { throw new Error('lost'); } }) });
  assert.equal(corpoIlegivel.etapa, 'rede');
  assert.equal(corpoIlegivel.detalhe, 'lost');

  const envelopeInvalido = await chamarModelo(pedido(), { chave: CHAVE, fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }) });
  assert.equal(envelopeInvalido.etapa, 'envelope');
  assert.equal(envelopeInvalido.detalhe, 'bad json');

  const envelopeNulo = await chamarModelo(pedido(), { chave: CHAVE, fetch: async () => resposta(null) });
  assert.equal(envelopeNulo.etapa, 'envelope');
  assert.match(envelopeNulo.detalhe, /candidates/);

  const naoErro = await chamarModelo(pedido(), { chave: CHAVE, fetch: async () => { throw 'string thrown'; } });
  assert.equal(naoErro.detalhe, 'string thrown');
});

test('sem texto: bloqueado (pelo prompt ou pelo motivo de término) ou vazio', async () => {
  const casos = [
    [{ promptFeedback: { blockReason: 'SAFETY' } }, 'bloqueado'],
    [{ candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] }, 'bloqueado'],
    [{ candidates: [{ finishReason: 'STOP', content: { parts: [{}] } }] }, 'vazio'],
    [{}, 'vazio'],
  ];
  for (const [corpo, erro] of casos) {
    const r = await chamarModelo(pedido(), { chave: CHAVE, fetch: async () => resposta(corpo) });
    assert.equal(r.ok, false);
    assert.equal(r.erro, erro);
    assert.equal(r.modelVersion, MODELO_PADRAO, 'an envelope was read');
  }
});

test('fora do formato: texto bruto devolvido; truncado quando MAX_TOKENS', async () => {
  const r = await chamarModelo(pedido(), {
    chave: CHAVE,
    fetch: async () => resposta({ candidates: [{ content: { parts: [{ text: '{"a": "cor' }] }, finishReason: 'MAX_TOKENS' }] }),
  });
  assert.equal(r.erro, 'fora-do-formato');
  assert.equal(r.textoBruto, '{"a": "cor');
  assert.equal(r.truncado, true);
  assert.equal(r.finishReason, 'MAX_TOKENS');
});

test('validação opcional: recusa (ou exceção) vira fora-do-formato com o texto bruto', async () => {
  const fetch = async () => resposta(envelope('{"codigo":"X"}'));
  const aceita = await chamarModelo(pedido(), { chave: CHAVE, fetch, validar: (v) => v.codigo === 'X' });
  assert.equal(aceita.ok, true);
  const recusa = await chamarModelo(pedido(), { chave: CHAVE, fetch, validar: () => false });
  assert.equal(recusa.erro, 'fora-do-formato');
  assert.equal(recusa.textoBruto, '{"codigo":"X"}');
  const lanca = await chamarModelo(pedido(), { chave: CHAVE, fetch, validar: () => { throw new Error('x'); } });
  assert.equal(lanca.erro, 'fora-do-formato');
});

test('tempo limite: requisição que não responde', async () => {
  let abortado = false;
  const r = await chamarModelo(pedido({ tempoLimiteMs: 30 }), {
    chave: CHAVE,
    fetch: (url, init) => new Promise(() => { init.signal.addEventListener('abort', () => { abortado = true; }); }),
  });
  assert.deepEqual(r, { ok: false, erro: 'tempo-esgotado', promptVersion: 'triagem-ajuste/v1', modelVersion: null });
  assert.equal(abortado, true, 'the request is aborted, not left running');
});

test('tempo limite: corpo que não termina de chegar', async () => {
  const r = await chamarModelo(pedido({ tempoLimiteMs: 30 }), {
    chave: CHAVE,
    fetch: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
  });
  assert.equal(r.erro, 'tempo-esgotado');
});

test('tempo limite: resposta a tempo não é afetada pelo relógio', async () => {
  const r = await chamarModelo(pedido({ tempoLimiteMs: 200 }), { chave: CHAVE, fetch: async () => resposta(envelope('1')) });
  assert.equal(r.ok, true);
});

test('procedência do rascunho (DP-12): ausente, válida e malformada', () => {
  const T = 'avaliacao-rascunho';
  assert.deepEqual(lerProcedencia(undefined, T), { ok: true, valor: { aiDrafted: false, promptVersion: null, modelVersion: null } });
  assert.deepEqual(lerProcedencia(null, T), { ok: true, valor: { aiDrafted: false, promptVersion: null, modelVersion: null } });
  assert.deepEqual(
    lerProcedencia({ promptVersion: 'avaliacao-rascunho/v1', modelVersion: 'gemini-2.5-flash' }, T),
    { ok: true, valor: { aiDrafted: true, promptVersion: 'avaliacao-rascunho/v1', modelVersion: 'gemini-2.5-flash' } },
  );
  assert.deepEqual(
    lerProcedencia({ promptVersion: 'avaliacao-rascunho/v2', modelVersion: null }, T).valor,
    { aiDrafted: true, promptVersion: 'avaliacao-rascunho/v2', modelVersion: null },
  );
  for (const ruim of [
    'texto',
    [],
    { promptVersion: 'triagem-ajuste/v1', modelVersion: 'm' },
    { promptVersion: 'avaliacao-rascunho/v1', modelVersion: 'com espaço' },
    { promptVersion: 'avaliacao-rascunho/v1', extra: 1 },
    {},
  ]) {
    assert.equal(lerProcedencia(ruim, T).ok, false, JSON.stringify(ruim));
  }
});
