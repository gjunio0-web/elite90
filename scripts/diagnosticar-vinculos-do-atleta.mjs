// ELITE90 PRO · diagnosticar-vinculos-do-atleta
// -----------------------------------------------------------------------------
// SOMENTE LEITURA. Não grava nada — só relata.
//
// Mostra TODOS os vínculos de assignments/ para um atleta — ativos e
// encerrados, nas duas especialidades —, para separar "o vínculo nunca
// existiu" de "o vínculo existiu e foi encerrado" de "o vínculo existe e a
// tela não mostrou". A tela (listar-carteira.ts) só devolve os ativos;
// este script mostra o histórico inteiro, com origin e endedReason, que é
// exatamente o que falta para diagnosticar uma troca de titularidade que
// pareceu levar junto um vínculo de outra especialidade.
//
// Uso:
//   node scripts/diagnosticar-vinculos-do-atleta.mjs <athleteUid>
// -----------------------------------------------------------------------------

import { conectar } from './_firestore-cli.mjs';

const alvo = process.argv[2];
if (!alvo) {
  console.log('\n  Uso: node scripts/diagnosticar-vinculos-do-atleta.mjs <athleteUid>\n');
  process.exit(1);
}

const db = conectar();
const projeto = process.env.PUBLIC_FIREBASE_PROJECT_ID;

const atleta = await db.collection('athletes').doc(alvo).get();
if (!atleta.exists) {
  console.log(`\n  ${alvo}: atleta não encontrado\n`);
  process.exit(1);
}

console.log(`\n  Projeto: ${projeto}`);
console.log(`  ${alvo} · ${atleta.get('name') ?? '(sem nome)'}\n`);

const [porAtleta, todosOsAtivos] = await Promise.all([
  db.collection('assignments').where('athleteUid', '==', alvo).get(),
  db.collection('assignments').where('athleteUid', '==', alvo).where('endedAt', '==', null).get(),
]);

if (porAtleta.empty) {
  console.log('  Nenhum vínculo em assignments/ para este atleta, em especialidade alguma.\n');
  process.exit(0);
}

const idsProfissionais = [...new Set(porAtleta.docs.map((d) => String(d.get('professionalId'))))];
const nomesPorProfissional = new Map();
if (idsProfissionais.length) {
  const refs = idsProfissionais.map((id) => db.collection('professionals').doc(id));
  const docs = await db.getAll(...refs);
  for (const s of docs) nomesPorProfissional.set(s.id, s.exists ? (s.get('name') ?? '(sem nome)') : '(profissional ausente)');
}

const porEspecialidade = new Map();
for (const doc of porAtleta.docs) {
  const esp = String(doc.get('specialty'));
  if (!porEspecialidade.has(esp)) porEspecialidade.set(esp, []);
  porEspecialidade.get(esp).push(doc);
}

for (const [especialidade, docs] of [...porEspecialidade.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ── ${especialidade} ──`);
  docs
    .sort((a, b) => {
      const ta = a.get('startedAt')?.toMillis?.() ?? 0;
      const tb = b.get('startedAt')?.toMillis?.() ?? 0;
      return tb - ta;
    })
    .forEach((doc) => {
      const d = doc.data();
      const inicio = d.startedAt?.toDate ? d.startedAt.toDate().toISOString() : '(sem startedAt)';
      const fim = d.endedAt === null ? 'ATIVO' : (d.endedAt?.toDate ? d.endedAt.toDate().toISOString() : '(sem endedAt)');
      const nomeProf = nomesPorProfissional.get(String(d.professionalId)) ?? d.professionalId;
      console.log(`    ${doc.id} · ${nomeProf} (${d.professionalId})`);
      console.log(`        origin: ${d.origin ?? '(ausente)'} · ${inicio} até ${fim}`);
      if (d.endedAt !== null) console.log(`        endedReason: ${d.endedReason ?? '(nulo)'}`);
    });
  console.log('');
}

const ativos = todosOsAtivos.docs.map((d) => d.get('specialty'));
console.log(`  Vínculos ATIVOS agora: ${ativos.length ? ativos.join(', ') : '(nenhum)'}`);
const especialidadesConhecidas = [...porEspecialidade.keys()];
const semNuncaTerExistido = especialidadesConhecidas.filter((e) => !ativos.includes(e) && porEspecialidade.get(e).every((d) => d.data().endedAt !== null));
if (semNuncaTerExistido.length) {
  console.log(`  Especialidades com histórico só de vínculos ENCERRADOS (nenhum ativo hoje): ${semNuncaTerExistido.join(', ')}`);
}
console.log('');
process.exit(0);
