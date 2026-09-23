// ELITE90 PRO - ler-decisoes-coach
// Netlify Function: devolve o estado atual das respostas do Coach Fernando.
// Mesmo par de decisões de ausência de autenticação que salvar-decisoes-coach.ts —
// ver o comentário lá para a justificativa completa.
//
// ARTEFATO TEMPORÁRIO — ver docs/DECISOES-COACH-COMO-EXCLUIR.md.

import { getDb } from "./_firebase";

const COLECAO = "coachDecisions";
const DOCUMENTO = "rubrica-fase5";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

export const handler = async (event: any): Promise<{ statusCode: number; body: string }> => {
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const db = getDb();
    const snap = await db.collection(COLECAO).doc(DOCUMENTO).get();

    if (!snap.exists) {
      return json(200, { itens: {}, novas: [], fases: {}, pendencias: {}, assistente: {} });
    }

    const dados = snap.data() || {};
    return json(200, {
      itens: dados.itens || {},
      novas: dados.novas || [],
      fases: dados.fases || {},
      pendencias: dados.pendencias || {},
      assistente: dados.assistente || {},
    });
  } catch (e: any) {
    return json(500, { erro: "Falha ao ler.", detalhe: e?.message });
  }
};
