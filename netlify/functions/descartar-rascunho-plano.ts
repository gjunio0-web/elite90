// ELITE90 PRO · descartar-rascunho-plano
// Netlify Function: apaga o rascunho do Coach em athletes/{uid}/plans/{planType}.
//
// AC-38, quarta ação (Adendo 07 v1.41). Existe porque o Coach precisa de uma
// saída quando o rascunho dele diverge da versão que ele mesmo aprovou de um
// profissional: manter a versão aprovada preserva o rascunho, e o selo de
// "Alterações não publicadas" continuaria aceso indefinidamente. Esta função é
// a única forma de apagar o rascunho, e SÓ roda por escolha explícita no modal
// (CA-145, CA-147).
//
// POR QUE NÃO É `salvar-rascunho-plano` COM CONTEÚDO NULO
//
// Aquela função valida o rascunho por `validarRascunho`. Aceitar nulo ali
// abriria a validação de toda gravação de autossalvo para apagar trabalho por
// engano — um autossalvo com estado corrompido no navegador apagaria o
// rascunho do servidor. Função separada, verbo separado.
//
// O QUE NÃO FAZ
//
// Não cria versão publicada: descartar rascunho não publica nada, e
// `currentVersion` fica exatamente como estava (CA-141 por analogia). Não toca
// nas versões, que são imutáveis.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { validarUid, validarPlanType, type PlanType } from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_PLANOS = "plans";

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Mesma ordem de salvar-rascunho-plano: autenticação antes de ler o corpo.
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let uid: string;
  let email: string | null;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    uid = decoded.uid;
    email = decoded.email ?? null;
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo inválido." });
  }

  const { athleteUid, planType } = corpo;
  for (const v of [validarUid(athleteUid), validarPlanType(planType)]) {
    if (!v.ok) return json(400, { erro: v.erro });
  }

  const db = getFirestore(app);

  try {
    const planoRef = db
      .collection(COLECAO_ATLETAS).doc(athleteUid)
      .collection(SUBCOLECAO_PLANOS).doc(planType as PlanType);
    const planoSnap = await planoRef.get();
    if (!planoSnap.exists) {
      // Sem documento de plano não há rascunho a descartar. Responder 404 aqui
      // é informação útil ao chamador, e não vaza nada: quem chega até esta
      // linha já passou pelo claim admin.
      return json(404, { erro: "Plano não encontrado." });
    }

    // `merge: true` pela mesma razão de salvar-rascunho-plano: o ponteiro de
    // versão tem outro dono e outro ciclo, e sobrescrever inteiro o apagaria.
    await planoRef.set({
      draft: null,
      draftUpdatedAt: FieldValue.serverTimestamp(),
      draftUpdatedBy: { uid, email },
      // CA-146. Sem rascunho não há divergência com a versão corrente, e o selo
      // de "Alterações não publicadas" precisa apagar.
      hasUnpublishedChanges: false,
    }, { merge: true });

    return json(200, { ok: true, athleteUid, planType });
  } catch (e: any) {
    const msg = e?.message ?? "erro desconhecido";
    return json(500, { erro: "Não foi possível descartar o rascunho agora — " + msg });
  }
};
