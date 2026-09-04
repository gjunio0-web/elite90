// ELITE90 PRO · atualizar-profissional
// Netlify Function: edição do cadastro do profissional, Fase 4-B do M2.
//
// Altera campos de `professionals/{professionalId}` (Adendo 02, seção 4.1) e grava
// o evento `profissional.editado` com os NOMES dos campos alterados — nunca os
// valores (seção 7.3, critérios CA-12 e CA-28).
//
// O QUE ESTA FUNÇÃO NÃO FAZ, DELIBERADAMENTE
//
// Não aceita `active: false`. Desativar tem porta própria, com ação própria de
// rastreabilidade (seção 7.3), e é encontrável pelo nome na auditoria — colapsá-la
// aqui a esconderia entre trocas de telefone.
//
// ACEITA `active: true`, e só nessa direção. A seção 7.2 do adendo determina que a
// reativação É edição do campo `active`, e que um quarto nome de ação duplicaria o
// que `profissional.editado` já cobre. A transição é validada: só é aceita partindo
// de `active: false` no documento atual — reativar quem já está ativo não é
// transição, é no-op, e cai na regra geral de "nada mudou" mais abaixo.
//
// Não grava quando nada muda. Carga que repete os valores atuais devolve sucesso
// sem escrita e sem evento: evento de edição sem edição é ruído na auditoria.
//
// Não apaga. O cadastro nunca é apagado (AD-13).

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { validarProfissional, validarIdDocumento } from "./_m2-validacao";

const COLECAO = "professionals";

/**
 * Campos editáveis. Lista de PERMITIDOS, nunca de proibidos: um campo novo no
 * documento, acrescentado depois, fica de fora até que alguém o inclua aqui de
 * propósito. A lista de proibidos deixaria passar em silêncio.
 */
const CAMPOS_EDITAVEIS = [
  "name",
  "email",
  "phone",
  "council",
  "councilNumber",
  "councilState",
  "classification",
  "specialties",
  "active",
] as const;

type CampoEditavel = (typeof CAMPOS_EDITAVEIS)[number];

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

class NaoEncontrado extends Error {}
class ColisaoEmail extends Error {}

/** Comparação por valor. `specialties` é conjunto: a ordem não é informação. */
function mudou(campo: CampoEditavel, atual: unknown, novo: unknown): boolean {
  if (campo === "specialties") {
    const a = Array.isArray(atual) ? [...(atual as string[])].sort() : [];
    const b = Array.isArray(novo) ? [...(novo as string[])].sort() : [];
    return a.length !== b.length || a.some((v, i) => v !== b[i]);
  }
  return (atual ?? null) !== (novo ?? null);
}

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

  // Chave fora da lista de permitidos é erro, não campo ignorado em silêncio.
  const alteracoes: Partial<Record<CampoEditavel, unknown>> = {};
  for (const chave of Object.keys(corpo)) {
    if (chave === "professionalId") continue;
    if (!CAMPOS_EDITAVEIS.includes(chave as CampoEditavel)) {
      return json(400, { erro: `Campo não editável: ${chave}.` });
    }
    alteracoes[chave as CampoEditavel] = corpo[chave];
  }

  // `active` só entra na direção de reativação (seção 7.2). `false` aqui seria a
  // desativação por outra porta — a mesma coisa duas vezes, com dois eventos
  // possíveis para o mesmo fato. Essa função grava só o sentido que o adendo lhe
  // atribuiu; o outro sentido tem função própria.
  if ("active" in alteracoes && alteracoes.active !== true) {
    return json(400, {
      erro:
        "active só pode ser definido como true nesta função (reativação). " +
        "Para desativar, use a função de desativação.",
    });
  }

  if (Object.keys(alteracoes).length === 0) {
    return json(400, { erro: "Nenhum campo a alterar." });
  }

  // Normalização idêntica à do cadastro, para que a comparação e a guarda de
  // colisão enxerguem o mesmo que se grava.
  if (typeof alteracoes.name === "string") alteracoes.name = alteracoes.name.trim();
  if (typeof alteracoes.email === "string")
    alteracoes.email = alteracoes.email.trim().toLowerCase();
  if (typeof alteracoes.phone === "string")
    alteracoes.phone = alteracoes.phone.trim() || null;
  if (typeof alteracoes.councilNumber === "string")
    alteracoes.councilNumber = alteracoes.councilNumber.trim();
  if (typeof alteracoes.councilState === "string")
    alteracoes.councilState = alteracoes.councilState.trim().toUpperCase() || null;

  const db = getFirestore(app);
  const ref = db.collection(COLECAO).doc(String(corpo.professionalId));
  const emHomologacao = process.env.CONTEXT !== "production";

  let camposAlterados: string[] = [];

  try {
    await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      if (!atual.exists) throw new NaoEncontrado();
      const dados = atual.data() as Record<string, unknown>;

      camposAlterados = (Object.keys(alteracoes) as CampoEditavel[])
        .filter((c) => mudou(c, dados[c], alteracoes[c]))
        .sort();

      if (camposAlterados.length === 0) return;

      // O documento RESULTANTE é validado, não apenas o pedaço enviado: uma carga
      // parcial válida pode produzir documento inválido, e é o documento que fica.
      const resultante = { ...dados, ...alteracoes };
      const v = validarProfissional(resultante);
      if (!v.ok) throw new Error("VALIDACAO:" + v.erro);

      if (camposAlterados.includes("email")) {
        const duplicado = await tx.get(
          db.collection(COLECAO).where("email", "==", alteracoes.email).limit(1),
        );
        // Encontrar o próprio documento não é colisão.
        const outro = duplicado.docs.find((d) => d.id !== ref.id);
        if (outro) throw new ColisaoEmail();
      }

      tx.update(ref, { ...alteracoes, updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (e) {
    if (e instanceof NaoEncontrado) {
      return json(404, { erro: "Profissional não encontrado." });
    }
    if (e instanceof ColisaoEmail) {
      return json(409, { erro: "Já existe profissional cadastrado com este e-mail." });
    }
    if (e instanceof Error && e.message.startsWith("VALIDACAO:")) {
      return json(400, { erro: e.message.slice("VALIDACAO:".length) });
    }
    console.error("[atualizar-profissional] falha ao gravar:", e);
    return json(500, { erro: "Não foi possível atualizar o profissional." });
  }

  if (camposAlterados.length === 0) {
    return json(200, { ok: true, alterado: false, campos: [] });
  }

  // `detalhe` leva apenas os NOMES dos campos, na forma `{ campos: [...] }` que o
  // repositório já pratica. Gravar os valores criaria um terceiro lugar com o mesmo
  // dado, sujeito à retenção de vinte e quatro meses (seção 7.3).
  await registrar({
    acao: "profissional.editado",
    ator,
    origem: "atualizar-profissional",
    alvo: { colecao: COLECAO, id: ref.id } as Alvo,
    detalhe: { campos: camposAlterados },
    _test: emHomologacao,
  });

  return json(200, { ok: true, alterado: true, campos: camposAlterados });
};
