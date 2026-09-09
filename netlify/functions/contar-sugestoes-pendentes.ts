// ELITE90 PRO · contar-sugestoes-pendentes
// Netlify Function: AC-29 do Adendo 07 — o número que o indicador em
// `atletas.astro` mostra.
//
// FUNÇÃO SEPARADA DE `listar-sugestoes-pendentes.ts`, DE PROPÓSITO. O
// indicador entra na gaveta do Coach ao abrir a página — carregar o conteúdo
// de N planos inteiros só para exibir um número seria a mesma classe de
// desperdício que a AD-06 evita do lado do delegado, na direção oposta: aqui
// não é sobre o que se pode ver, é sobre não buscar mais do que se precisa.
//
// `.count()` em vez de `.get()`: o Firestore soma no servidor sem devolver os
// documentos. Usa o MESMO índice de `listar-sugestoes-pendentes.ts` — nenhuma
// consulta nova, nenhum índice novo.
//
// CA-72 exige que este número seja real. Ele é: a mesma consulta que a tela
// de aprovação lista, só que contada em vez de trazida por inteiro.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";

const COLECAO_SUGESTOES = "suggestions";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  const app = getApp();
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  const db = getFirestore(app);
  const agregado = await db
    .collection(COLECAO_SUGESTOES)
    .where("status", "==", "pending")
    .count()
    .get();

  return json(200, { total: agregado.data().count });
};
