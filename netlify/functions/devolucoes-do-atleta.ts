// ELITE90 PRO · devolucoes-do-atleta
// Netlify Function: AC-44 do Adendo 07 v1.51 — sinal informativo, na gaveta
// do Coach, de que ele já devolveu uma sugestão àquele plano e ela segue sem
// reenvio do profissional.
//
// CONSULTA IRMÃ DE `sugestoes-pendentes-do-atleta.ts` (AC-39), NÃO A MESMA
// Misturar `returned` no filtro daquela confundiria duas categorias que esta
// fase já aprendeu a manter separadas (AC-39 x AC-42): "ação necessária"
// (AC-39, só `pending`) e "contexto sobre decisão própria, em aberto do lado
// de outra pessoa" (aqui). `sugestoes-pendentes-do-atleta.ts` continua
// intocada — CA-150 e CA-178.
//
// SEM BOTÃO DE AÇÃO (CA-180). Não é chamada à ação: o profissional já vê a
// sugestão devolvida com prioridade máxima ao abrir o plano dele
// (`abrir-plano-profissional.ts`, `PREFERENCIA`) — isso já funcionava, sem
// lacuna. O que faltava era só o Coach saber, ao editar por cima, que aquela
// devolução ainda está aberta.
//
// MOSTRA A `reviewNote` (CA-177) — a observação que o próprio Coach escreveu
// ao devolver, para ele não precisar reabrir Aprovações para lembrar o que
// disse.
//
// SÓ PARA O COACH (CA-179/P-b). Mesmo raciocínio de escopo da AC-39.
//
// MESMO PADRÃO DE CONSULTA DA AC-39: igualdade pura (`status` +
// `athleteUid`), sem `orderBy` — nenhum índice novo.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { validarUid } from "./_m2-validacao";

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

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo inválido." });
  }

  const validacao = validarUid(corpo.athleteUid);
  if (!validacao.ok) return json(400, { erro: validacao.erro });

  const db = getFirestore(app);

  try {
    const snap = await db
      .collection(COLECAO_SUGESTOES)
      .where("status", "==", "returned")
      .where("athleteUid", "==", corpo.athleteUid)
      .get();

    if (snap.empty) return json(200, { total: 0, devolucoes: [] });

    const devolucoes = snap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          planType: d.planType ?? null,
          reviewNote: typeof d.reviewNote === "string" ? d.reviewNote : "",
          resolvedAt: d.resolvedAt?.toDate ? d.resolvedAt.toDate().toISOString() : null,
        };
      })
      .sort((a, b) => (a.resolvedAt ?? "9999").localeCompare(b.resolvedAt ?? "9999"));

    return json(200, { total: devolucoes.length, devolucoes });
  } catch (e: any) {
    const msg = e?.message ?? "erro desconhecido";
    return json(500, { erro: "Não foi possível ler as devoluções agora — " + msg });
  }
};
