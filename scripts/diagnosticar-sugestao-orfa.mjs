// ELITE90 PRO · diagnosticar-sugestao-orfa
// -----------------------------------------------------------------------------
// SOMENTE LEITURA. Não apaga, não grava, não corrige nada — só relata.
//
// Lista as sugestões de plano (coleção suggestions/) e confere, para cada
// uma, se o professionalId e o athleteUid que ela guarda ainda correspondem
// a um documento de verdade em professionals/ e athletes/. É exatamente essa
// checagem que aprovar-sugestao.ts/devolver-sugestao.ts/recusar-sugestao.ts
// fazem antes de agir — quando ela falha, o Coach vê "Cadastro do
// profissional não encontrado" (ou equivalente) na tela de Aprovações, sem
// dizer QUAL sugestão nem QUAL id está órfão. Este roteiro existe para
// responder isso: qual documento, e desde quando.
//
// Não há, em nenhuma função deste projeto, um caminho que apague um
// documento de professionals/ (conferido antes de escrever este roteiro) —
// então um professionalId órfão só chega a esse estado de duas formas: o
// valor nunca correspondeu a um cadastro real (dado inserido fora do fluxo
// normal de criar-conta-profissional.ts, comum em ambiente de homologação),
// ou o cadastro foi removido por fora da aplicação (console do Firestore
// direto). Este roteiro não distingue as duas — só aponta o documento.
//
// Uso:
//   node scripts/diagnosticar-sugestao-orfa.mjs            # só as pendentes (o que a tela de Aprovações mostra)
//   node scripts/diagnosticar-sugestao-orfa.mjs --todas     # todos os status (pending/returned/rejected/published)
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const TODAS = process.argv.slice(2).includes('--todas');

// ── Credenciais (mesmo mecanismo de limpar-homologacao.mjs / patch-lead-email.js) ──
const envPath = resolve(AQUI, '../.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key.startsWith('#') || process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!saEnv) {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON ausente (nem em .env.local, nem no ambiente). Sem credencial, o roteiro não executa.');
  process.exit(1);
}

let sa;
try {
  let raw = saEnv.trim();
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  if (raw.startsWith("'") && raw.endsWith("'")) raw = raw.slice(1, -1);
  try { sa = JSON.parse(raw); } catch { sa = JSON.parse(raw.replace(/\\"/g, '"')); }
  if (sa?.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
} catch (e) {
  console.error('Erro nas credenciais:', e.message);
  process.exit(1);
}

const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');

initializeApp({ credential: cert(sa) });
const db = getFirestore();

console.log(`Projeto: ${sa?.project_id ?? '(desconhecido)'}`);
console.log(TODAS ? 'Escopo: todas as sugestões, qualquer status.' : 'Escopo: só as pendentes (o que a tela de Aprovações mostra hoje). Use --todas para o histórico inteiro.');
console.log('');

const COLECAO_SUGESTOES = 'suggestions';
const COLECAO_ATLETAS = 'athletes';
const COLECAO_PROFISSIONAIS = 'professionals';

let query = db.collection(COLECAO_SUGESTOES);
if (!TODAS) query = query.where('status', '==', 'pending');
const snap = await query.get();

if (snap.empty) {
  console.log('Nenhuma sugestão encontrada nesse escopo.');
  process.exit(0);
}

const athleteUids = [...new Set(snap.docs.map((d) => d.get('athleteUid')).filter(Boolean))];
const professionalIds = [...new Set(snap.docs.map((d) => d.get('professionalId')).filter(Boolean))];

const [athleteDocs, profDocs] = await Promise.all([
  athleteUids.length ? db.getAll(...athleteUids.map((uid) => db.collection(COLECAO_ATLETAS).doc(uid))) : Promise.resolve([]),
  professionalIds.length ? db.getAll(...professionalIds.map((id) => db.collection(COLECAO_PROFISSIONAIS).doc(id))) : Promise.resolve([]),
]);
const atletas = new Map(athleteDocs.map((d) => [d.id, d.exists ? d.data() : null]));
const profissionais = new Map(profDocs.map((d) => [d.id, d.exists ? d.data() : null]));

let orfas = 0;
for (const doc of snap.docs) {
  const d = doc.data();
  const atleta = d.athleteUid ? atletas.get(d.athleteUid) : null;
  const prof = d.professionalId ? profissionais.get(d.professionalId) : null;
  const atletaOk = !!atleta;
  const profOk = !!prof;
  if (!atletaOk || !profOk) orfas++;

  const linha = (rotulo, ok, detalhe) => `    ${ok ? '✓' : '✗'} ${rotulo}: ${detalhe}`;

  console.log(`[${doc.id}] status=${d.status ?? '(ausente)'} planType=${d.planType ?? '(ausente)'} submittedAt=${d.submittedAt?.toDate?.()?.toISOString() ?? '(ausente)'}`);
  console.log(linha('athleteUid', atletaOk, `${d.athleteUid ?? '(ausente)'}${atletaOk ? ' — ' + (atleta.name ?? '(sem name)') : ' — NENHUM documento em athletes/ com este id'}`));
  console.log(linha('professionalId', profOk, `${d.professionalId ?? '(ausente)'}${profOk ? ' — ' + (prof.name ?? '(sem name)') + (prof.active === false ? ' [INATIVO]' : '') : ' — NENHUM documento em professionals/ com este id'}`));
  if (!atletaOk || !profOk) {
    console.log('    ⚠ ÓRFÃ — é esta referência ausente que produz "Cadastro ... não encontrado" ao aprovar/devolver/recusar.');
  }
  console.log('');
}

console.log(`Total: ${snap.docs.length} sugestão(ões) no escopo, ${orfas} órfã(s).`);
