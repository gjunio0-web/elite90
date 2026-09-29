// ELITE90 PRO · testar-checkin
// -----------------------------------------------------------------------------
// Homologation test script of M2 Phase 4 (persistence plan v5.23): calls
// registrar-checkin DIRECTLY, as the athlete, and checks the effects in
// Firestore, Storage and the traceability log. Verification is by calling the
// function, not by any athlete screen (D-AD).
//
// THE TEST-ATHLETE CREDENTIAL — same mechanism as testar-serie-peso.mjs:
// Admin SDK `createCustomToken(uid)` exchanged for an ID token at the Identity
// Toolkit endpoint; the token carries the existing `athlete: true` claim set
// at promotion. The script creates nothing in Authentication.
//
// GUARDS
//   · refuses any project other than elt90-quality-env;
//   · refuses an athlete whose name does not match "(MOCK #NN)" — test athletes
//     are identified by name (D-AP), because the triage seeder never writes
//     `_test` on leads, so promoted mock athletes carry `_test: false`.
//
// TWO STAGES
//   1. `node scripts/testar-checkin.mjs --atleta=<uid>`
//      Records check-ins as the athlete: new week, resend, correction, photos,
//      and the refusals. Leaves the current week recorded and UNANSWERED.
//   2. The Coach answers that week in /admin/atletas → Check-in → "Resposta ao
//      Atleta" (and, to see the edit event, saves an edited text once).
//   3. `node scripts/testar-checkin.mjs --atleta=<uid> --apos-resposta`
//      Checks the stored response (D-AS, CE-11), the Coach's events with the
//      athlete uid in the target (D-AR, CE-10), and that the athlete can no
//      longer correct the week (F4-3 → 409).
//
// WHAT IT CANNOT CHECK BY DIRECT CALL (the week depends on the real clock and
// on `startDate`, which may not change after the first check-in — D-AT):
// arrival before the cycle start and after week 13 (409), and the one-week-late
// rule. Those are covered by tests/checkin.test.js, on the pure function the
// endpoint uses.
//
// NOT COVERED HERE, CHECK BY HAND (Coach session on /admin/atletas, console):
//   await fetch('/.netlify/functions/registrar-checkin', { method: 'POST',
//     headers: { Authorization: 'Bearer ' + await window.__getFreshToken(),
//                'Content-Type': 'application/json' },
//     body: JSON.stringify({ athleteUid: '<uid>', measurements: { waistCm: 80, hipCm: 95 } }) })
//     .then(r => r.status)                                  // expected: 403
//
// CLEANUP: `--limpar` deletes this athlete's check-ins with `_test: true`, the
// test photos under athletes/{uid}/checkins/ in Storage, and the
// `lastCheckinSubmittedAt` field — direct Admin SDK writes, no function.
//
// Usage (repository root, .env.local pointing to homologation):
//   node scripts/testar-checkin.mjs --atleta=<uid> [--base=<deploy URL>]
//   node scripts/testar-checkin.mjs --atleta=<uid> --apos-resposta
//   node scripts/testar-checkin.mjs --atleta=<uid> --limpar
// Default --base: https://quality-env--elite90.netlify.app
// -----------------------------------------------------------------------------

import admin from 'firebase-admin';
import { createRequire } from 'node:module';
import { conectar, abortar } from './_firestore-cli.mjs';

const require = createRequire(import.meta.url);
const regras = require('../netlify/functions/_checkin.js');
const { dataCivilDoInicio, dataCivilNoFuso, FUSO_REFERENCIA } = require('../netlify/functions/_serie-peso.js');

const PROJETO_HOMOLOGACAO = 'elt90-quality-env';
const BASE_PADRAO = 'https://quality-env--elite90.netlify.app';
const PADRAO_MOCK = /\(MOCK #\d+\)/;

// Smallest valid WebP (1×1). The content does not matter: the function only
// checks that the file exists under the athlete's prefix (F4-5).
const WEBP_1X1 = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');

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
const nomeBucket = process.env.PUBLIC_FIREBASE_STORAGE_BUCKET;
if (!nomeBucket) abortar('PUBLIC_FIREBASE_STORAGE_BUCKET ausente no .env.local.');
const bucket = admin.storage().bucket(nomeBucket);

const refAtleta = db.collection('athletes').doc(uid);
const refCheckins = refAtleta.collection('checkins');
const snapAtleta = await refAtleta.get();
if (!snapAtleta.exists) abortar(`athletes/${uid} não existe.`);
const nome = String(snapAtleta.get('name') ?? '');
if (!PADRAO_MOCK.test(nome)) {
  abortar(`athletes/${uid} ("${nome}") não é atleta de teste: o nome não tem o padrão "(MOCK #NN)" (D-AP).`);
}
const prefixo = regras.prefixoFotos(uid);

// ── --limpar ────────────────────────────────────────────────────────────────
if (args.limpar) {
  const snap = await refCheckins.get();
  const lote = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    if (d.get('_test') === true) { lote.delete(d.ref); n += 1; }
  }
  lote.update(refAtleta, { lastCheckinSubmittedAt: admin.firestore.FieldValue.delete() });
  await lote.commit();
  const [arquivos] = await bucket.getFiles({ prefix: prefixo });
  await Promise.all(arquivos.map((f) => f.delete()));
  console.log(`\n  ${n} check-in(s) de teste removido(s); ${arquivos.length} foto(s) removida(s);`
    + ' lastCheckinSubmittedAt apagado.\n');
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
let falhas = 0;
function conferir(nomeCaso, ok, detalhe = '') {
  if (!ok) falhas += 1;
  console.log(`  ${ok ? '✔' : '✘'} ${nomeCaso}${detalhe ? ` — ${detalhe}` : ''}`);
}
async function registrarCheckin(corpo, alvo = uid) {
  const r = await fetch(`${base}/.netlify/functions/registrar-checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ athleteUid: alvo, ...corpo }),
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function ultimaSemana() {
  const s = await refCheckins.orderBy(admin.firestore.FieldPath.documentId(), 'desc').limit(1).get();
  return s.empty ? 0 : regras.numeroDaSemana(s.docs[0].id) ?? 0;
}
// Events on one target, recorded from `desdeMs` on. The log is append-only and
// survives --limpar (DR-06), and a bare "wNN" target is shared by every athlete
// (only `ator.uid` tells them apart), so both filters matter.
async function eventos(alvoId, desdeMs) {
  const s = await db.collection('rastreabilidade')
    .where('alvo.colecao', '==', 'checkins').where('alvo.id', '==', alvoId)
    .orderBy('ocorridoEm', 'desc').get();
  return s.docs.map((d) => d.data()).filter((e) => (ms(e.ocorridoEm) ?? 0) >= desdeMs);
}
const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);
const chave = (n) => `teste-checkin-${Date.now()}-${n}`;
const medidasBase = { waistCm: 82.5, hipCm: 98, armCm: 38.5 };

const inicio = dataCivilDoInicio(snapAtleta.get('startDate'));
if (!inicio) abortar(`athletes/${uid} não tem startDate utilizável.`);
const hoje = dataCivilNoFuso(new Date(), FUSO_REFERENCIA);
const A = regras.semanaDoCiclo(inicio, hoje);

console.log(`\n  Atleta ${nome} (${uid}) · deploy ${base}`
  + `\n  Início do ciclo ${inicio} · hoje ${hoje} (Brasília) · semana do ciclo ${A}\n`);

// ── stage 3: after the Coach's response ─────────────────────────────────────
if (args['apos-resposta']) {
  const U = await ultimaSemana();
  if (!U) abortar('não há check-in registrado; rode a primeira etapa antes.');
  const week = regras.idDaSemana(U);
  const doc = (await refCheckins.doc(week).get()).data();
  const r = doc?.coachResponse;
  conferir(`R · ${week} tem resposta do Coach`, !!r && typeof r.text === 'string' && r.respondedAt != null);
  conferir('R · CE-11 · respondedBy é { uid, role }, sem e-mail nem nome (D-AS)',
    !!r && r.respondedBy && Object.keys(r.respondedBy).sort().join(',') === 'role,uid'
      && r.respondedBy.role === 'admin' && typeof r.respondedBy.uid === 'string',
    JSON.stringify(r?.respondedBy));

  // Only events after this week's submission: earlier runs may have left others.
  const desde = ms(doc?.submittedAt) ?? 0;
  const evCoach = await eventos(`${uid}/${week}`, desde);
  const respondido = evCoach.filter((e) => e.acao === 'checkin.respondido');
  conferir('R · um checkin.respondido com alvo "<uid>/wNN" (CE-10, D-AR)', respondido.length === 1,
    JSON.stringify(evCoach.map((e) => e.acao)));
  conferir('R · ator Coach com e-mail (DR-09) e sem detalhe',
    evCoach.length > 0 && evCoach.every((e) => e.ator?.papel === 'admin' && typeof e.ator?.email === 'string'
      && !('detalhe' in e)));
  const editadas = evCoach.filter((e) => e.acao === 'checkin.resposta-corrigida').length;
  console.log(`  · checkin.resposta-corrigida: ${editadas} (esperado ≥ 1 se a resposta foi editada no painel)`);
  conferir('R · nenhum evento do Coach sobre esta semana com alvo sem uid',
    (await eventos(week, desde)).every((e) => e.ator?.papel === 'athlete'));

  const rc = await registrarCheckin({ measurements: medidasBase, idempotencyKey: chave('pos') });
  if (U === A) {
    conferir('R · correção depois da resposta → 409 ja-respondido (F4-3)',
      rc.status === 409 && rc.json?.reason === 'ja-respondido', `${rc.status} ${JSON.stringify(rc.json)}`);
  } else {
    console.log(`  – a semana do ciclo mudou (${week} respondida, agora semana ${A}); o envio criou`
      + ` ${rc.json?.week ?? '?'} em vez de testar a recusa. Rode --limpar e repita as duas etapas na mesma semana.`);
  }
  console.log(`\n  ${falhas ? `${falhas} falha(s).` : 'Todos os casos passaram.'}\n`);
  process.exit(falhas ? 1 : 0);
}

// ── stage 1: athlete submissions ────────────────────────────────────────────
if (A < 1 || A > regras.CICLO_TOTAL_SEMANAS) {
  abortar(`a semana do ciclo de hoje é ${A}; o registro só é aceito da semana 1 à 13. Use outro atleta de teste.`);
}

const inicioExecucao = Date.now() - 5_000; // tolerance for clock skew

// A · the rules decide the week; the script predicts it with the same function.
let U = await ultimaSemana();
if (U === A) abortar(`a semana ${A} já tem check-in; rode --limpar e repita.`);
const docAtletaAntes = (await refAtleta.get()).data();
const k1 = chave(1);
let esperado = regras.decidirSemana(A, U);
const ra = await registrarCheckin({
  measurements: medidasBase,
  perception: 'Semana boa de treino; sono irregular na quarta.',
  declaredAt: new Date(Date.now() - 60_000).toISOString(),
  idempotencyKey: k1,
});
const wa = regras.idDaSemana(esperado.semana);
conferir(`A · semana nova → 200, ${wa}, registrou=true`,
  ra.status === 200 && ra.json?.week === wa && ra.json?.registrou === true, JSON.stringify(ra.json));
const docA = (await refCheckins.doc(wa).get()).data();
conferir('A · documento gravado (medidas, relato, submittedAt do servidor, declaredAt, coachResponse null, _test)',
  !!docA && docA.cycleWeek === esperado.semana && docA.measurements?.waistCm === 82.5
    && docA.measurements?.chestCm === null && docA.perception?.startsWith('Semana boa')
    && docA.submittedAt != null && docA.declaredAt != null && docA.coachResponse === null
    && Array.isArray(docA.photos) && docA._test === true,
  JSON.stringify(docA && { ...docA, submittedAt: String(docA.submittedAt?.toDate?.()), declaredAt: String(docA.declaredAt?.toDate?.()) }));
conferir('A · sem identificador de pessoa no documento (R1)',
  !!docA && !('uid' in docA) && !('email' in docA) && !('name' in docA) && !('athleteUid' in docA));
conferir('A · check-in não carrega peso (F4-4)', !!docA && !('weightKg' in docA) && !('weight' in docA));
let docAtleta = (await refAtleta.get()).data();
conferir('A · lastCheckinSubmittedAt = submittedAt, na mesma transação (F4-1; Adendo 06, critério 17)',
  ms(docAtleta.lastCheckinSubmittedAt) !== null && ms(docAtleta.lastCheckinSubmittedAt) === ms(docA?.submittedAt));
conferir('A · weightCurrentKg intocado', docAtleta.weightCurrentKg === docAtletaAntes.weightCurrentKg);

// B · resend with the same key.
const rb = await registrarCheckin({ measurements: { waistCm: 90, hipCm: 99 }, idempotencyKey: k1 });
conferir('B · reenvio com a mesma chave → duplicado=true, nada gravado',
  rb.status === 200 && rb.json?.duplicado === true
    && (await refCheckins.doc(wa).get()).get('measurements.waistCm') === 82.5, JSON.stringify(rb.json));

// If A went to U + 1 < A (the one-week-late rule), a second send creates week A.
U = await ultimaSemana();
if (U !== A) {
  esperado = regras.decidirSemana(A, U);
  const r2 = await registrarCheckin({ measurements: medidasBase, idempotencyKey: chave(2) });
  conferir(`A2 · envio seguinte cria ${regras.idDaSemana(A)} (regra do atraso de uma semana)`,
    r2.status === 200 && r2.json?.week === regras.idDaSemana(A) && r2.json?.registrou === true, JSON.stringify(r2.json));
}
const wA = regras.idDaSemana(A);

// C · correction of the current week, with photos.
const docAntesC = (await refCheckins.doc(wA).get()).data();
const atletaAntesC = (await refAtleta.get()).data();
const kc = chave(3);
const foto1 = `${prefixo}${kc}/foto-1.webp`;
const foto2 = `${prefixo}${kc}/foto-2.webp`;
await Promise.all([foto1, foto2].map((p) => bucket.file(p).save(WEBP_1X1, { metadata: { contentType: 'image/webp' } })));
const rc = await registrarCheckin({
  measurements: { waistCm: 82, hipCm: 97.5, chestCm: 104 },
  perception: 'Corrigindo a cintura.',
  photos: [foto1, foto2],
  idempotencyKey: kc,
});
conferir(`C · reenvio na semana corrente → corrigiu=true em ${wA}`,
  rc.status === 200 && rc.json?.week === wA && rc.json?.corrigiu === true, JSON.stringify(rc.json));
const docC = (await refCheckins.doc(wA).get()).data();
conferir('C · valores corrigidos e fotos gravadas como caminhos',
  docC?.measurements?.waistCm === 82 && docC?.measurements?.chestCm === 104
    && JSON.stringify(docC?.photos) === JSON.stringify([foto1, foto2]));
conferir('C · submittedAt preservado na correção',
  ms(docC?.submittedAt) === ms(docAntesC?.submittedAt));
conferir('C · lastCheckinSubmittedAt não avança na correção (Adendo 06, critério 17)',
  ms((await refAtleta.get()).get('lastCheckinSubmittedAt')) === ms(atletaAntesC.lastCheckinSubmittedAt));

// Traceability of the athlete's events.
const evA = (await eventos(wA, inicioExecucao)).filter((e) => e.ator?.uid === uid);
const acoesA = evA.map((e) => e.acao).sort();
conferir(`A–C · eventos em ${wA}: um checkin.registrado e um checkin.corrigido (o reenvio não gera evento)`,
  acoesA.length === 2 && acoesA[0] === 'checkin.corrigido' && acoesA[1] === 'checkin.registrado',
  JSON.stringify(acoesA));
conferir('A–C · CE-09 · ator atleta com email null, sem detalhe, alvo só "wNN"',
  evA.every((e) => e.ator?.papel === 'athlete' && e.ator?.uid === uid && e.ator?.email === null
    && !('detalhe' in e) && e.alvo?.id === wA));

// D–L · refusals.
const casos = [
  ['D · peso no corpo → 400 (F4-4)', { measurements: medidasBase, weightKg: 80 }, 400],
  ['E · cintura 39 cm → 400 (F4-6)', { measurements: { waistCm: 39, hipCm: 98 } }, 400],
  ['F · quadril ausente → 400 (F4-6)', { measurements: { waistCm: 82 } }, 400],
  ['G · duas casas decimais → 400 (F4-6)', { measurements: { waistCm: 82.25, hipCm: 98 } }, 400],
  ['H · campo de medida desconhecido → 400', { measurements: { ...medidasBase, thighCm: 60 } }, 400],
  ['I · relato com 4.001 caracteres → 400 (F4-6)', { measurements: medidasBase, perception: 'x'.repeat(4001) }, 400],
  ['J · foto fora da pasta do atleta → 400 (F4-5)',
    { measurements: medidasBase, photos: [`leads/qualquer/foto-1.webp`] }, 400],
  ['K · foto inexistente na pasta do atleta → 400 (F4-5)',
    { measurements: medidasBase, photos: [`${prefixo}nao-existe/foto-1.webp`] }, 400],
];
for (const [nomeCaso, corpo, esperadoStatus] of casos) {
  const r = await registrarCheckin({ ...corpo, idempotencyKey: chave('x') });
  conferir(nomeCaso, r.status === esperadoStatus, `${r.status} ${JSON.stringify(r.json)}`);
}
const rl = await registrarCheckin({ measurements: medidasBase }, `${uid}-outro`);
conferir('L · atleta gravando para outro → 403', rl.status === 403, String(rl.status));
conferir('D–L · nenhuma recusa alterou o documento da semana',
  (await refCheckins.doc(wA).get()).get('measurements.waistCm') === 82);

console.log(`\n  ${falhas ? `${falhas} falha(s).` : 'Todos os casos passaram.'}`
  + `\n  Próximo passo: responda ${wA} no painel (aba Check-in), edite a resposta uma vez,`
  + '\n  e rode de novo com --apos-resposta. Falta à mão: Coach chamando registrar-checkin (403).\n');
process.exit(falhas ? 1 : 0);
