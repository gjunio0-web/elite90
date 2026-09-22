// ELITE90 PRO - salvar-decisoes-coach
// Netlify Function: grava as respostas do Coach Fernando às duas decisões
// pendentes da Fase 5 (rubrica de 25 critérios; desfecho favorável por fase).
//
// DELIBERADAMENTE SEM AUTENTICAÇÃO — o Coach Fernando não tem, e não vai
// ter, conta no sistema. É o mesmo padrão de segurança que submit-lead.ts já
// usa para o público em geral: função aberta, escrita restrita a um único
// documento fixo, sem leitura nem escrita de qualquer outra coleção.
//
// ARTEFATO TEMPORÁRIO — existe só para esta consulta pontual à Fase 5.
// Ver docs/DECISOES-COACH-COMO-EXCLUIR.md para o plano de remoção completo,
// desta função, da função de leitura, da página, e do documento no Firestore.

import { getDb } from "./_firebase";
import { FieldValue } from "firebase-admin/firestore";

const COLECAO = "coachDecisions";
const DOCUMENTO = "rubrica-fase5";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

export const handler = async (event: any): Promise<{ statusCode: number; body: string }> => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let corpo: any;
  try {
    corpo = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { erro: "JSON inválido." });
  }

  // Validação estrutural mínima — recusa qualquer coisa fora do formato
  // esperado, sem tentar ser flexível. Não há usuário autenticado para
  // confiar; a validação é a única guarda.
  const { itens, novas, fases } = corpo;
  if (itens !== undefined && (typeof itens !== "object" || itens === null || Array.isArray(itens))) {
    return json(400, { erro: "itens precisa ser um objeto." });
  }
  if (novas !== undefined && !Array.isArray(novas)) {
    return json(400, { erro: "novas precisa ser uma lista." });
  }
  if (fases !== undefined && (typeof fases !== "object" || fases === null || Array.isArray(fases))) {
    return json(400, { erro: "fases precisa ser um objeto." });
  }

  try {
    const db = getDb();
    await db.collection(COLECAO).doc(DOCUMENTO).set({
      itens: itens || {},
      novas: novas || [],
      fases: fases || {},
      atualizadoEm: FieldValue.serverTimestamp(),
    });

    return json(200, { ok: true });
  } catch (e: any) {
    return json(500, { erro: "Falha ao salvar.", detalhe: e?.message });
  }
};
