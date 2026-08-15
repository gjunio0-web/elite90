// --- ELITE 90 PRO · get-foto-urls
// Netlify Function: gera Signed URLs temporárias para as fotos de um lead.
// Chamada pelo painel admin ao abrir a gaveta "Ficha do Atleta".
//
// Segurança:
//   - Requer Firebase Auth ID token válido (coach autenticado).
//   - Signed URLs expiram em 15 minutos — não são acessíveis publicamente.
//   - Fotos ficam privadas no Storage; acesso apenas via esta function.

import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getApp, storageBucketName } from "./_firebase";

const SIGNED_URL_EXPIRY_MS = 15 * 60 * 1000; // 15 minutos


export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Autenticação — apenas coach logado pode acessar fotos
  const app = getApp();
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };
  try {
    await getAuth(app).verifyIdToken(idToken);
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  try {
    const { paths } = JSON.parse(event.body);
    if (!Array.isArray(paths) || paths.length === 0) {
      return { statusCode: 400, body: "paths[] obrigatório" };
    }

    // Nome do bucket explícito — mesma correção aplicada em submit-lead.ts
    const bucketName = storageBucketName();
    const bucket = getStorage().bucket(bucketName);
    const expiry = Date.now() + SIGNED_URL_EXPIRY_MS;

    const signedUrls = await Promise.all(
      paths.map(async (filePath: string) => {
        const [url] = await bucket.file(filePath).getSignedUrl({
          action: "read",
          expires: expiry,
        });
        return url;
      })
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ urls: signedUrls, expiresAt: expiry }),
    };
  } catch (err: any) {
    console.error("get-foto-urls error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message ?? "Erro interno" }),
    };
  }
};