// ELITE90 PRO · sugestoes-pendentes-do-atleta
// Netlify Function: AC-39 do Adendo 07 v1.42 — o sinal que a gaveta do Coach
// mostra ao lado do selo de publicação, por tipo de plano.
//
// FUNÇÃO SEPARADA DE `listar-sugestoes-pendentes.ts`, PELO MESMO MOTIVO DA
// `contar-sugestoes-pendentes.ts`
//
// Aquela monta o HTML completo de cada sugestão com `renderPlanDocument`, para
// a tela de aprovação. Acender um aviso de uma linha não precisa do conteúdo
// dos planos: traria o documento inteiro de todas as sugestões pendentes do
// sistema a cada abertura de gaveta. Aqui só voltam autor, tipo de plano e
// data (CA-149).
//
// NENHUM ÍNDICE NOVO
//
// A consulta é de IGUALDADE PURA — `status` e `athleteUid` —, servida pelos
// índices de campo único que o Firestore mantém sozinho. Acrescentar
// `orderBy("submittedAt")` exigiria índice composto que não existe em
// `firestore.indexes.json` (há apenas `status+submittedAt` e
// `professionalId+updatedAt`), e índice não publicado derruba a consulta em
// produção — o incidente F-27/F-28 com `versions/`. A ordenação sai em
// memória: são no máximo duas sugestões pendentes por atleta, uma por tipo de
// plano.
//
// SÓ `pending` (CA-150). `returned` é trabalho do profissional, não do Coach,
// e não deve aparecer como pendência dele.
//
// SÓ O COACH. `decoded.admin`, como nas demais funções de aprovação.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { validarUid } from "./_m2-validacao";

const COLECAO_SUGESTOES = "suggestions";
const COLECAO_PROFISSIONAIS = "professionals";

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
      .where("status", "==", "pending")
      .where("athleteUid", "==", corpo.athleteUid)
      .get();

    if (snap.empty) return json(200, { total: 0, sugestoes: [] });

    // `getAll` num round-trip só, deduplicando: o mesmo profissional costuma
    // responder pelos dois tipos de plano do mesmo atleta.
    const ids = [...new Set(snap.docs.map((d) => d.get("professionalId")).filter(Boolean))];
    const profDocs = ids.length
      ? await db.getAll(...ids.map((id) => db.collection(COLECAO_PROFISSIONAIS).doc(id)))
      : [];
    const profissionais = new Map(profDocs.filter((d) => d.exists).map((d) => [d.id, d.data()]));

    const sugestoes = snap.docs
      .map((doc) => {
        const d = doc.data();
        const prof = profissionais.get(d.professionalId);
        return {
          id: doc.id,
          planType: d.planType ?? null,
          professionalName: prof?.name ?? "(profissional não encontrado)",
          submittedAt: d.submittedAt?.toDate ? d.submittedAt.toDate().toISOString() : null,
        };
      })
      // Ordenação em memória, no lugar do `orderBy` que custaria índice novo.
      // Sem data, a sugestão vai para o fim, e não some da lista.
      .sort((a, b) => (a.submittedAt ?? "9999").localeCompare(b.submittedAt ?? "9999"));

    return json(200, { total: sugestoes.length, sugestoes });
  } catch (e: any) {
    const msg = e?.message ?? "erro desconhecido";
    return json(500, { erro: "Não foi possível ler as sugestões pendentes — " + msg });
  }
};
