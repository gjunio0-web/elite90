// set-admin-claim.js — Executa uma única vez para conceder acesso administrativo.
// Uso: node scripts/set-admin-claim.js <UID_DO_USUARIO>

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const fs = require("fs");
const path = require("path");

// Carrega .env.local da raiz do projeto (sem dependência de dotenv)
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key.startsWith("#") || process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const uid = process.argv[2];
if (!uid) {
  console.error("Erro: informe o UID como argumento.");
  console.error("  node scripts/set-admin-claim.js <UID>");
  process.exit(1);
}

const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!saEnv) {
  console.error("Erro: FIREBASE_SERVICE_ACCOUNT_JSON não encontrada no .env.local.");
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
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }
} catch (e) {
  console.error("Erro ao interpretar FIREBASE_SERVICE_ACCOUNT_JSON:", e.message);
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });

getAuth()
  .setCustomUserClaims(uid, { admin: true })
  .then(() => {
    console.log(`✓ Custom Claim { admin: true } definida para o UID: ${uid}`);
    console.log("  Faça logout e login novamente no painel para que o token reflita a mudança.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Falha ao definir a claim:", err.message);
    process.exit(1);
  });
