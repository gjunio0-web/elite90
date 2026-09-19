// ELITE90 PRO · diagnosticar-config-formula
// -----------------------------------------------------------------------------
// SOMENTE LEITURA. Não grava nada — só relata.
//
// Mostra o documento `config/nutritionFormula` exatamente como está gravado
// no banco agora, sem passar pela tela do painel. Existe para separar duas
// causas de "a alteração não persistiu": o valor nunca chegou a ser salvo, ou
// foi salvo e é a tela que não está mostrando certo.
//
// Uso:
//   node scripts/diagnosticar-config-formula.mjs
// -----------------------------------------------------------------------------

import { conectar } from './_firestore-cli.mjs';

const db = conectar();
const projeto = process.env.PUBLIC_FIREBASE_PROJECT_ID;

const snap = await db.collection('config').doc('nutritionFormula').get();

console.log(`\n  Projeto: ${projeto}`);

if (!snap.exists) {
  console.log('  Documento config/nutritionFormula NÃO EXISTE ainda.\n');
  process.exit(0);
}

const d = snap.data();
console.log(`  updatedAt: ${d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : '(nunca atualizado — só valores de origem)'}`);
console.log(`  updatedBy: ${d.updatedBy ? d.updatedBy.email ?? d.updatedBy.uid : '(nenhum)'}\n`);
for (const fase of Object.keys(d.phases ?? {})) {
  const c = d.phases[fase];
  console.log(`  ${fase}: proteína=${c.proteinPerKg} · carbo=${c.carbPerKg} · gordura=${c.fatPerKg}`);
}
console.log('');
process.exit(0);
