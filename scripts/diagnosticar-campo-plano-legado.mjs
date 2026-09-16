// ELITE90 PRO · diagnosticar-campo-plano-legado
// -----------------------------------------------------------------------------
// SOMENTE LEITURA. Não apaga, não grava, não corrige nada — só relata.
//
// Fase 5, item 1 (plano M2 v5.12). Nenhuma função no head atual grava
// `trainingPlan`/`nutritionPlan` no documento do atleta (DV-4). Este roteiro
// responde a única pergunta que o código não responde: se documentos em
// athletes/ ainda carregam esses campos por gravação ANTERIOR (código antigo,
// script avulso, edição manual no console). Se relatar zero, não há migração.
//
// Um projeto por execução — o do ambiente, conferido por conectar()
// (_firestore-cli.mjs), que aborta se credencial e PUBLIC_FIREBASE_PROJECT_ID
// divergirem. Rodar uma vez para homologação e outra para produção.
//
// Uso:
//   node scripts/diagnosticar-campo-plano-legado.mjs
// -----------------------------------------------------------------------------

import { conectar } from './_firestore-cli.mjs';

const CAMPOS = ['trainingPlan', 'nutritionPlan'];

function descrever(valor) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return `array(${valor.length})`;
  if (typeof valor === 'object') return `mapa{${Object.keys(valor).sort().join(', ')}}`;
  return typeof valor;
}

const db = conectar();
const projeto = process.env.PUBLIC_FIREBASE_PROJECT_ID;

// select() traz só os dois campos: documento sem eles volta sem a chave, o que
// distingue "ausente" de "presente com null".
const snap = await db.collection('athletes').select(...CAMPOS).get();

const achados = [];
for (const doc of snap.docs) {
  const dados = doc.data();
  const presentes = CAMPOS.filter((c) => Object.prototype.hasOwnProperty.call(dados, c));
  if (presentes.length) {
    achados.push({ id: doc.id, campos: Object.fromEntries(presentes.map((c) => [c, descrever(dados[c])])) });
  }
}

console.log(`\n  Projeto: ${projeto}`);
console.log(`  Documentos em athletes/: ${snap.size}`);
console.log(`  Com trainingPlan e/ou nutritionPlan: ${achados.length}\n`);
for (const a of achados) {
  console.log(`  - ${a.id}`);
  for (const [campo, desc] of Object.entries(a.campos)) console.log(`      ${campo}: ${desc}`);
}
console.log('');
process.exit(0);
