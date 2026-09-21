// ELITE90 PRO · diagnosticar-historico-fase
// -----------------------------------------------------------------------------
// SOMENTE LEITURA. Não grava nada — só relata.
//
// Confirma, para um atleta, o que a tela não mostra: se o invariante do
// Adendo 05 (§4.2 — no máximo UM período com endedAt:null por vez) se
// mantém, e se weeklyReportWeek foi gravado quando a troca veio da aba
// Evolução. Também mostra o valor corrente em athletes/{uid}.phase, para
// confirmar que bate com o período mais recente.
//
// Uso:
//   node scripts/diagnosticar-historico-fase.mjs <athleteUid>
// -----------------------------------------------------------------------------

import { conectar } from './_firestore-cli.mjs';

const alvo = process.argv[2];
if (!alvo) {
  console.log('\n  Uso: node scripts/diagnosticar-historico-fase.mjs <athleteUid>\n');
  process.exit(1);
}

const db = conectar();
const projeto = process.env.PUBLIC_FIREBASE_PROJECT_ID;

const atleta = await db.collection('athletes').doc(alvo).get();
if (!atleta.exists) {
  console.log(`\n  ${alvo}: atleta não encontrado\n`);
  process.exit(1);
}

const periodos = await atleta.ref.collection('phases').orderBy('startedAt', 'desc').get();

console.log(`\n  Projeto: ${projeto}`);
console.log(`  ${alvo} · ${atleta.get('name') ?? '(sem nome)'}`);
console.log(`  athletes/{uid}.phase (valor corrente): ${atleta.get('phase') ?? '(ausente)'}\n`);

if (periodos.empty) {
  console.log('  Nenhum período em phases/ ainda — atleta nunca passou por esta função.\n');
  process.exit(0);
}

let abertos = 0;
periodos.docs.forEach((doc, i) => {
  const p = doc.data();
  const inicio = p.startedAt?.toDate ? p.startedAt.toDate().toISOString() : '(sem startedAt)';
  const fim = p.endedAt === null ? 'VIGENTE' : (p.endedAt?.toDate ? p.endedAt.toDate().toISOString() : '(sem endedAt)');
  if (p.endedAt === null) abertos++;
  const semana = p.weeklyReportWeek !== null && p.weeklyReportWeek !== undefined ? ` · semana=${p.weeklyReportWeek}` : '';
  console.log(`  ${i === 0 ? '→' : ' '} ${doc.id} · ${p.phase} · ${inicio} até ${fim}${semana}`);
  console.log(`      reason: ${p.reason ?? '(nulo)'}`);
});

console.log(`\n  Períodos com endedAt:null (deveria ser exatamente 1): ${abertos}` + (abertos !== 1 ? '  ← INVARIANTE VIOLADO' : ' — ok'));

const vigente = periodos.docs.find((d) => d.data().endedAt === null);
if (vigente) {
  const bateComValor = vigente.data().phase === atleta.get('phase');
  console.log(`  Período vigente bate com athletes/{uid}.phase: ${bateComValor ? 'sim' : 'NÃO — divergência'}`);
}
console.log('');
process.exit(0);
