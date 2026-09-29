// --- ELITE90 PRO · get-foto-urls
// Netlify Function: gera Signed URLs temporárias para as fotos de um lead.
// Chamada pelo painel admin ao abrir a gaveta "Ficha do Atleta".
//
// Segurança:
//   - Requer Firebase Auth ID token válido COM o atributo `admin` (Coach).
//   - Signed URLs expiram em 15 minutos — não são acessíveis publicamente.
//   - Fotos ficam privadas no Storage; acesso apenas via esta function.
//
// Phase 4 (persistence plan v5.23, gap 3.9, decision F4-11): the function used
// to accept ANY valid token. Athletes (promote-lead.ts) and delegated
// professionals (criar-conta-profissional.ts) have accounts too, so any of them
// could sign a URL for any path — including triage and check-in body photos,
// which the delegate projection reserves to level 2. Only the Coach's pages
// call this function (/admin/atletas, /admin/fichas), so requiring `admin`
// breaks nothing. The athlete reading their own photos is a Portal decision
// (plan §7.3) and will not reuse this function as it is.

import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getApp, storageBucketName } from "./_firebase";

const SIGNED_URL_EXPIRY_MS = 15 * 60 * 1000; // 15 minutos
// Largest legitimate call: a check-in (up to 5 photos) plus the baseline
// photos (the triage form accepts up to 5) — 10. Headroom for the lead drawer.
const MAX_PATHS = 20;


export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Autenticação e autorização — apenas o Coach (atributo `admin`).
  // "Autenticado" não é "autorizado" (padrão de autorização do plano, §2).
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
    const { paths } = JSON.parse(event.body);
    if (!Array.isArray(paths) || paths.length === 0) {
      return { statusCode: 400, body: "paths[] obrigatório" };
    }
    // Each entry must be a Storage path, not an object or a URL: the signed
    // URL is generated for exactly what the caller names.
    if (paths.length > MAX_PATHS || paths.some((p: unknown) => typeof p !== "string" || !p)) {
      return { statusCode: 400, body: `paths[] precisa ter de 1 a ${MAX_PATHS} caminhos em texto` };
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