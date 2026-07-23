// emulate-fn08.js
// Emula o FN-08 (stripe-webhook) SEM Stripe e SEM Resend, para testar a
// propagação de dados de um lead do M1 para o módulo M2 (/admin/atletas).
//
// Uso: node scripts/emulate-fn08.js <leadId> [--no-claim] [--convert]
//   <leadId>     id do documento na coleção "leads" (de preferência um lead
//                já em "avaliacao_enviada", para exercitar toda a cadeia do M1).
//   --no-claim   não define o custom claim { athlete: true } (útil se apenas
//                se quer ver o atleta no M2, sem habilitar acesso ao Portal).
//   --convert    fecha o elo: marca o lead de origem como convertido.
//
// Fases executadas (equivalente ao FN-08, menos Stripe e Resend):
//   1) lê leads/{leadId} (+ avaliação correspondente, se houver);
//   2) cria-ou-obtém a conta no Firebase Auth pelo e-mail (idempotente);
//   3) define o claim { athlete: true } (salvo --no-claim);
//   4) grava athletes/{uid} via o contrato _athlete-from-lead.js;
//   5) (opcional) marca o lead como convertido.
// Idempotente: doc-id = uid → re-rodar faz upsert, nunca duplica.
//
// ATENÇÃO — artefato de HOMOLOGAÇÃO. Rodar apenas contra um projeto Firebase
// de não-produção (ou com os documentos marcados _test:true). O runner usa o
// Admin SDK e contorna as regras de segurança do Firestore — que, aliás, ainda
// não estão versionadas no repositório (ausência de firestore.rules / storage.rules).
// Remover ao encerramento do projeto; _athlete-from-lead.js, ao contrário, PERMANECE.

'use strict';

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth }             = require('firebase-admin/auth');
const { getFirestore }        = require('firebase-admin/firestore');
const fs                      = require('fs');
const path                    = require('path');
const { athleteFromLead }     = require('../netlify/functions/_athlete-from-lead.js');

// -- Carrega .env.local da raiz (mesmo mecanismo de set-admin-claim.js, sem dotenv) --
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

// -- Argumentos --
const args    = process.argv.slice(2);
const leadId  = args.find(a => !a.startsWith('--'));
const noClaim   = args.includes('--no-claim');
const doConvert = args.includes('--convert');

if (!leadId) {
  console.error('Erro: informe o leadId como argumento.');
  console.error('  node scripts/emulate-fn08.js <leadId> [--no-claim] [--convert]');
  process.exit(1);
}

// -- Credenciais (idêntico ao precedente set-admin-claim.js) --
const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!saEnv) {
  console.error('Erro: FIREBASE_SERVICE_ACCOUNT_JSON não encontrada no .env.local.');
  process.exit(1);
}

let serviceAccount;
try {
  let raw = saEnv.trim();
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  if (raw.startsWith("'") && raw.endsWith("'")) raw = raw.slice(1, -1);
  try { serviceAccount = JSON.parse(raw); }
  catch { serviceAccount = JSON.parse(raw.replace(/\\"/g, '"')); }
  if (serviceAccount?.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
} catch (e) {
  console.error('Erro ao interpretar FIREBASE_SERVICE_ACCOUNT_JSON:', e.message);
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db   = getFirestore();
const auth = getAuth();

async function main() {
  // 1) Lê o lead de origem
  const leadSnap = await db.collection('leads').doc(leadId).get();
  if (!leadSnap.exists) {
    console.error(`Erro: lead "${leadId}" não encontrado na coleção "leads".`);
    process.exit(1);
  }
  const lead = { id: leadSnap.id, ...leadSnap.data() };
  if (!lead.email) {
    console.error('Erro: o lead não tem e-mail; impossível criar a conta no Auth.');
    process.exit(1);
  }
  console.log(`- Lead: ${lead.nome || '(sem nome)'} <${lead.email}> — status atual: ${lead.status}`);

  // 2) Best-effort: avaliação correspondente (só para rastrear o token; não bloqueia).
  //    O vínculo é o campo "leadId" gravado por send-evaluation.ts (linha ~161).
  let avaliacao = null;
  try {
    const av = await db.collection('avaliacoes').where('leadId', '==', leadId).limit(1).get();
    if (!av.empty) {
      avaliacao = { id: av.docs[0].id, ...av.docs[0].data() };
      console.log(`- Avaliação vinculada: ${avaliacao.id} (token: ${avaliacao.token || 'ausente'})`);
    } else {
      console.log('- Nenhuma avaliação vinculada encontrada (segue sem evaluationToken).');
    }
  } catch (e) {
    console.log('- Busca de avaliação ignorada:', e.message);
  }

  // 3) Cria-ou-obtém a conta no Auth por e-mail (idempotente)
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(lead.email);
    console.log(`- Conta já existia no Auth: uid=${userRecord.uid}`);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      userRecord = await auth.createUser({
        email:         lead.email,
        displayName:   lead.nome || undefined,
        emailVerified: false,
      });
      console.log(`- Conta criada no Auth: uid=${userRecord.uid}`);
    } else {
      throw e;
    }
  }
  const uid = userRecord.uid;

  // 4) Define o claim { athlete: true }, preservando claims existentes
  if (!noClaim) {
    const existing = userRecord.customClaims || {};
    await auth.setCustomUserClaims(uid, { ...existing, athlete: true });
    console.log('- Claim { athlete: true } definido.');
  } else {
    console.log('- Claim não alterado (--no-claim).');
  }

  // 5) Monta e grava athletes/{uid} via contrato compartilhado (upsert idempotente)
  const athleteDoc = athleteFromLead(lead, avaliacao, { uid, leadId });
  await db.collection('athletes').doc(uid).set(athleteDoc, { merge: true });
  console.log(`- athletes/${uid} gravado:`);
  console.log(`    name="${athleteDoc.name}", status="${athleteDoc.status}", startDate=${athleteDoc.startDate}`);
  console.log(`    evaluationToken=${athleteDoc.evaluationToken || 'null'}, _test=${athleteDoc._test}`);

  // 6) (Opcional) fecha o elo Pipeline A -> B
  if (doConvert) {
    await db.collection('leads').doc(leadId).update({
      convertedAt:          new Date().toISOString(),
      convertedAthleteUid:  uid,
    });
    console.log('- Lead marcado como convertido (convertedAt + convertedAthleteUid).');
  }

  console.log('\nEmulação concluída.');
  console.log('  Recarregue /admin/atletas (F5 — não há onSnapshot) para ver o atleta na lista.');
  console.log('  Observação: as abas de peso / evolução / avaliação física seguem ilustrativas');
  console.log('  (generateMockWeightData/seededRand). Dependem de athletes/[id]/evaluations/,');
  console.log('  subcoleção ainda ausente — cobrir esse interior está fora do escopo deste runner.');
  process.exit(0);
}

main().catch(e => {
  console.error('Falha na emulação:', e);
  process.exit(1);
});
