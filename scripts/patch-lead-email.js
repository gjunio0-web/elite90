// patch-lead-email.js
// Atualiza o campo email de leads MOCK para endereços de teste únicos,
// permitindo que emulate-fn08.js crie contas Auth distintas para cada um.
//
// Uso: node scripts/patch-lead-email.js
//
// ATENÇÃO — artefato de HOMOLOGAÇÃO. Rodar apenas contra Firebase de não-produção.
// Os endereços gerados usam o TLD ".test" (RFC 2606), jamais roteado.

'use strict';

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore }        = require('firebase-admin/firestore');
const fs                      = require('fs');
const path                    = require('path');

const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
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
if (!saEnv) { console.error('FIREBASE_SERVICE_ACCOUNT_JSON não encontrada.'); process.exit(1); }

let sa;
try {
  let raw = saEnv.trim();
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  if (raw.startsWith("'") && raw.endsWith("'")) raw = raw.slice(1, -1);
  try { sa = JSON.parse(raw); } catch { sa = JSON.parse(raw.replace(/\\"/g, '"')); }
  if (sa?.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
} catch (e) { console.error('Erro nas credenciais:', e.message); process.exit(1); }

initializeApp({ credential: cert(sa) });
const db = getFirestore();

const PATCHES = [
  { id: '8CGYpulZvKbMtnKU9npu', email: 'ladislau.franco@homologacao.test' },
  { id: 'C1pWQE5QAiQ7fj4xGukV', email: 'vitor.xavier@homologacao.test'   },
];

async function main() {
  for (const { id, email } of PATCHES) {
    const snap = await db.collection('leads').doc(id).get();
    if (!snap.exists) { console.error(`Lead ${id} não encontrado — pulando.`); continue; }
    const atual = snap.data().email;
    await db.collection('leads').doc(id).update({ email });
    console.log(`- ${id}: "${atual}" → "${email}"`);
  }
  console.log('\nPatch concluído.');
}

main().catch(e => { console.error(e); process.exit(1); });
