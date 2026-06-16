// DIAGNÓSTICO TEMPORÁRIO — remover após resolução do bug de upload de fotos.
// Testa getStorage().bucket(name).exists() e retorna informações detalhadas
// sobre o nome do bucket sendo usado, sem fazer upload algum.

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

function getApp() {
  if (!getApps().length) {
    let saEnv: string = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "{}").trim();
    let serviceAccount: any = null;
    if (saEnv.startsWith('"') && saEnv.endsWith('"')) saEnv = saEnv.slice(1, -1);
    if (saEnv.startsWith("'") && saEnv.endsWith("'")) saEnv = saEnv.slice(1, -1);
    try {
      serviceAccount = JSON.parse(saEnv);
    } catch {
      serviceAccount = JSON.parse(saEnv.replace(/\\"/g, '"'));
    }
    if (serviceAccount?.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: process.env.PUBLIC_FIREBASE_STORAGE_BUCKET ?? "elite90-c716b.firebasestorage.app",
    });
  }
  return getApps()[0];
}

export const handler = async () => {
  const app = getApp();
  const envBucketRaw = process.env.PUBLIC_FIREBASE_STORAGE_BUCKET ?? null;
  const appBucketOption = (app.options as any)?.storageBucket ?? null;
  const fallbackUsed = "elite90-c716b.firebasestorage.app";

  const results: Record<string, any> = {
    envBucketRaw,
    envBucketRawLength: envBucketRaw ? envBucketRaw.length : null,
    envBucketRawCharCodes: envBucketRaw ? Array.from(envBucketRaw).map(c => c.charCodeAt(0)) : null,
    appBucketOption,
    fallbackUsed,
    projectId: (app.options as any)?.projectId ?? null,
  };

  // Tenta 1: bucket() sem argumento (resolução implícita)
  try {
    const bucket1 = getStorage(app).bucket();
    const [exists1] = await bucket1.exists();
    results.implicit_bucket_name = bucket1.name;
    results.implicit_exists = exists1;
  } catch (e: any) {
    results.implicit_error = e?.message ?? String(e);
  }

  // Tenta 2: bucket(fallbackUsed) explícito
  try {
    const bucket2 = getStorage(app).bucket(fallbackUsed);
    const [exists2] = await bucket2.exists();
    results.explicit_bucket_name = bucket2.name;
    results.explicit_exists = exists2;
  } catch (e: any) {
    results.explicit_error = e?.message ?? String(e);
  }

  // Tenta 3: bucket name sem o sufixo .firebasestorage.app (formato legado puro)
  try {
    const legacyName = "elite90-c716b.appspot.com";
    const bucket3 = getStorage(app).bucket(legacyName);
    const [exists3] = await bucket3.exists();
    results.legacy_bucket_name = bucket3.name;
    results.legacy_exists = exists3;
  } catch (e: any) {
    results.legacy_error = e?.message ?? String(e);
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(results, null, 2),
  };
};