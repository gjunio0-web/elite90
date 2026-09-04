// ELITE90 PRO · encerrar-carteira
// Netlify Function: encerra um vínculo de carteira SEM abrir outro em seu
// lugar. Cobre a parte de UC-DEL-07 em que o profissional sai sem substituto
// imediato, e UC-DEL-08 (encerramento de ciclo do atleta).
//
// Grava em `assignments/{assignmentId}` (Adendo 02, seção 4.2), tocando
// apenas `endedAt`, `endedReason` e `endedBy` — CA-09: "Encerrar uma
// atribuição preenche `endedAt` e `endedReason` e NÃO ALTERA nenhum outro
// campo."
//
// POR QUE ESTA FUNÇÃO NÃO ACEITA `endedReason: "replaced"`
// "replaced" descreve um vínculo encerrado PORQUE outro foi aberto no lugar,
// na mesma transação — é o que atribuir-carteira.ts faz internamente ao
// detectar substituição (UC-DEL-02, A2). Aceitar "replaced" aqui permitiria
// encerrar um vínculo alegando substituição sem que substituição alguma
// tenha ocorrido, quebrando a garantia que o motivo existe para dar: que
// todo "replaced" tem, em algum lugar da rastreabilidade, um
// `carteira.atribuida` correspondente, criado na mesma operação atômica
// (AD-14). Esta função aceita apenas `professional_exit` e `cycle_closed`.
//
// O QUE ESTA FUNÇÃO NÃO FAZ
// Não desativa o cadastro do profissional. São atos independentes: a saída
// do profissional pode fechar várias carteiras (uma chamada por vínculo) e a
// desativação do cadastro é decisão à parte, com sua própria função. O
// encadeamento entre os dois — se desativar deveria encerrar tudo
// automaticamente — é pergunta em aberto, registrada no cabeçalho de
// desativar-profissional.ts, e não respondida aqui.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { validarIdDocumento, validarMotivoEncerramento } from "./_m2-validacao";

const COLECAO = "assignments";

/** Motivos aceitos por ESTA função. "replaced" é reservado a atribuir-carteira.ts. */
const MOTIVOS_ACEITOS = ["professional_exit", "cycle_closed"] as const;

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

class NaoEncontrado extends Error {}
class JaEncerrado extends Error {}

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
    ator = {
      tipo: "humano",
      uid: decoded.uid,
      email: decoded.email ?? null,
      papel: "admin",
    };
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo inválido." });
  }

  const { assignmentId, endedReason } = corpo;

  const idValido = validarIdDocumento(assignmentId, "assignmentId");
  if (!idValido.ok) return json(400, { erro: idValido.erro });

  const motivoValido = validarMotivoEncerramento(endedReason);
  if (!motivoValido.ok) return json(400, { erro: motivoValido.erro });

  if (!(MOTIVOS_ACEITOS as readonly string[]).includes(endedReason)) {
    return json(400, {
      erro:
        "endedReason 'replaced' só é gravado por atribuir-carteira.ts, " +
        "como parte de uma substituição. Use professional_exit ou cycle_closed.",
    });
  }

  const db = getFirestore(app);
  const ref = db.collection(COLECAO).doc(String(assignmentId));
  const emHomologacao = process.env.CONTEXT !== "production";

  try {
    await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      if (!atual.exists) throw new NaoEncontrado();
      if (atual.get("endedAt") !== null) throw new JaEncerrado();

      // CA-09: só estes três campos, nada além.
      tx.update(ref, {
        endedAt: FieldValue.serverTimestamp(),
        endedReason,
        endedBy: { uid: ator.uid, email: ator.email },
      });
    });
  } catch (e) {
    if (e instanceof NaoEncontrado) {
      return json(404, { erro: "Atribuição de carteira não encontrada." });
    }
    if (e instanceof JaEncerrado) {
      return json(409, { erro: "Esta atribuição já está encerrada." });
    }
    console.error("[encerrar-carteira] falha ao gravar:", e);
    return json(500, { erro: "Não foi possível encerrar a atribuição." });
  }

  await registrar({
    acao: "carteira.encerrada",
    ator,
    origem: "encerrar-carteira",
    alvo: { colecao: COLECAO, id: ref.id } as Alvo,
    detalhe: { endedReason },
    _test: emHomologacao,
  });

  return json(200, { ok: true, assignmentId: ref.id, endedReason });
};
