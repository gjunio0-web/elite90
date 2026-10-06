// ELITE90 PRO · _llm-nucleo
// -----------------------------------------------------------------------------
// Pure core of the shared model-access module — T-17 (Addendum 10 v1.4, §3.7;
// persistence plan v5.29, Phase 8, delivery 1; decisions DP-12, DP-13, E-8).
//
// WHY A COMMONJS MODULE
// Same arrangement as _checkin.js and _relatorio.js: imported by the
// TypeScript layer (_llm.ts) and loaded directly by the Node.js test runner.
// No Firestore, no environment, no global fetch: the key and the fetch
// function are passed in, so every branch is testable without the network.
//
// WHAT THIS MODULE GUARANTEES
//   · One path to the model. Every call goes through `chamarModelo`.
//   · A closed vocabulary of tasks (TAREFAS). A task enters the vocabulary
//     when its function is written — `anonimizacao` is specified below and is
//     NOT in the vocabulary yet (delivery 3 of Phase 8).
//   · `promptVersion` is declared by the caller, next to the prompt text, in
//     the form "<task>/v<n>". The module checks the form; the snapshot tests
//     in tests/llm-comandos.test.js check that the text did not change
//     without the version changing.
//   · `modelVersion` comes from the `modelVersion` field of the API response;
//     when the response does not carry it, from the model that was requested.
//   · A timeout on every call (DP-13). The deadline covers the request and
//     the reading of the response body.
//   · The API key travels in the `x-goog-api-key` header, never in the URL.
//   · NEVER THROWS. Every outcome is a value: success, or an error from the
//     closed vocabulary ERROS, with the raw text when the model produced one.
//   · No database writes and no traceability events. The module does not
//     know what its callers persist.
//
// SPECIFIED, NOT IMPLEMENTED — the anonymization interface (plan v5.29,
// Phase 8, delivery 3; Addendum 04 v1.13). It will be a function of its own,
// built on `chamarModelo` with task "anonimizacao":
//
//   anonimizarTextos({
//     textos: [{ id, texto }],                 // already after Layer 1
//     identificadores: { nomes, emails, telefones, cpfs, datas, arquivos,
//                        registrosProfissionais },
//   }) → { ok: true, propostas: [{ id, proposto,
//            alteracoes: [{ original, substituto, categoria }] }],
//          promptVersion, modelVersion }
//      | { ok: false, erro }                   // the screen falls back to manual
//
//   "Never adds" is checked deterministically: every `original` must occur in
//   the text, and applying the `alteracoes` to the text must reproduce
//   `proposto`; a proposal that does not close is discarded. Layer 1 stays
//   outside this module and runs before and after the model.
// -----------------------------------------------------------------------------

'use strict';

/** Model used when the request does not name one. */
const MODELO_PADRAO = 'gemini-2.5-flash';

const ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

/** Closed vocabulary of tasks. */
const TAREFAS = Object.freeze(['triagem-ajuste', 'avaliacao-rascunho']);

/** Closed vocabulary of errors. */
const ERROS = Object.freeze([
  'sem-chave',
  'tempo-esgotado',
  'http',
  'bloqueado',
  'fora-do-formato',
  'vazio',
  'pedido-invalido',
]);

/**
 * Upper bound for any timeout: the execution limit of a synchronous Netlify
 * function (60 s). A call cannot be allowed to outlive the function.
 */
const TEMPO_LIMITE_MAXIMO_MS = 60000;

/** Finish reasons that mean the answer was withheld for policy reasons. */
const MOTIVOS_DE_BLOQUEIO = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
]);

/** "<task>/v<n>", n ≥ 1, for a task of the vocabulary. */
function versaoDeComandoValida(tarefa, versao) {
  if (!TAREFAS.includes(tarefa) || typeof versao !== 'string') return false;
  const prefixo = `${tarefa}/v`;
  return versao.startsWith(prefixo) && /^[1-9]\d*$/.test(versao.slice(prefixo.length));
}

/** A model identifier as the API returns it: short, no spaces. */
function versaoDeModeloValida(versao) {
  return typeof versao === 'string' && /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,99}$/.test(versao);
}

function inteiroPositivo(v) {
  return Number.isInteger(v) && v > 0;
}

/** Returns null when the request is well formed, or a description of the defect. */
function defeitoDoPedido(p) {
  if (!p || typeof p !== 'object') return 'pedido ausente';
  if (!TAREFAS.includes(p.tarefa)) return `tarefa fora do vocabulário: ${String(p.tarefa)}`;
  if (!versaoDeComandoValida(p.tarefa, p.promptVersion)) {
    return `promptVersion deve ter a forma "${p.tarefa}/v<n>"`;
  }
  if (p.modelo !== undefined && !versaoDeModeloValida(p.modelo)) return 'modelo inválido';
  if (!Array.isArray(p.partes) || p.partes.length === 0) return 'partes vazias';
  for (const parte of p.partes) {
    const ehTexto = parte && typeof parte.texto === 'string';
    const ehImagem = parte && parte.imagem
      && typeof parte.imagem.mimeType === 'string' && typeof parte.imagem.base64 === 'string';
    if (!ehTexto && !ehImagem) return 'parte inválida';
  }
  if (p.esquema !== undefined && (p.esquema === null || typeof p.esquema !== 'object')) return 'esquema inválido';
  if (typeof p.temperatura !== 'number' || !(p.temperatura >= 0 && p.temperatura <= 2)) return 'temperatura inválida';
  if (!inteiroPositivo(p.maxTokensSaida)) return 'maxTokensSaida inválido';
  if (!inteiroPositivo(p.tempoLimiteMs) || p.tempoLimiteMs > TEMPO_LIMITE_MAXIMO_MS) {
    return `tempoLimiteMs obrigatório, entre 1 e ${TEMPO_LIMITE_MAXIMO_MS}`;
  }
  return null;
}

/**
 * Builds the HTTP request. Body fields keep the order the two original call
 * sites used (contents, then generationConfig with temperature,
 * maxOutputTokens, responseMimeType, responseSchema): the characterization
 * snapshots compare the body byte by byte.
 */
function montarRequisicao(pedido, chave) {
  const modelo = pedido.modelo || MODELO_PADRAO;
  const generationConfig = {
    temperature: pedido.temperatura,
    maxOutputTokens: pedido.maxTokensSaida,
  };
  if (pedido.esquema !== undefined) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = pedido.esquema;
  }
  const parts = pedido.partes.map((parte) => (typeof parte.texto === 'string'
    ? { text: parte.texto }
    : { inlineData: { mimeType: parte.imagem.mimeType, data: parte.imagem.base64 } }));
  return {
    url: `${ENDPOINT_BASE}${modelo}:generateContent`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave },
      body: JSON.stringify({ contents: [{ parts }], generationConfig }),
    },
  };
}

class TempoEsgotado extends Error {}

function mensagemDe(e) {
  return e && typeof e.message === 'string' ? e.message : String(e);
}

/**
 * Calls the model. `ambiente` = { chave, fetch, validar? }.
 *
 * Success: { ok: true, valor, texto, promptVersion, modelVersion,
 *            finishReason, truncado }
 *   `valor` is the parsed JSON of the first text part; `texto` is that part
 *   verbatim, for callers that post-process the raw text.
 *
 * Error: { ok: false, erro, promptVersion, modelVersion, ... }
 *   sem-chave        — no key configured; nothing was sent.
 *   tempo-esgotado   — the deadline passed before the answer was read.
 *   http             — `etapa: "rede"` (the request failed), `"status"` (non-2xx;
 *                      `detalhe` is the response body) or `"envelope"` (2xx whose
 *                      body is not JSON); `status` and `detalhe` carried.
 *   bloqueado        — no text, and the API says the prompt or the answer was blocked.
 *   vazio            — no text, for any other reason.
 *   fora-do-formato  — text that is not JSON, or that `validar` refused;
 *                      `textoBruto` carries the text.
 *   pedido-invalido  — the request itself is malformed (`detalhe` says why);
 *                      nothing was sent.
 * `modelVersion` is null whenever no response envelope was read.
 */
/**
 * Lê UM objeto JSON dentro de um texto que o modelo cercou de prosa ou de cercas
 * de código ("Here is the JSON requested: ```json {…} ```"). O modo de saída
 * estruturada não garante, na prática, que a resposta seja só o JSON: em produção
 * (05/10/2026) o modelo devolveu "Here is th…" e o ajuste da triagem se perdeu.
 *
 * Só chamada quando JSON.parse do texto inteiro já falhou, então o texto que já
 * era JSON válido não passa por aqui. Procura o primeiro objeto bem formado e
 * balanceado; chaves dentro de strings não contam; um objeto truncado (sem fecho)
 * não é recuperado — esse caso segue como 'fora-do-formato' e, no rascunho de
 * avaliação, para o reparo próprio de truncamento.
 *
 * Devolve { valor, json } (json = só o trecho extraído) ou null.
 */
const LIMITE_EXTRACAO = 200000;

function fimDoObjeto(texto, inicio) {
  let profundidade = 0;
  let emTexto = false;
  let escape = false;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (emTexto) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') emTexto = false;
      continue;
    }
    if (c === '"') emTexto = true;
    else if (c === '{') profundidade++;
    else if (c === '}') {
      profundidade--;
      if (profundidade === 0) return i;
    }
  }
  return -1;
}

function extrairJson(texto) {
  if (typeof texto !== 'string' || texto.length === 0 || texto.length > LIMITE_EXTRACAO) return null;
  for (let inicio = texto.indexOf('{'); inicio !== -1; inicio = texto.indexOf('{', inicio + 1)) {
    const fim = fimDoObjeto(texto, inicio);
    if (fim === -1) continue;
    const trecho = texto.slice(inicio, fim + 1);
    try {
      const valor = JSON.parse(trecho);
      if (valor !== null && typeof valor === 'object' && !Array.isArray(valor)) return { valor, json: trecho };
    } catch { /* não era JSON: tenta o próximo '{' */ }
  }
  return null;
}

async function chamarModelo(pedido, ambiente) {
  const promptVersion = pedido && typeof pedido.promptVersion === 'string' ? pedido.promptVersion : null;
  const defeito = defeitoDoPedido(pedido);
  if (defeito) return { ok: false, erro: 'pedido-invalido', detalhe: defeito, promptVersion, modelVersion: null };

  const { chave, fetch: buscar, validar } = ambiente || {};
  if (!chave) return { ok: false, erro: 'sem-chave', promptVersion, modelVersion: null };
  if (typeof buscar !== 'function') {
    return { ok: false, erro: 'pedido-invalido', detalhe: 'fetch ausente', promptVersion, modelVersion: null };
  }

  const { url, init } = montarRequisicao(pedido, chave);
  const controle = new AbortController();
  let expirou = false;
  let relogio;
  const prazo = new Promise((_, rejeitar) => {
    relogio = setTimeout(() => {
      expirou = true;
      controle.abort();
      rejeitar(new TempoEsgotado());
    }, pedido.tempoLimiteMs);
  });
  // The deadline races every await, so a body that never finishes arriving
  // still ends the call on time.
  const comPrazo = (promessa) => Promise.race([promessa, prazo]);
  const tempoEsgotado = () => ({ ok: false, erro: 'tempo-esgotado', promptVersion, modelVersion: null });
  prazo.catch(() => {});

  try {
    let res;
    try {
      res = await comPrazo(Promise.resolve().then(() => buscar(url, { ...init, signal: controle.signal })));
    } catch (e) {
      if (expirou || e instanceof TempoEsgotado) return tempoEsgotado();
      return { ok: false, erro: 'http', etapa: 'rede', status: null, detalhe: mensagemDe(e), promptVersion, modelVersion: null };
    }

    if (!res || !res.ok) {
      let corpo;
      try {
        corpo = await comPrazo(Promise.resolve().then(() => res.text()));
      } catch (e) {
        if (expirou || e instanceof TempoEsgotado) return tempoEsgotado();
        // The body could not be read: report the reading failure itself, as
        // the original evaluation call did when `text()` rejected.
        return { ok: false, erro: 'http', etapa: 'rede', status: res ? res.status : null, detalhe: mensagemDe(e), promptVersion, modelVersion: null };
      }
      return {
        ok: false, erro: 'http', etapa: 'status', status: res ? res.status : null,
        detalhe: String(corpo ?? ''), promptVersion, modelVersion: null,
      };
    }

    let envelope;
    try {
      envelope = await comPrazo(Promise.resolve().then(() => res.json()));
    } catch (e) {
      if (expirou || e instanceof TempoEsgotado) return tempoEsgotado();
      return { ok: false, erro: 'http', etapa: 'envelope', status: res.status, detalhe: mensagemDe(e), promptVersion, modelVersion: null };
    }

    // Same access chain as both original call sites: the first candidate, its
    // first part. A `null` envelope fails here exactly as it failed there.
    let candidato;
    let bruto;
    try {
      candidato = envelope.candidates?.[0];
      bruto = candidato?.content?.parts?.[0]?.text;
    } catch (e) {
      return { ok: false, erro: 'http', etapa: 'envelope', status: res.status, detalhe: mensagemDe(e), promptVersion, modelVersion: null };
    }
    const modelVersion = versaoDeModeloValida(envelope.modelVersion)
      ? envelope.modelVersion
      : (pedido.modelo || MODELO_PADRAO);
    const finishReason = typeof candidato?.finishReason === 'string' ? candidato.finishReason : null;

    if (bruto === undefined || bruto === null) {
      const bloqueado = Boolean(envelope.promptFeedback?.blockReason)
        || (finishReason !== null && MOTIVOS_DE_BLOQUEIO.has(finishReason));
      return { ok: false, erro: bloqueado ? 'bloqueado' : 'vazio', finishReason, promptVersion, modelVersion };
    }

    const texto = String(bruto);
    const truncado = finishReason === 'MAX_TOKENS';
    let valor;
    let textoJson = texto;
    let recuperado = false;
    try {
      valor = JSON.parse(texto);
    } catch {
      const achado = extrairJson(texto);
      if (!achado) {
        return { ok: false, erro: 'fora-do-formato', textoBruto: texto, finishReason, truncado, promptVersion, modelVersion };
      }
      valor = achado.valor;
      textoJson = achado.json;
      recuperado = true;
    }
    if (typeof validar === 'function') {
      let aceito = false;
      try { aceito = validar(valor) === true; } catch { aceito = false; }
      if (!aceito) {
        return { ok: false, erro: 'fora-do-formato', textoBruto: texto, finishReason, truncado, promptVersion, modelVersion };
      }
    }
    // `texto` é o JSON em si (o trecho extraído, quando a resposta vinha cercada de prosa).
    return { ok: true, valor, texto: textoJson, recuperado, promptVersion, modelVersion, finishReason, truncado };
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Provenance of a draft the panel sends back with the text the Coach approved
 * (DP-12). `entrada` is what generate-evaluation returned — `{ promptVersion,
 * modelVersion }` — or null/undefined when no model draft was generated.
 * Returns { ok: true, valor: { aiDrafted, promptVersion, modelVersion } } or
 * { ok: false, erro } for a malformed value. Records only what the server
 * itself produced: the prompt version must belong to `tarefa`.
 */
function lerProcedencia(entrada, tarefa) {
  if (entrada === undefined || entrada === null) {
    return { ok: true, valor: { aiDrafted: false, promptVersion: null, modelVersion: null } };
  }
  if (typeof entrada !== 'object' || Array.isArray(entrada)) return { ok: false, erro: 'aiDraft precisa ser um objeto ou nulo.' };
  const chaves = Object.keys(entrada);
  if (chaves.some((k) => k !== 'promptVersion' && k !== 'modelVersion')) {
    return { ok: false, erro: 'aiDraft aceita só promptVersion e modelVersion.' };
  }
  if (!versaoDeComandoValida(tarefa, entrada.promptVersion)) {
    return { ok: false, erro: `aiDraft.promptVersion precisa ter a forma "${tarefa}/v<n>".` };
  }
  const modelo = entrada.modelVersion === undefined ? null : entrada.modelVersion;
  if (modelo !== null && !versaoDeModeloValida(modelo)) return { ok: false, erro: 'aiDraft.modelVersion inválido.' };
  return { ok: true, valor: { aiDrafted: true, promptVersion: entrada.promptVersion, modelVersion: modelo } };
}

module.exports = {
  MODELO_PADRAO,
  TAREFAS,
  ERROS,
  TEMPO_LIMITE_MAXIMO_MS,
  versaoDeComandoValida,
  versaoDeModeloValida,
  defeitoDoPedido,
  montarRequisicao,
  chamarModelo,
  extrairJson,
  lerProcedencia,
};
