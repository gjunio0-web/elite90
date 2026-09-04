// ELITE90 PRO · desativar-profissional
// Netlify Function: desativação do cadastro do profissional, Fase 4-B do M2.
//
// Grava `active: false` em `professionals/{professionalId}` e nada mais, e emite
// `profissional.desativado` (Adendo 02, seção 7.3).
//
// POR QUE DESATIVAR NÃO É APAGAR
// AD-13: o cadastro nunca é apagado, porque a autoria histórica das versões
// publicadas aponta para ele. Apagar quebraria a leitura do histórico. Este é o
// oposto do tratamento das demais coleções da delegação, e a distinção alcança o
// item de exclusão em cascata da Fase 8.
//
// O QUE ESTA FUNÇÃO NÃO FAZ, DELIBERADAMENTE
//
// Não reativa. Reativar é edição do campo `active` — e a função de edição, hoje,
// não aceita esse campo, de propósito. A reativação fica apontada como decisão a
// tomar, não implementada por analogia.
//
// Não encerra as atribuições de carteira do profissional. Encerrar é ato próprio,
// com motivo próprio (`professional_exit`), e vem na função de carteira. Fazê-lo
// aqui, por dedução, gravaria eventos que ninguém pediu.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { validarIdDocumento } from "./_m2-validacao";

const COLECAO = "professionals";

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

class NaoEncontrado extends Error {}
class JaInativo extends Error {}

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

  const idValido = validarIdDocumento(corpo.professionalId, "professionalId");
  if (!idValido.ok) return json(400, { erro: idValido.erro });

  const db = getFirestore(app);
  const ref = db.collection(COLECAO).doc(String(corpo.professionalId));
  const emHomologacao = process.env.CONTEXT !== "production";

  try {
    await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      if (!atual.exists) throw new NaoEncontrado();
      // Recusa quando já está inativo: gravar transição que não houve poria no
      // evento um `de: true` falso.
      if (atual.get("active") !== true) throw new JaInativo();

      tx.update(ref, { active: false, updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (e) {
    if (e instanceof NaoEncontrado) {
      return json(404, { erro: "Profissional não encontrado." });
    }
    if (e instanceof JaInativo) {
      return json(409, { erro: "Profissional já está inativo." });
    }
    console.error("[desativar-profissional] falha ao gravar:", e);
    return json(500, { erro: "Não foi possível desativar o profissional." });
  }

  // Forma da transição conforme a correção publicada na versão 1.5 do Adendo 02:
  // o nome do campo em chave própria, e `de`/`para` com os VALORES dos dois lados —
  // que é como as chamadas de atualizar-alimento.ts e atualizar-exercicio.ts já
  // registram transição.
  await registrar({
    acao: "profissional.desativado",
    ator,
    origem: "desativar-profissional",
    alvo: { colecao: COLECAO, id: ref.id } as Alvo,
    detalhe: { campo: "active", de: true, para: false },
    _test: emHomologacao,
  });

  return json(200, { ok: true, professionalId: ref.id, active: false });
};
