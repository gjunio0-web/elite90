// ELITE90 PRO · testar-serie-peso
// -----------------------------------------------------------------------------
// Homologation test script of M2 Phase 3 (persistence plan): calls
// registrar-peso DIRECTLY, as the athlete, and checks the effects in
// Firestore. Verification is by calling the function, not by any athlete
// screen (D-AD).
//
// THE TEST-ATHLETE CREDENTIAL (plan, common rule 3)
// The Athlete Portal does not exist, so no athlete signs in. This script
// issues a short-lived credential for ONE test athlete:
//   1. Admin SDK `createCustomToken(uid)` — signed with the homologation
//      service account from .env.local;
//   2. exchanged for an ID token at the public Identity Toolkit endpoint
//      (`signInWithCustomToken`, with PUBLIC_FIREBASE_API_KEY);
//   3. the ID token carries the account's existing custom claims, including
//      `athlete: true`, which promote-lead.ts set at promotion.
// The script CREATES NOTHING in Authentication: it refuses an athlete without
// an existing account or without the `athlete` claim. If that happens, promote
// a test lead through the panel — that creates the account and the claim.
//
// GUARDS
//   · refuses any project other than elt90-quality-env;
//   · refuses an athlete document without `_test: true`.
//
// WHAT IT LEAVES BEHIND
// The weight points it records stay in `athletes/{uid}/weights/` (with
// `_test: true`) and move `weightCurrentKg` — on purpose, so the chart can be
// checked in the panel afterwards. `--limpar` removes that athlete's test
// points and resets `weightCurrentKg` to `weightInitialKg`, WITHOUT calling any
// function (homologation cleanup, direct Admin SDK write).
//
// NOT COVERED HERE, CHECK BY HAND (Coach session on /admin/atletas, console):
//   await fetch('/.netlify/functions/registrar-peso', { method: 'POST',
//     headers: { Authorization: 'Bearer ' + await window.__getFreshToken(),
//                'Content-Type': 'application/json' },
//     body: JSON.stringify({ athleteUid: '<uid>', measuredOn: '<hoje>', weightKg: 80 }) })
//     .then(r => r.status)                                  // expected: 403
// and the weight chart of the same athlete in the drawer (ler-serie-peso).
//
// Usage (repository root, .env.local pointing to homologation):
//   node scripts/testar-serie-peso.mjs --atleta=<uid> [--base=<deploy URL>]
//   node scripts/testar-serie-peso.mjs --atleta=<uid> --limpar
// Default --base: https://quality-env--elite90.netlify.app
// -----------------------------------------------------------------------------

import admin from 'firebase-admin';
import { conectar, abortar } from './_firestore-cli.mjs';

const PROJETO_HOMOLOGACAO = 'elt90-quality-env';
const BASE_PADRAO = 'https://quality-env--elite90.netlify.app';
const FUSO = 'America/Sao_Paulo';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);

const uid = typeof args.atleta === 'string' ? args.atleta.trim() : '';
if (!uid) abortar('informe o atleta de teste: --atleta=<uid>');
const base = (typeof args.base === 'string' ? args.base : BASE_PADRAO).replace(/\/$/, '');

// ── connection and guards ───────────────────────────────────────────────────
const db = conectar();
if (process.env.PUBLIC_FIREBASE_PROJECT_ID !== PROJETO_HOMOLOGACAO) {
  abortar(`este roteiro só roda em ${PROJETO_HOMOLOGACAO}; o ambiente declara "${process.env.PUBLIC_FIREBASE_PROJECT_ID}".`);
}

const refAtleta = db.collection('athletes').doc(uid);
const refPesos = refAtleta.collection('weights');
const snapAtleta = await refAtleta.get();
if (!snapAtleta.exists) abortar(`athletes/${uid} não existe.`);
if (snapAtleta.get('_test') !== true) abortar(`athletes/${uid} não é atleta de teste (_test ausente ou falso).`);

// ── --limpar ────────────────────────────────────────────────────────────────
if (args.limpar) {
  const snap = await refPesos.get();
  const lote = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    if (d.get('_test') === true) { lote.delete(d.ref); n += 1; }
  }
  const inicial = snapAtleta.get('weightInitialKg');
  if (typeof inicial === 'number') lote.update(refAtleta, { weightCurrentKg: inicial });
  await lote.commit();
  console.log(`\n  ${n} ponto(s) de teste removido(s); weightCurrentKg = ${inicial}.\n`);
  process.exit(0);
}

// ── credential ──────────────────────────────────────────────────────────────
let usuario;
try {
  usuario = await admin.auth().getUser(uid);
} catch {
  abortar(`o atleta ${uid} não tem conta no Firebase Authentication.\n`
    + '  Este roteiro não cria contas. Promova uma ficha de teste pelo painel e use o atleta resultante.');
}
if (usuario.customClaims?.athlete !== true) {
  abortar(`a conta ${uid} não tem a marca de atleta (claim athlete). Use um atleta promovido pelo painel.`);
}
const apiKey = process.env.PUBLIC_FIREBASE_API_KEY;
if (!apiKey) abortar('PUBLIC_FIREBASE_API_KEY ausente no .env.local.');

const customToken = await admin.auth().createCustomToken(uid);
const troca = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }) },
);
if (!troca.ok) abortar(`falha ao trocar o token personalizado (${troca.status}): ${await troca.text()}`);
const { idToken } = await troca.json();

// ── helpers ─────────────────────────────────────────────────────────────────
function hoje() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
}
function somar(dataCivil, n) {
  const [a, m, d] = dataCivil.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
function inicioCiclo() {
  const s = snapAtleta.get('startDate');
  if (!s || typeof s.toDate !== 'function') return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(s.toDate());
}
async function registrarPeso(corpo) {
  const r = await fetch(`${base}/.netlify/functions/registrar-peso`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ athleteUid: uid, ...corpo }),
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function existentes() {
  return new Set((await refPesos.get()).docs.map((d) => d.id));
}
async function pesoAtual() {
  return (await refAtleta.get()).get('weightCurrentKg');
}
async function eventos(dia) {
  const s = await db.collection('rastreabilidade')
    .where('alvo.colecao', '==', 'weights').where('alvo.id', '==', dia)
    .orderBy('ocorridoEm', 'desc').get();
  return s.docs.map((d) => d.data()).filter((e) => e.ator?.uid === uid);
}

let falhas = 0;
function conferir(nome, ok, detalhe = '') {
  if (!ok) falhas += 1;
  console.log(`  ${ok ? '✔' : '✘'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}

// ── scenario ────────────────────────────────────────────────────────────────
const H = hoje();
const inicio = inicioCiclo();
const piso = inicio && inicio > somar(H, -30) ? inicio : somar(H, -30);
const atualNoInicio = snapAtleta.get('weightCurrentKg');
const base0 = typeof atualNoInicio === 'number' ? atualNoInicio : 80;
const valor = (d) => Math.round((base0 + d) * 10) / 10;

console.log(`\n  Atleta ${uid} · deploy ${base} · hoje ${H} · início do ciclo ${inicio ?? '(ausente)'}\n`);

// A · new day: the latest free day in [piso, today].
let ja = await existentes();
let X = null;
for (let d = H; d >= piso; d = somar(d, -1)) { if (!ja.has(d)) { X = d; break; } }
if (!X) {
  conferir('A · dia novo', false, `não há dia livre entre ${piso} e ${H}; rode com --limpar e repita`);
} else {
  const maisRecente = [...ja].sort().pop() ?? null;
  const chave1 = `teste-${Date.now()}-1`;
  const r = await registrarPeso({ measuredOn: X, weightKg: valor(0), idempotencyKey: chave1 });
  const doc = (await refPesos.doc(X).get()).data();
  conferir('A · dia novo → 200, substituiu=false', r.status === 200 && r.json?.substituiu === false, JSON.stringify(r.json));
  conferir('A · documento gravado', doc?.weightKg === valor(0) && doc?.source === 'manual'
    && doc?.ocrRawValue === null && doc?._test === true && doc?.recordedAt != null,
    JSON.stringify(doc && { ...doc, recordedAt: String(doc.recordedAt?.toDate?.()) }));
  conferir('A · sem identificador de pessoa no documento (R1)',
    doc && !('uid' in doc) && !('email' in doc) && !('recordedBy' in doc));
  const deveAtualizar = maisRecente === null || X >= maisRecente;
  conferir(`A · weightCurrentKg ${deveAtualizar ? 'atualizado' : 'mantido'}`,
    (await pesoAtual()) === (deveAtualizar ? valor(0) : atualNoInicio));

  // B · resend with the same key.
  const rb = await registrarPeso({ measuredOn: X, weightKg: valor(0), idempotencyKey: chave1 });
  conferir('B · reenvio com a mesma chave → duplicado=true', rb.status === 200 && rb.json?.duplicado === true, JSON.stringify(rb.json));

  // C · correction of the same day.
  const rc = await registrarPeso({ measuredOn: X, weightKg: valor(-0.2), idempotencyKey: `teste-${Date.now()}-2` });
  conferir('C · correção do mesmo dia → substituiu=true', rc.status === 200 && rc.json?.substituiu === true, JSON.stringify(rc.json));
  conferir('C · valor corrigido no documento', (await refPesos.doc(X).get()).get('weightKg') === valor(-0.2));

  // Traceability of A–C (best-effort: a missing event is reported, and the
  // function log says "EVENTO PERDIDO" if it was lost).
  const ev = await eventos(X);
  const acoes = ev.map((e) => e.acao).sort();
  conferir('A–C · eventos: um peso.registrado e um peso.corrigido (o reenvio não gera evento)',
    acoes.length === 2 && acoes[0] === 'peso.corrigido' && acoes[1] === 'peso.registrado', JSON.stringify(acoes));
  conferir('A–C · CE-09 · ator atleta com email null, e sem detalhe (Adendo 04 §6.4, DR-04)',
    ev.every((e) => e.ator?.papel === 'athlete' && e.ator?.email === null && !('detalhe' in e)));

  // D · late entry: an older free day must not move weightCurrentKg.
  ja = await existentes();
  const maisNovo = [...ja].sort().pop();
  let Y = null;
  for (let d = somar(maisNovo, -1); d >= piso; d = somar(d, -1)) { if (!ja.has(d)) { Y = d; break; } }
  if (!Y) {
    console.log('  – D · lançamento atrasado: sem dia livre anterior ao mais recente; caso não executado');
  } else {
    const antes = await pesoAtual();
    const rd = await registrarPeso({ measuredOn: Y, weightKg: valor(5) });
    conferir(`D · dia atrasado (${Y}) → atualizouAtual=false`, rd.status === 200 && rd.json?.atualizouAtual === false, JSON.stringify(rd.json));
    conferir('D · weightCurrentKg inalterado', (await pesoAtual()) === antes);
  }
}

// E–I · refusals.
const casos = [
  ['E · data futura → 400', { measuredOn: somar(H, 3), weightKg: 80 }, 400],
  ['F · 301 kg → 400', { measuredOn: H, weightKg: 301 }, 400],
  ['G · três casas decimais → 400', { measuredOn: H, weightKg: 80.123 }, 400],
  ['H · source ocr → 400', { measuredOn: H, weightKg: 80, source: 'ocr' }, 400],
];
if (inicio) casos.push(['I · antes do início do ciclo → 409', { measuredOn: somar(inicio, -1), weightKg: 80 }, 409]);
for (const [nome, corpo, esperado] of casos) {
  const r = await registrarPeso(corpo);
  conferir(nome, r.status === esperado, `${r.status} ${JSON.stringify(r.json)}`);
}

// J · the athlete writing for someone else.
const rj = await fetch(`${base}/.netlify/functions/registrar-peso`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
  body: JSON.stringify({ athleteUid: `${uid}-outro`, measuredOn: H, weightKg: 80 }),
});
conferir('J · atleta gravando para outro → 403', rj.status === 403, String(rj.status));

console.log(`\n  ${falhas ? `${falhas} falha(s).` : 'Todos os casos passaram.'}`
  + '\n  Falta à mão: Coach chamando registrar-peso (403) e o gráfico na gaveta do atleta.\n');
process.exit(falhas ? 1 : 0);
