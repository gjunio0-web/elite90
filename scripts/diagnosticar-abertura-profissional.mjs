// ELITE90 PRO · diagnosticar-abertura-profissional
// -----------------------------------------------------------------------------
// SOMENTE LEITURA. Não grava nada — só relata.
//
// Responde por que a tela do profissional abre vazia para um atleta. Reproduz a
// precedência de `abrir-plano-profissional.ts` sem chamar a função: fonte 1
// (sugestão própria não resolvida), fonte 2 (última versão publicada), fonte 3
// (vazio). Diz qual fonte responderia hoje e se ela tem conteúdo.
//
// Uso:
//   node scripts/diagnosticar-abertura-profissional.mjs <athleteUid>
//   node scripts/diagnosticar-abertura-profissional.mjs           (todos os atletas)
// -----------------------------------------------------------------------------

import { conectar } from './_firestore-cli.mjs';

const TIPOS = ['training', 'nutrition'];
const NAO_RESOLVIDOS = ['draft', 'returned', 'pending'];
const PREFERENCIA = ['returned', 'draft', 'pending'];

const alvo = process.argv[2] || null;
const db = conectar();
const projeto = process.env.PUBLIC_FIREBASE_PROJECT_ID;

function temConteudo(c) {
  if (!c || typeof c !== 'object') return false;
  const dias = c.days ?? {};
  return Object.keys(dias).length > 0;
}

const atletas = alvo
  ? [await db.collection('athletes').doc(alvo).get()]
  : (await db.collection('athletes').select('name').get()).docs;

console.log(`\n  Projeto: ${projeto}\n`);

for (const atleta of atletas) {
  if (!atleta.exists) { console.log(`  - ${alvo}: atleta não encontrado`); continue; }
  console.log(`  ${atleta.id} · ${atleta.get('name') ?? '(sem nome)'}`);

  for (const tipo of TIPOS) {
    // Fonte 1, na mesma ordem de preferência da função.
    const sugestoes = await db.collection('suggestions')
      .where('athleteUid', '==', atleta.id)
      .where('planType', '==', tipo)
      .get();
    const candidatas = sugestoes.docs.filter((d) => NAO_RESOLVIDOS.includes(d.get('status')));
    let escolhida = null;
    for (const estado of PREFERENCIA) {
      const achada = candidatas.find((d) => d.get('status') === estado);
      if (achada) { escolhida = achada; break; }
    }

    // Fonte 2.
    const versoes = await atleta.ref.collection('plans').doc(tipo)
      .collection('versions').orderBy('__name__', 'desc').limit(1).get();
    const ultima = versoes.empty ? null : versoes.docs[0];

    const linhas = [];
    linhas.push(`fonte 1: ${escolhida
      ? `sugestão ${escolhida.id} (${escolhida.get('status')}, profissional ${escolhida.get('professionalId')}) · conteúdo: ${temConteudo(escolhida.get('content')) ? 'sim' : 'VAZIO'} · basedOnVersion: ${escolhida.get('basedOnVersion') ?? '(nulo)'}`
      : 'nenhuma sugestão em aberto'}`);
    linhas.push(`fonte 2: ${ultima
      ? `${ultima.id} · conteúdo: ${temConteudo(ultima.get('content')) ? 'sim' : 'VAZIO'}`
      : 'nenhuma versão publicada'}`);

    // O que a função responde HOJE (sem a fonte 2) e DEPOIS do patch da fonte 2.
    const hoje = escolhida ? (temConteudo(escolhida.get('content')) ? 'sugestão com conteúdo' : 'sugestão VAZIA') : 'VAZIO (fonte 3)';
    const depois = escolhida
      ? hoje
      : (ultima ? (temConteudo(ultima.get('content')) ? 'versão publicada' : 'versão publicada VAZIA') : 'VAZIO (fonte 3)');
    linhas.push(`abre hoje: ${hoje} · abriria com a fonte 2: ${depois}`);

    console.log(`    [${tipo}]`);
    for (const l of linhas) console.log(`      ${l}`);
  }
  console.log('');
}
process.exit(0);
