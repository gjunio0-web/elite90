// ELITE90 PRO — apagar-decisoes-coach.mjs
// Apaga o único documento gravado por esta consulta pontual ao Coach
// Fernando (Fase 5, rubrica de 25 critérios + desfecho por fase).
//
// Roteiro de leitura, não de produção — mesmo padrão dos demais scripts
// desta pasta (diagnosticar-*.mjs), inclusive na conexão: usa conectar()
// de _firestore-cli.mjs em vez de reimplementar a inicialização do Admin
// SDK aqui (é exatamente a duplicação que esse módulo existe para evitar).
//
// Uso: node scripts/apagar-decisoes-coach.mjs
// Exige a mesma credencial que os demais scripts já usam
// (FIREBASE_SERVICE_ACCOUNT_JSON no ambiente, ou em .env.local).

import { conectar } from './_firestore-cli.mjs';

async function main() {
  const db = conectar();
  const ref = db.collection('coachDecisions').doc('rubrica-fase5');

  const snap = await ref.get();
  if (!snap.exists) {
    console.log('Nenhum documento encontrado em coachDecisions/rubrica-fase5 — nada a apagar.');
    return;
  }

  console.log('Documento encontrado, apagando...');
  await ref.delete();
  console.log('Apagado: coachDecisions/rubrica-fase5.');
}

main().catch((e) => {
  console.error('Falha:', e.message);
  process.exit(1);
});
