// ELITE 90 PRO · delete-lead
// Netlify Function: exclui permanentemente a ficha de um lead (LGPD Art. 18, VI).
// Remove as fotos do Firebase Storage antes de apagar o documento Firestore,
// garantindo que nenhum dado pessoal permaneça no bucket após a exclusão.
//
// Segurança: requer Firebase ID token com custom claim admin:true.

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function getApp() {
  if (!getApps().length) {
    let saEnv: string = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "{}").trim();
    let serviceAccount: any = null;
    try {
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
    } catch (e: any) {
      throw new Error(`Erro no parse das credenciais: ${e.message}`);
    }
    if (!serviceAccount?.private_key) throw new Error("Credenciais do Firebase ausentes.");
    initializeApp({
      credential: cert(serviceAccount as any),
      storageBucket: process.env.PUBLIC_FIREBASE_STORAGE_BUCKET ?? "elite90-c716b.firebasestorage.app",
    });
  }
  return getApps()[0];
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  try {
    const { leadId } = JSON.parse(event.body ?? "{}");
    if (!leadId) return { statusCode: 400, body: "leadId obrigatório" };

    const db = getFirestore();
    const leadDoc = await db.collection("leads").doc(leadId).get();
    if (!leadDoc.exists) return { statusCode: 404, body: "Lead não encontrado" };

    const lead = leadDoc.data() as Record<string, any>;
    const fotosPaths: string[] = Array.isArray(lead.fotos_paths) ? lead.fotos_paths : [];

    const bucketName = process.env.PUBLIC_FIREBASE_STORAGE_BUCKET ?? "elite90-c716b.firebasestorage.app";
    const bucket = getStorage().bucket(bucketName);

    const storageErrors: string[] = [];
    await Promise.all(
      fotosPaths.map(async (filePath: string) => {
        try {
          await bucket.file(filePath).delete();
        } catch (e: any) {
          // Arquivo já ausente não é erro — prossegue com exclusão do documento.
          if (e.code !== 404 && e.code !== 204) {
            storageErrors.push(`${filePath}: ${e.message}`);
          }
        }
      })
    );

    await leadDoc.ref.delete();

    if (storageErrors.length > 0) {
      console.warn("[delete-lead] Fotos não removidas do Storage:", storageErrors);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        fotosApagadas: fotosPaths.length - storageErrors.length,
        storageErrors,
      }),
    };
  } catch (err: any) {
    console.error("[delete-lead] Erro:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message ?? "Erro interno" }),
    };
  }
};
