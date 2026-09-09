// ELITE90 PRO · listar-sugestoes-pendentes
// Netlify Function: AC-05 do Adendo 07 — dados da tela de aprovação.
//
// SÓ O COACH. `decoded.admin`, sem exceção — é ele quem aprova, devolve ou
// recusa (AC-07 do Adendo 02: "o Coach nunca deixa de aprovar").
//
// LEITURA DIRETA DO ATLETA, SEM PROJEÇÃO. A AD-06 e a `_projecao-atleta.ts`
// existem para o DELEGADO — quando ele lê dado de terceiro. O Coach é dono do
// dado; a projeção não se aplica a ele, do mesmo jeito que não se aplica em
// `atletas.astro`.
//
// A CONSULTA JÁ TEM ÍNDICE. `status == "pending"` ordenado por `submittedAt`
// é exatamente o par declarado na seção 4.3 do Adendo 02 e em
// `firestore.indexes.json` — nenhum índice novo precisou ser criado aqui,
// ao contrário do incidente F-27/F-28 com `versions/`.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
// Mesmo padrão de cross-import validado na AC-27 (buscar-versao-publicada.ts):
// a function, em Node, importa de apps/site/src/lib livremente — é o cliente
// (navegador) que não pode. O HTML do documento é montado AQUI, no servidor,
// e devolvido pronto: o cliente só o injeta, sem depender de bundler algum
// para resolver o módulo em tempo de execução no navegador.
import { renderPlanDocument, type TrainingPlan, type NutritionPlan } from "../../apps/site/src/lib/plano-documento";

const COLECAO_SUGESTOES = "suggestions";
const COLECAO_ATLETAS = "athletes";
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

  const db = getFirestore(app);
  const snap = await db
    .collection(COLECAO_SUGESTOES)
    .where("status", "==", "pending")
    .orderBy("submittedAt", "asc")
    .get();

  if (snap.empty) {
    return json(200, { total: 0, sugestoes: [] });
  }

  // Junta atleta e profissional de cada sugestão. Sem `Promise.all` ingênuo
  // por documento — `getAll` faz um round-trip só para cada coleção,
  // deduplicando ids repetidos (o mesmo profissional aparece em várias
  // sugestões; o mesmo atleta, raramente mais de uma por especialidade ativa).
  const athleteUids = [...new Set(snap.docs.map((d) => d.get("athleteUid")).filter(Boolean))];
  const professionalIds = [...new Set(snap.docs.map((d) => d.get("professionalId")).filter(Boolean))];

  const [athleteDocs, profDocs] = await Promise.all([
    athleteUids.length
      ? db.getAll(...athleteUids.map((uid) => db.collection(COLECAO_ATLETAS).doc(uid)))
      : Promise.resolve([]),
    professionalIds.length
      ? db.getAll(...professionalIds.map((id) => db.collection(COLECAO_PROFISSIONAIS).doc(id)))
      : Promise.resolve([]),
  ]);

  const atletas = new Map(athleteDocs.filter((d) => d.exists).map((d) => [d.id, d.data()]));
  const profissionais = new Map(profDocs.filter((d) => d.exists).map((d) => [d.id, d.data()]));

  const sugestoes = snap.docs.map((doc) => {
    const d = doc.data();
    const atleta = atletas.get(d.athleteUid);
    const prof = profissionais.get(d.professionalId);
    const nomeAtleta = atleta?.name ?? "(atleta não encontrado)";
    let documentoHtml = "";
    try {
      documentoHtml = renderPlanDocument(
        d.planType,
        nomeAtleta,
        d.content as TrainingPlan | NutritionPlan,
      );
    } catch (e) {
      // Um documento malformado não pode derrubar a lista inteira — a
      // sugestão continua aparecendo, com aviso no lugar do conteúdo, e o
      // Coach ainda consegue recusá-la mesmo sem visualizar.
      console.error("[listar-sugestoes-pendentes] falha ao renderizar", doc.id, e);
      documentoHtml = "<p>Não foi possível exibir o conteúdo desta sugestão.</p>";
    }
    return {
      id: doc.id,
      athleteUid: d.athleteUid,
      athleteName: nomeAtleta,
      planType: d.planType,
      professionalId: d.professionalId,
      professionalName: prof?.name ?? "(profissional não encontrado)",
      documentoHtml,
      basedOnVersion: d.basedOnVersion ?? null,
      submittedAt: d.submittedAt?.toDate ? d.submittedAt.toDate().toISOString() : null,
    };
  });

  return json(200, { total: sugestoes.length, sugestoes });
};
