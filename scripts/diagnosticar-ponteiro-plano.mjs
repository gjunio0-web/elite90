// ELITE90 PRO · diagnosticar-ponteiro-plano
// -----------------------------------------------------------------------------
// SOMENTE LEITURA. Não grava nada — só relata. (Fase 5, item 7, decisão D-1.)
//
// Até o item 7, nenhuma publicação gravava o ponteiro do plano: planos com
// versões em `versions/` ficaram com `currentVersion: null` e `status: "draft"`
// em `athletes/{uid}/plans/{planType}`. Este roteiro lista, por atleta e tipo
// de plano, a última versão existente e o que o documento do plano diz hoje,
// para dimensionar a reconciliação antes de qualquer gravação.
//
// Um projeto por execução, conferido por conectar() (_firestore-cli.mjs).
//
// Uso:
//   node scripts/diagnosticar-ponteiro-plano.mjs
// -----------------------------------------------------------------------------

import { conectar } from './_firestore-cli.mjs';

const TIPOS = ['training', 'nutrition'];

const db = conectar();
const projeto = process.env.PUBLIC_FIREBASE_PROJECT_ID;

const atletas = await db.collection('athletes').select().get();

const divergentes = [];
let comVersao = 0;

for (const atleta of atletas.docs) {
  for (const tipo of TIPOS) {
    const refPlano = atleta.ref.collection('plans').doc(tipo);
    // Mesma leitura de versao-publicada.ts: maior id pela ordem lexical.
    const ultima = await refPlano.collection('versions').orderBy('__name__', 'desc').limit(1).get();
    if (ultima.empty) continue;
    comVersao++;

    const numero = Number(String(ultima.docs[0].id).replace(/^v/, '')) || 0;
    const plano = await refPlano.get();
    const d = plano.exists ? plano.data() : null;
    const atual = {
      existe: plano.exists,
      currentVersion: d && d.currentVersion !== undefined ? d.currentVersion : '(ausente)',
      status: d && d.status !== undefined ? d.status : '(ausente)',
      hasUnpublishedChanges: d && d.hasUnpublishedChanges !== undefined ? d.hasUnpublishedChanges : '(ausente)',
    };
    if (atual.currentVersion !== numero || atual.status !== 'published') {
      divergentes.push({ uid: atleta.id, tipo, ultimaVersao: numero, ...atual });
    }
  }
}

console.log(`\n  Projeto: ${projeto}`);
console.log(`  Atletas: ${atletas.size}`);
console.log(`  Planos com ao menos uma versão publicada: ${comVersao}`);
console.log(`  Com ponteiro divergente da última versão: ${divergentes.length}\n`);
for (const x of divergentes) {
  console.log(`  - ${x.uid} · ${x.tipo}`);
  console.log(`      última versão: v${String(x.ultimaVersao).padStart(3, '0')}`);
  console.log(`      documento do plano: ${x.existe ? 'existe' : 'NÃO existe'} · currentVersion=${x.currentVersion} · status=${x.status} · hasUnpublishedChanges=${x.hasUnpublishedChanges}`);
}
console.log('');
process.exit(0);
