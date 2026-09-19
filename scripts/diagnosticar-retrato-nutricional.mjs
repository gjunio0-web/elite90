// ELITE90 PRO · diagnosticar-retrato-nutricional
// -----------------------------------------------------------------------------
// SOMENTE LEITURA. Não grava nada — só relata.
//
// Confirma, na ÚLTIMA versão de plano nutricional de cada atleta, o que a UI
// não consegue mostrar diretamente: se `formulaSnapshot` (Adendo 03) está
// presente, e se cada alimento de cada refeição tem `.snapshot` (AC-43) — o
// congelamento correto não muda o que aparece na tela, então só a leitura
// direta do banco prova a diferença.
//
// Uso:
//   node scripts/diagnosticar-retrato-nutricional.mjs                (todos)
//   node scripts/diagnosticar-retrato-nutricional.mjs <athleteUid>   (um só)
// -----------------------------------------------------------------------------

import { conectar } from './_firestore-cli.mjs';

const alvo = process.argv[2] || null;
const db = conectar();
const projeto = process.env.PUBLIC_FIREBASE_PROJECT_ID;

function contarAlimentos(content) {
  let total = 0, comSnapshot = 0;
  const dias = content?.days ?? {};
  for (const chave of Object.keys(dias)) {
    const refeicoes = dias[chave]?.meals ?? [];
    for (const m of refeicoes) {
      for (const f of m.foods ?? []) {
        total++;
        if (f.snapshot) comSnapshot++;
      }
    }
  }
  return { total, comSnapshot };
}

const atletas = alvo
  ? [await db.collection('athletes').doc(alvo).get()]
  : (await db.collection('athletes').select('name').get()).docs;

console.log(`\n  Projeto: ${projeto}\n`);

for (const atleta of atletas) {
  if (!atleta.exists) { console.log(`  - ${alvo}: atleta não encontrado`); continue; }

  const versoes = await atleta.ref.collection('plans').doc('nutrition')
    .collection('versions').orderBy('__name__', 'desc').limit(1).get();
  if (versoes.empty) continue;

  const v = versoes.docs[0];
  const content = v.get('content') ?? {};
  const fs = content.formulaSnapshot;
  const { total, comSnapshot } = contarAlimentos(content);

  console.log(`  ${atleta.id} · ${atleta.get('name') ?? '(sem nome)'} · última versão nutricional: ${v.id}`);
  console.log(`      formulaSnapshot: ${fs ? 'presente' : 'AUSENTE'}` + (fs ? ` · fase=${fs.phase} · peso=${fs.weightKgUsed}kg · metas=${JSON.stringify(fs.targets)}` : ''));
  console.log(`      alimentos com retrato (.snapshot): ${comSnapshot} de ${total}` + (total > 0 && comSnapshot < total ? '  ← ALGUM SEM RETRATO' : ''));
  console.log('');
}
process.exit(0);
