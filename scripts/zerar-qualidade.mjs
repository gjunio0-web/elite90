// ELITE90 PRO · zerar-qualidade
// -----------------------------------------------------------------------------
// Esvazia o ambiente de qualidade: apaga TODOS os documentos de `leads`,
// `athletes` e `rastreabilidade`, remove as contas de acesso dos atletas
// apagados, e apaga os arquivos sob `test_seed/` no Storage.
//
// SEM SELEÇÃO, E É DE PROPÓSITO. O ambiente de qualidade não tem dado a
// preservar: todo registro nele foi produzido por script de semeadura ou por
// exercício de homologação. Um roteiro que escolhesse o que apagar precisaria
// de critério, e critério erra — o anterior travou por causa de uma ficha cujo
// elo apontava para um atleta já removido à mão. Aqui não há o que separar,
// então não há critério que possa errar.
//
//   • ENSAIO EM SECO POR PADRÃO. Nada é apagado sem --commit.
//   • RECUSA-SE A RODAR CONTRA PRODUÇÃO. O project_id da credencial é conferido
//     ANTES de abrir conexão com o banco.
//   • O ambiente de qualidade é reconstituível: seed-triagem-bulk.ts repovoa
//     `leads`, e emulate-fn08.js volta a promover atletas a partir delas.
//
// ─────────────────────────────────────────────────────────────────────────────
// ATENÇÃO — ARTEFATO DE HOMOLOGAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
// Deve ser REMOVIDO no encerramento do projeto, junto com seed-triagem-bulk.ts,
// score-mocks.ts, clean-mock-leads.ts, emulate-fn08.js, patch-lead-email.js,
// ativar-planos-mock.js e limpar-homologacao.mjs.
//
// Uso:
//   node scripts/zerar-qualidade.mjs            # ensaio: mostra o que sairia
//   node scripts/zerar-qualidade.mjs --commit   # apaga
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

const PROJETOS_PROIBIDOS = ['elite90-c716b'];
const COLECOES = ['leads', 'athletes', 'rastreabilidade'];
const PREFIXO_SEED = 'test_seed/';
const LOTE_MAXIMO = 400; // abaixo do teto de 500 operações por lote do Firestore

const COMMIT = process.argv.slice(2).includes('--commit');

// ── Credenciais ──────────────────────────────────────────────────────────────
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
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON ausente. Sem credencial declarada, o roteiro não executa.');
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

// ── TRAVA DE AMBIENTE ────────────────────────────────────────────────────────
// Antes de qualquer import do firebase-admin: um roteiro que esvazia coleções
// não deve nem carregar o cliente do banco antes de saber com qual projeto vai
// falar.
const projeto = sa?.project_id ?? '(desconhecido)';
if (PROJETOS_PROIBIDOS.includes(projeto)) {
  console.error(
    `RECUSADO: a credencial aponta para "${projeto}", que é projeto de produção.\n` +
    'Este roteiro esvazia coleções inteiras e não roda contra produção em hipótese alguma.'
  );
  process.exit(1);
}

const bucketNome = process.env.PUBLIC_FIREBASE_STORAGE_BUCKET;

// firebase-admin carregado por import() DEPOIS da trava — import estático é
// içado para o topo do módulo e rodaria antes dela.
const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const { getAuth } = await import('firebase-admin/auth');
const { getStorage } = await import('firebase-admin/storage');

initializeApp(bucketNome ? { credential: cert(sa), storageBucket: bucketNome } : { credential: cert(sa) });
const db = getFirestore();
const auth = getAuth();

// ── Apoio ────────────────────────────────────────────────────────────────────
function seco(t) { return COMMIT ? t : `[ENSAIO] ${t}`; }

async function apagarEmLotes(refs) {
  for (let i = 0; i < refs.length; i += LOTE_MAXIMO) {
    const lote = db.batch();
    refs.slice(i, i + LOTE_MAXIMO).forEach((r) => lote.delete(r));
    await lote.commit();
  }
}

/** Subcoleções em qualquer profundidade. listCollections() só existe no Admin
 *  SDK — é a razão de esta limpeza não poder ser feita pelo console, que apaga o
 *  documento pai e deixa as subcoleções órfãs e invisíveis. */
async function apagarSubcolecoes(docRef) {
  let total = 0;
  for (const sub of await docRef.listCollections()) {
    const snap = await sub.get();
    for (const doc of snap.docs) total += await apagarSubcolecoes(doc.ref);
    if (COMMIT) await apagarEmLotes(snap.docs.map((d) => d.ref));
    total += snap.size;
  }
  return total;
}

// ── Execução ─────────────────────────────────────────────────────────────────
console.log('== ZERAR AMBIENTE DE QUALIDADE ==');
console.log(`Projeto: ${projeto}`);
console.log(`Bucket:  ${bucketNome ?? '(não declarado — Storage será pulado)'}`);
console.log(COMMIT ? 'Modo:    GRAVAÇÃO (--commit)\n' : 'Modo:    ENSAIO EM SECO (nada é apagado; use --commit)\n');

// -- Contas de acesso dos atletas --
// Levantadas ANTES de apagar os documentos: o identificador do documento é o da
// conta, e depois de apagado não há de onde tirá-lo.
const atletasSnap = await db.collection('athletes').get();
const uids = atletasSnap.docs.map((d) => d.id);

// -- Coleções --
let subcolecoesTotal = 0;
for (const nome of COLECOES) {
  const snap = await db.collection(nome).get();
  console.log(seco(`${nome}: ${snap.size} documento(s)`));

  if (nome === 'athletes') {
    for (const doc of snap.docs) {
      const n = await apagarSubcolecoes(doc.ref);
      if (n > 0) console.log(seco(`  subcoleções de ${doc.id}: ${n} documento(s)`));
      subcolecoesTotal += n;
    }
  }
  if (COMMIT) await apagarEmLotes(snap.docs.map((d) => d.ref));
}
if (subcolecoesTotal === 0) console.log('  (nenhuma subcoleção)');

// -- Contas de acesso --
// Conta com outra permissão além de athlete é PRESERVADA: promote-lead.ts
// reaproveita conta existente pelo e-mail, então a conta de um atleta pode ser
// a mesma de alguém do time. Nesse caso sai só a permissão de atleta.
console.log('');
for (const uid of uids) {
  try {
    const conta = await auth.getUser(uid);
    const claims = conta.customClaims ?? {};
    const outras = Object.keys(claims).filter((k) => k !== 'athlete' && claims[k]);
    if (outras.length > 0) {
      console.log(seco(`conta ${conta.email ?? uid} PRESERVADA (tem também: ${outras.join(', ')}) — sai só a permissão athlete`));
      if (COMMIT) { const { athlete, ...resto } = claims; await auth.setCustomUserClaims(uid, resto); }
    } else {
      console.log(seco(`conta ${conta.email ?? uid} removida`));
      if (COMMIT) await auth.deleteUser(uid);
    }
  } catch (e) {
    if (e?.code === 'auth/user-not-found') console.log(`conta ${uid}: já não existe`);
    else console.log(`conta ${uid}: erro — ${e?.message ?? e}`);
  }
}
if (uids.length === 0) console.log('nenhuma conta de atleta a tratar');

// -- Storage --
console.log('');
if (!bucketNome) {
  console.log('Storage pulado: PUBLIC_FIREBASE_STORAGE_BUCKET não declarada.');
  console.log('Não há valor padrão — assumir um bucket seria arriscar apagar no projeto errado.');
} else {
  const [arquivos] = await getStorage().bucket(bucketNome).getFiles({ prefix: PREFIXO_SEED });
  console.log(seco(`${PREFIXO_SEED}: ${arquivos.length} arquivo(s)`));
  if (COMMIT && arquivos.length > 0) {
    const erros = [];
    await Promise.all(arquivos.map((f) => f.delete().catch((e) => erros.push(`${f.name}: ${e.message}`))));
    console.log(`  apagados: ${arquivos.length - erros.length}, falhas: ${erros.length}`);
    erros.forEach((e) => console.log(`  ! ${e}`));
  }
}

console.log(COMMIT
  ? '\nConcluído. Para repovoar: seed-triagem-bulk.ts e, em seguida, emulate-fn08.js.'
  : '\n(Ensaio em seco — nada foi alterado. Repita com --commit para apagar.)');
