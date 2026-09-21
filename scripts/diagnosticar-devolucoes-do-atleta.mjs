// ELITE90 PRO · diagnosticar-devolucoes-do-atleta
// -----------------------------------------------------------------------------
// SOMENTE LEITURA. Não grava nada — só relata.
//
// AC-44 não mostrava o sinal de devolução na gaveta do Coach mesmo com uma
// sugestão devolvida (status: "returned") sem reenvio, e sem erro nenhum no
// console. Este roteiro existe para separar duas causas possíveis: o dado no
// banco não é o que se esperava (athleteUid diferente, planType diferente,
// status diferente do que a tela mostra), ou o dado está certo e o defeito
// mora entre a função HTTP e a tela (função não implantada, JavaScript
// desatualizado no navegador).
//
// Lista TODAS as sugestões do atleta informado (qualquer status), e destaca
// separadamente o que a consulta EXATA de devolucoes-do-atleta.ts devolveria
// — as duas listas juntas mostram se há uma sugestão "quase certa" que não
// bate por causa de um único campo.
//
// Uso:
//   node scripts/diagnosticar-devolucoes-do-atleta.mjs <athleteUid>
// -----------------------------------------------------------------------------

import { conectar } from './_firestore-cli.mjs';

const athleteUid = process.argv[2];
if (!athleteUid) {
  console.error('\n  Uso: node scripts/diagnosticar-devolucoes-do-atleta.mjs <athleteUid>\n');
  process.exit(1);
}

const db = conectar();
const projeto = process.env.PUBLIC_FIREBASE_PROJECT_ID;

console.log(`\n  Projeto: ${projeto}`);
console.log(`  athleteUid consultado: ${athleteUid}\n`);

const atletaSnap = await db.collection('athletes').doc(athleteUid).get();
console.log(`  Documento athletes/${athleteUid}: ${atletaSnap.exists ? 'existe' : 'NÃO EXISTE'}`
  + (atletaSnap.exists ? ` · name=${atletaSnap.get('name') ?? '(sem nome)'}` : ''));

// ── TODAS as sugestões deste atleta, qualquer status ──
const todasSnap = await db.collection('suggestions').where('athleteUid', '==', athleteUid).get();
console.log(`\n  Sugestões com este athleteUid (qualquer status): ${todasSnap.size}\n`);
for (const doc of todasSnap.docs) {
  const d = doc.data();
  const resolvedAt = d.resolvedAt?.toDate ? d.resolvedAt.toDate().toISOString() : '(nenhum)';
  console.log(`  - ${doc.id}`);
  console.log(`      status=${JSON.stringify(d.status)} · planType=${JSON.stringify(d.planType)} · professionalId=${d.professionalId ?? '(nenhum)'}`);
  console.log(`      reviewNote=${JSON.stringify(d.reviewNote ?? null)} · resolvedAt=${resolvedAt}`);
}

// ── Exatamente a consulta de devolucoes-do-atleta.ts ──
const devolvidasSnap = await db.collection('suggestions')
  .where('status', '==', 'returned')
  .where('athleteUid', '==', athleteUid)
  .get();
console.log(`\n  A consulta exata de devolucoes-do-atleta.ts (status="returned" + este athleteUid) devolve: ${devolvidasSnap.size} documento(s).`);
if (devolvidasSnap.empty && todasSnap.size > 0) {
  const statusEncontrados = [...new Set(todasSnap.docs.map((d) => d.get('status')))];
  console.log(`  Nenhuma bate com status="returned" — os status reais encontrados para este atleta são: ${JSON.stringify(statusEncontrados)}.`);
}
console.log('');
process.exit(0);
