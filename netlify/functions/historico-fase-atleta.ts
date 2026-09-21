// ELITE90 PRO · historico-fase-atleta
// Netlify Function: leitura de `athletes/{uid}/phases`, para o histórico de
// fases do modal (Adendo 05 v1.5, §8.2). O navegador não lê a subcoleção
// direto — `firestore.rules` nega qualquer subcoleção de `athletes/{uid}`,
// por decisão já registrada ali ("Escrita e leitura exclusivamente por
// função de servidor").
//
// SÓ O COACH. Mesmo raciocínio de toda leitura administrativa desta fase.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { validarUid } from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_FASES = "phases";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

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

  try {
    const db = getFirestore(app);
    // Ordem natural por `startedAt` (§4.4 do adendo — sem índice: subcoleção
    // pequena). Mais recente primeiro, para a lista no modal abrir já com o
    // período vigente no topo.
    const snap = await db
      .collection(COLECAO_ATLETAS).doc(corpo.athleteUid)
      .collection(SUBCOLECAO_FASES)
      .orderBy("startedAt", "desc")
      .get();

    const periodos = snap.docs.map((d) => {
      const p = d.data();
      return {
        id: d.id,
        phase: p.phase ?? null,
        startedAt: p.startedAt?.toDate ? p.startedAt.toDate().toISOString() : null,
        endedAt: p.endedAt?.toDate ? p.endedAt.toDate().toISOString() : null,
        reason: typeof p.reason === "string" ? p.reason : null,
      };
    });

    return json(200, { total: periodos.length, periodos });
  } catch (e: any) {
    const msg = e?.message ?? "erro desconhecido";
    return json(500, { erro: "Não foi possível ler o histórico de fases agora — " + msg });
  }
};
