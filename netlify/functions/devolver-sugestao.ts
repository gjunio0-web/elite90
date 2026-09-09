// ELITE90 PRO · devolver-sugestao
// Netlify Function: AC-05 do Adendo 07 — uma das três ações da tela de
// aprovação. Adendo 02, seção 7.4.1: evento `sugestao.devolvida`.
//
// DEVOLVER NÃO É RECUSAR. Devolve o trabalho ao profissional PARA AJUSTE — ele
// volta a poder editar (`status: "returned"`, aceito por `rascunhar-
// sugestao.ts` e por `submeter-sugestao.ts`, AC-18/AC-24). Recusar encerra o
// ciclo. As duas são funções separadas porque os estados resultantes seguem
// caminhos diferentes: `returned` reabre edição; `rejected` não.
//
// `reviewNote` OBRIGATÓRIA AQUI, E NUNCA NO EVENTO. Devolver sem dizer o que
// ajustar deixaria o profissional sem rumo — e é a mensagem que a AC-24 exibe
// na tela dele quando reabre a sugestão. `detalhe` do evento fica ausente
// (CA-39): a nota é texto sobre trabalho de terceiro, e o vocabulário de
// rastreabilidade não grava valor de campo, salvo os três casos já
// especificados no Adendo 02.
//
// SEM CRIAR VERSÃO. Só `aprovar-sugestao.ts` toca `versions/`.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { validarIdDocumento } from "./_m2-validacao";

const COLECAO_SUGESTOES = "suggestions";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

class NaoEncontrada extends Error {}
class EstadoInvalido extends Error {}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let ator: Ator & { tipo: "humano" };
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    ator = { tipo: "humano", uid: decoded.uid, email: decoded.email ?? null, papel: "admin" };
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo inválido." });
  }

  const vId = validarIdDocumento(corpo.suggestionId, "suggestionId");
  if (!vId.ok) return json(400, { erro: vId.erro });
  const suggestionId = String(corpo.suggestionId);

  const reviewNote = typeof corpo.reviewNote === "string" ? corpo.reviewNote.trim() : "";
  if (!reviewNote) {
    return json(400, { erro: "reviewNote é obrigatória ao devolver uma sugestão." });
  }

  const db = getFirestore(app);
  const ref = db.collection(COLECAO_SUGESTOES).doc(suggestionId);

  try {
    await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      if (!atual.exists) throw new NaoEncontrada();
      if (atual.get("status") !== "pending") throw new EstadoInvalido(String(atual.get("status")));

      tx.update(ref, {
        status: "returned",
        reviewNote,
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedBy: { uid: ator.uid, email: ator.email },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    if (e instanceof NaoEncontrada) return json(404, { erro: "Sugestão não encontrada." });
    if (e instanceof EstadoInvalido) {
      return json(409, { erro: "Só uma sugestão em revisão pode ser devolvida.", reason: "estado-invalido" });
    }
    console.error("[devolver-sugestao] falha ao gravar:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return json(500, { erro: "Não foi possível devolver agora — " + msg });
  }

  await registrar({
    acao: "sugestao.devolvida",
    ator,
    origem: "devolver-sugestao",
    alvo: { colecao: COLECAO_SUGESTOES, id: suggestionId } as Alvo,
    _test: process.env.CONTEXT !== "production",
  });

  return json(200, { ok: true, suggestionId, status: "returned" });
};
