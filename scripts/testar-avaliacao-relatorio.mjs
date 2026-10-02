// ELITE90 PRO · testar-avaliacao-relatorio
// -----------------------------------------------------------------------------
// Homologation test script of M2 Phase 6 (persistence plan v5.26): calls
// registrar-avaliacao-fisica DIRECTLY, as the athlete, and checks the effects in
// Firestore and in the traceability log; then checks the weekly report the
// Coach wrote, published and corrected in the panel. Verification is by calling
// the functions, not by any athlete screen (D-AD).
//
// THE TEST-ATHLETE CREDENTIAL — same mechanism as testar-checkin.mjs: Admin SDK
// `createCustomToken(uid)` exchanged for an ID token at the Identity Toolkit
// endpoint; the token carries the existing `athlete: true` claim set at
// promotion. The script creates nothing in Authentication.
//
// GUARDS (common rule 11)
//   · refuses any project other than elt90-quality-env;
//   · refuses an athlete whose name does not match "(MOCK #NN)" (D-AP);
//   · refuses an athlete whose `createdAt` is not a Timestamp — promoted before
//     Phase 2 (risk registered in plan v5.24: homologation of a new phase uses
//     an athlete promoted after the change being tested);
//   · refuses an athlete without a usable `startDate`, or outside weeks 1–13.
//
// THREE STAGES
//   1. `node scripts/testar-avaliacao-relatorio.mjs --atleta=<uid>`
//      Physical evaluation as the athlete: new slot, resend, correction inside
//      the window, and the refusals (400, 403). Leaves the slot recorded.
//   2. The Coach, in /admin/atletas → Evolução, writes the report of the
//      current week (the draft saves by itself), publishes it, then corrects it
//      once ("Corrigir relatório publicado" → "Salvar correção").
//   3. `node scripts/testar-avaliacao-relatorio.mjs --atleta=<uid> --relatorio [--semana=wNN]`
//      Checks the report document (RP-1 fields present and empty, provenance,
//      `publishedBy` without e-mail — CE-12), the Coach's events with the
//      athlete uid in the target (D-AR, CE-10), and that the athlete is refused
//      (403) by the four Coach functions. Default week: the current one.
//
// WHAT IT CANNOT CHECK BY DIRECT CALL (the slot depends on the real clock and on
// `startDate`, which may not change after the first evaluation — D-AT, O12):
// arrival in an even week, lateness beyond the window, before the start and
// after week 13. Those are covered by tests/avaliacao-fisica.test.js, on the
// pure function the endpoint uses (FE-1 pattern).
//
// NOT COVERED HERE, CHECK BY HAND (Coach session on /admin/atletas, console):
//   await fetch('/.netlify/functions/registrar-avaliacao-fisica', { method: 'POST',
//     headers: { Authorization: 'Bearer ' + await window.__getFreshToken(),
//                'Content-Type': 'application/json' },
//     body: JSON.stringify({ athleteUid: '<uid>' }) }).then(r => r.status)   // expected: 403
//
// CLEANUP: `--limpar` deletes this athlete's evaluations and reports with
// `_test: true` — direct Admin SDK writes, no function. The traceability log is
// append-only and is not touched (DR-06).
//
// Usage (repository root, .env.local pointing to homologation):
//   node scripts/testar-avaliacao-relatorio.mjs --atleta=<uid> [--base=<deploy URL>]
//   node scripts/testar-avaliacao-relatorio.mjs --atleta=<uid> --relatorio [--semana=wNN]
//   node scripts/testar-avaliacao-relatorio.mjs --atleta=<uid> --limpar
// Default --base: https://quality-env--elite90.netlify.app
// -----------------------------------------------------------------------------

import admin from 'firebase-admin';
import { createRequire } from 'node:module';
import { conectar, abortar } from './_firestore-cli.mjs';

const require = createRequire(import.meta.url);
const checkin = require('../netlify/functions/_checkin.js');
const avaliacao = require('../netlify/functions/_avaliacao-fisica.js');
const { dataCivilDoInicio, dataCivilNoFuso, FUSO_REFERENCIA } = require('../netlify/functions/_serie-peso.js');

const PROJETO_HOMOLOGACAO = 'elt90-quality-env';
const BASE_PADRAO = 'https://quality-env--elite90.netlify.app';
const PADRAO_MOCK = /\(MOCK #\d+\)/;

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
const refAvaliacoes = refAtleta.collection('evaluations');
const refRelatorios = refAtleta.collection('weeklyReports');
const snapAtleta = await refAtleta.get();
if (!snapAtleta.exists) abortar(`athletes/${uid} não existe.`);
const nome = String(snapAtleta.get('name') ?? '');
if (!PADRAO_MOCK.test(nome)) {
  abortar(`athletes/${uid} ("${nome}") não é atleta de teste: o nome não tem o padrão "(MOCK #NN)" (D-AP).`);
}
if (!(snapAtleta.get('createdAt') instanceof admin.firestore.Timestamp)) {
  abortar(`athletes/${uid} foi promovido antes da Fase 2 (createdAt não é Timestamp). `
    + 'Use um atleta promovido depois da Fase 2 (regra comum 11 do plano).');
}

// ── --limpar ────────────────────────────────────────────────────────────────
if (args.limpar) {
  const lote = db.batch();
  let nAv = 0;
  let nRel = 0;
  for (const d of (await refAvaliacoes.get()).docs) {
    if (d.get('_test') === true) { lote.delete(d.ref); nAv += 1; }
  }
  for (const d of (await refRelatorios.get()).docs) {
    if (d.get('_test') === true) { lote.delete(d.ref); nRel += 1; }
  }
  await lote.commit();
  console.log(`\n  ${nAv} avaliação(ões) física(s) e ${nRel} relatório(s) de teste removido(s).\n`);
  process.exit(0);
}

const inicio = dataCivilDoInicio(snapAtleta.get('startDate'));
if (!inicio) abortar(`athletes/${uid} não tem startDate utilizável.`);
const hoje = dataCivilNoFuso(new Date(), FUSO_REFERENCIA);
const A = checkin.semanaDoCiclo(inicio, hoje);

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
async function chamar(funcao, corpo) {
  const r = await fetch(`${base}/.netlify/functions/${funcao}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(corpo),
  });
  let json = null;
  try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);
const chave = (n) => `teste-avaliacao-${Date.now()}-${n}`;
// Events on one target, recorded from `desdeMs` on (the log survives --limpar).
async function eventos(colecao, alvoId, desdeMs) {
  const s = await db.collection('rastreabilidade')
    .where('alvo.colecao', '==', colecao).where('alvo.id', '==', alvoId)
    .orderBy('ocorridoEm', 'desc').get();
  return s.docs.map((d) => d.data()).filter((e) => (ms(e.ocorridoEm) ?? 0) >= desdeMs);
}
async function ultimaAvaliacao() {
  const s = await refAvaliacoes.orderBy(admin.firestore.FieldPath.documentId(), 'desc').limit(1).get();
  return s.empty ? 0 : checkin.numeroDaSemana(s.docs[0].id) ?? 0;
}
const IDENTIFICADORES = ['uid', 'email', 'name', 'athleteUid'];

console.log(`\n  Atleta ${nome} (${uid}) · deploy ${base}`
  + `\n  Início do ciclo ${inicio} · hoje ${hoje} (Brasília) · semana do ciclo ${A}\n`);

// ── stage 3: the report written by the Coach ───────────────────────────────
if (args.relatorio) {
  const semanaPedida = typeof args.semana === 'string' ? args.semana : checkin.idDaSemana(Math.min(Math.max(A, 1), 13));
  if (checkin.numeroDaSemana(semanaPedida) === null) abortar(`--semana inválida: ${semanaPedida} (esperado w01 a w13).`);
  const snap = await refRelatorios.doc(semanaPedida).get();
  if (!snap.exists) abortar(`weeklyReports/${semanaPedida} não existe; escreva e publique o relatório no painel antes.`);
  const r = snap.data();
  conferir(`R · ${semanaPedida} publicado pelo Coach`, r.status === 'published' && r.publishedAt != null, String(r.status));
  conferir('R · RP-1 · camada estruturada presente e vazia (O6)',
    Array.isArray(r.hypotheses) && r.hypotheses.length === 0 && Array.isArray(r.adjustments) && r.adjustments.length === 0
      && 'expectation' in r && r.expectation === null && Array.isArray(r.alerts) && r.alerts.length === 0);
  conferir('R · RP-1 · procedência: generatedBy "coach", aiOriginalDraft null, versões nulas, coachInputRefs vazio',
    r.generatedBy === 'coach' && 'aiOriginalDraft' in r && r.aiOriginalDraft === null && r.promptVersion === null
      && r.modelVersion === null && Array.isArray(r.coachInputRefs) && r.coachInputRefs.length === 0);
  conferir('R · O10 · insumos nulos e sem coachAudioPaths',
    r.coachInputText === null && r.coachAudioTranscript === null && !('coachAudioPaths' in r));
  conferir('R · O5 · causalLinks é texto único (ou nulo), nunca vetor',
    r.causalLinks === null || typeof r.causalLinks === 'string');
  conferir('R · CE-12 · publishedBy é { uid, role }, sem e-mail nem nome (O8)',
    !!r.publishedBy && Object.keys(r.publishedBy).sort().join(',') === 'role,uid' && r.publishedBy.role === 'admin',
    JSON.stringify(r.publishedBy));
  conferir('R · sem identificador do atleta no documento (R1)', IDENTIFICADORES.every((k) => !(k in r)));
  conferir('R · _test true', r._test === true);

  const desde = 0; // reports of this athlete/week: any earlier run was cleaned with --limpar
  const evCoach = await eventos('weeklyReports', `${uid}/${semanaPedida}`, desde);
  const publicados = evCoach.filter((e) => e.acao === 'relatorio.publicado').length;
  const corrigidos = evCoach.filter((e) => e.acao === 'relatorio.corrigido').length;
  conferir('R · relatorio.publicado com alvo "<uid>/wNN" (CE-10, D-AR)', publicados >= 1, `publicado ${publicados}`);
  conferir('R · relatorio.corrigido depois da correção no painel (O7)', corrigidos >= 1, `corrigido ${corrigidos}`);
  conferir('R · ator Coach com e-mail (DR-09) e sem detalhe',
    evCoach.length > 0 && evCoach.every((e) => e.ator?.papel === 'admin' && typeof e.ator?.email === 'string' && !('detalhe' in e)));
  conferir('R · nenhum evento de relatório com alvo sem o uid (CE-10)',
    (await eventos('weeklyReports', semanaPedida, desde)).length === 0);

  for (const funcao of ['salvar-relatorio-rascunho', 'publicar-relatorio', 'ler-relatorios', 'ler-avaliacoes-fisicas']) {
    const rr = await chamar(funcao, { athleteUid: uid, week: semanaPedida, diagnosis: 'teste' });
    conferir(`R · atleta chamando ${funcao} → 403`, rr.status === 403, String(rr.status));
  }
  console.log(`\n  ${falhas ? `${falhas} falha(s).` : 'Todos os casos passaram.'}\n`);
  process.exit(falhas ? 1 : 0);
}

// ── stage 1: physical evaluation as the athlete ─────────────────────────────
if (A < 1 || A > checkin.CICLO_TOTAL_SEMANAS) {
  abortar(`a semana do ciclo de hoje é ${A}; a avaliação só é aceita da semana 1 à 13. Use outro atleta de teste.`);
}
const U0 = await ultimaAvaliacao();
const decisao = avaliacao.decidirVagaAvaliacao(A, U0);
if (!decisao.ok) abortar(`a regra da vaga recusaria o envio de hoje (${decisao.motivo}).`);
if (decisao.correcao) abortar(`a vaga ${checkin.idDaSemana(decisao.semana)} já tem avaliação; rode --limpar e repita.`);
const wS = checkin.idDaSemana(decisao.semana);
const haAnterior = U0 > 0;

const inicioExecucao = Date.now() - 5_000; // tolerance for clock skew
const medidoEm = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // one hour ago
const perimetros = {
  shouldersCm: 118.5, chestCm: 104, waistAbdomenCm: 86.2, hipCm: 99,
  armLeftRelaxedCm: 36, armLeftFlexedCm: 39.5, armRightRelaxedCm: 36.4, armRightFlexedCm: 40,
  thighLeftProximalCm: 60, thighLeftMedialCm: 55, thighRightProximalCm: 60.5, thighRightMedialCm: 55.2,
  calfLeftCm: 38, calfRightCm: 38.3,
};
const dobras = {
  tricepsLeftMm: 12, tricepsRightMm: 12.5, subscapularMm: 15, suprailiacMm: 18, abdominalMm: 22,
  pectoralMm: 9, bicepsLeftMm: 5, bicepsRightMm: 5.5, thighLeftMm: 16, thighRightMm: 16.5,
  calfLeftMm: 8, calfRightMm: 8.5,
};
const medidoPor = { type: 'professional', sameAsPrevious: haAnterior ? true : null };
const corpoValido = (extra = {}) => ({
  athleteUid: uid, perimeters: perimetros, skinfolds: dobras, measuredAt: medidoEm, measuredBy: medidoPor, ...extra,
});

// A · new slot.
const k1 = chave(1);
const ra = await chamar('registrar-avaliacao-fisica', corpoValido({ idempotencyKey: k1 }));
conferir(`A · vaga nova → 200, ${wS}, registrou=true (O1)`,
  ra.status === 200 && ra.json?.week === wS && ra.json?.registrou === true, `${ra.status} ${JSON.stringify(ra.json)}`);
const docA = (await refAvaliacoes.doc(wS).get()).data();
conferir('A · documento gravado (14 perímetros, 12 dobras, measuredAt, measuredBy, submittedAt do servidor, _test)',
  !!docA && docA.cycleWeek === decisao.semana && Object.keys(docA.perimeters ?? {}).length === 14
    && Object.keys(docA.skinfolds ?? {}).length === 12 && docA.measuredAt instanceof admin.firestore.Timestamp
    && docA.submittedAt instanceof admin.firestore.Timestamp && docA._test === true,
  JSON.stringify(docA && { ...docA, measuredAt: String(docA.measuredAt?.toDate?.()), submittedAt: String(docA.submittedAt?.toDate?.()) }));
conferir('A · CE-12 · measuredBy é { type, sameAsPrevious }, sem identificar o avaliador (O4)',
  !!docA && Object.keys(docA.measuredBy ?? {}).sort().join(',') === 'sameAsPrevious,type', JSON.stringify(docA?.measuredBy));
conferir('A · sem identificador de pessoa, sem peso, sem percentual de gordura (R1; esquema §7 e §10)',
  !!docA && IDENTIFICADORES.every((k) => !(k in docA)) && !('weightKg' in docA) && !('bodyFatPercent' in docA));

// B · resend with the same key.
const rb = await chamar('registrar-avaliacao-fisica', corpoValido({ idempotencyKey: k1, perimeters: { ...perimetros, hipCm: 120 } }));
conferir('B · reenvio com a mesma chave → duplicado=true, nada gravado',
  rb.status === 200 && rb.json?.duplicado === true && (await refAvaliacoes.doc(wS).get()).get('perimeters.hipCm') === 99,
  JSON.stringify(rb.json));

// C · correction inside the window, without skinfolds this time.
const docAntesC = (await refAvaliacoes.doc(wS).get()).data();
const rc = await chamar('registrar-avaliacao-fisica', corpoValido({
  idempotencyKey: chave(3), perimeters: { ...perimetros, hipCm: 98.5 }, skinfolds: null,
}));
conferir(`C · reenvio na janela → corrigiu=true em ${wS} (O3)`,
  rc.status === 200 && rc.json?.week === wS && rc.json?.corrigiu === true, `${rc.status} ${JSON.stringify(rc.json)}`);
const docC = (await refAvaliacoes.doc(wS).get()).data();
conferir('C · valores corrigidos; dobras nulas aceitas (bloco completo ou nulo)',
  docC?.perimeters?.hipCm === 98.5 && docC?.skinfolds === null);
conferir('C · submittedAt preservado na correção', ms(docC?.submittedAt) === ms(docAntesC?.submittedAt));

// Traceability of the athlete's events.
const evA = (await eventos('evaluations', wS, inicioExecucao)).filter((e) => e.ator?.uid === uid);
const acoesA = evA.map((e) => e.acao).sort();
conferir(`A–C · eventos em ${wS}: um avaliacao-fisica.registrada e um avaliacao-fisica.corrigida (o reenvio não gera evento)`,
  acoesA.length === 2 && acoesA[0] === 'avaliacao-fisica.corrigida' && acoesA[1] === 'avaliacao-fisica.registrada',
  JSON.stringify(acoesA));
conferir('A–C · CE-09 · ator atleta com email null, sem detalhe, alvo só "wNN"',
  evA.every((e) => e.ator?.papel === 'athlete' && e.ator?.email === null && !('detalhe' in e) && e.alvo?.id === wS));

// D–O · refusals. Every call below lands on the slot wS, which A created, so the
// function treats it as a correction of wS and asks whether an evaluation exists
// BEFORE wS — the same `haAnterior` computed above, not "after A". The valid
// measuredBy follows it, so each refusal fails only for the reason its case
// tests; case H sends the opposite sameAsPrevious and must be refused by O4.
const mb = medidoPor;
const mbInvertido = { type: 'professional', sameAsPrevious: haAnterior ? null : true };
const rotuloH = haAnterior
  ? 'H · sameAsPrevious nulo havendo avaliação anterior → 400 (O4)'
  : 'H · sameAsPrevious preenchido sem avaliação anterior → 400 (O4)';
const parcial = { ...dobras }; delete parcial.pectoralMm;
const semPanturrilha = { ...perimetros }; delete semPanturrilha.calfRightCm;
const futura = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const anteriorAoInicio = `${inicio}T00:00:00-03:00`.replace(/^(\d{4})-(\d{2})-(\d{2})/, (_, a, m, d) => {
  const t = new Date(Date.UTC(+a, +m - 1, +d) - 24 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
});
const casos = [
  ['D · peso no corpo → 400', corpoValido({ measuredBy: mb, weightKg: 80 })],
  ['E · dobras parciais → 400', corpoValido({ measuredBy: mb, skinfolds: parcial })],
  ['F · measuredBy com nome do avaliador → 400 (CE-12)', corpoValido({ measuredBy: { ...mb, name: 'Fulano' } })],
  ['G · measuredBy com registro profissional → 400 (CE-12)', corpoValido({ measuredBy: { ...mb, councilNumber: '123' } })],
  [rotuloH, corpoValido({ measuredBy: mbInvertido })],
  ['I · perímetro com duas casas decimais → 400', corpoValido({ measuredBy: mb, perimeters: { ...perimetros, chestCm: 104.25 } })],
  ['J · perímetro desconhecido → 400', corpoValido({ measuredBy: mb, perimeters: { ...perimetros, neckCm: 40 } })],
  ['K · perímetro ausente → 400', corpoValido({ measuredBy: mb, perimeters: semPanturrilha })],
  ['L · measuredAt futura → 400 (O2, D-AJ)', corpoValido({ measuredBy: mb, measuredAt: futura })],
  ['M · measuredAt anterior ao início do ciclo → 400 (O2, D-AJ)', corpoValido({ measuredBy: mb, measuredAt: anteriorAoInicio })],
  ['N · measuredAt só com a data → 400', corpoValido({ measuredBy: mb, measuredAt: hoje })],
];
for (const [nomeCaso, corpo] of casos) {
  const r = await chamar('registrar-avaliacao-fisica', { ...corpo, idempotencyKey: chave('x') });
  conferir(nomeCaso, r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);
}
const ro = await chamar('registrar-avaliacao-fisica', corpoValido({ athleteUid: `${uid}-outro` }));
conferir('O · atleta gravando para outro → 403', ro.status === 403, String(ro.status));
conferir('D–O · nenhuma recusa alterou o documento da vaga',
  (await refAvaliacoes.doc(wS).get()).get('perimeters.hipCm') === 98.5);

console.log(`\n  ${falhas ? `${falhas} falha(s).` : 'Todos os casos passaram.'}`
  + `\n  Próximo passo: no painel, aba Avaliação, confira os valores de ${wS}; na aba Evolução,`
  + '\n  escreva o relatório da semana atual, publique e corrija uma vez; depois rode com --relatorio.'
  + '\n  Falta à mão: Coach chamando registrar-avaliacao-fisica (403).\n');
process.exit(falhas ? 1 : 0);
