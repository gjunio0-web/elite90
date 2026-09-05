// ELITE90 PRO · listar-atletas-do-profissional
// Netlify Function: primeira entrega do passo 2 da AC-16 — a tela restrita.
// Adendo 07, AC-04, AC-13; Adendo 02, AD-06, seções 6.2 e 6.3.
//
// A PRIMEIRA FUNÇÃO DO PROJETO QUE SERVE A UM PROFISSIONAL, e não ao Coach.
// Por isso é aqui que a AC-13 e a CA-47 deixam de ser decisão e passam a ser
// código verificável.
//
// POR QUE ESTA FUNÇÃO PRECISA EXISTIR — a leitura não pode ser do cliente
//
//   grep -n "match /assignments" firestore.rules → allow read, write: if false
//   grep -n "match /athletes"    firestore.rules → allow read: if isAdmin()
//
// A rota restrita não alcança nem as atribuições nem os atletas pelo navegador.
// Isso não é obstáculo contornado: é a AD-06 em vigor. Nenhuma leitura de dado
// de atleta pelo delegado é direta.
//
// TRÊS GUARDAS, EM ORDEM, E NENHUMA SUBSTITUI A OUTRA
//
//   1. Token com `professional: true`               → senão 403 (CA-31)
//   2. `professionals/{id}.active === true` NO DOCUMENTO → senão 403 (AC-13, CA-47)
//   3. Só os atletas com atribuição ativa para ESTE profissional (CA-32)
//
// A segunda é a que importa entender. A reivindicação é CACHE: um token emitido
// antes da desativação continua válido até expirar, e a revogação da AC-12
// derruba as sessões mas não invalida o token já emitido. Confiar no token aqui
// deixaria um profissional desativado lendo a carteira dele por mais uma hora.
//
// SEM EVENTO DE RASTREABILIDADE
// Leitura não é fato que a rastreabilidade exista para preservar — só os atos
// que alteram estado geram evento (Adendo 02, seção 7.3).

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { conferirProfissionalAtivo } from "./_profissional-ativo";
import { nivelPara, projetarAtleta, type AtletaProjetado } from "./_projecao-atleta";

const COLECAO_PROFISSIONAIS = "professionals";
const COLECAO_ATRIBUICOES = "assignments";
const COLECAO_ATLETAS = "athletes";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

/**
 * Um atleta da carteira, como esta função o devolve.
 *
 * `specialties` aqui é o conjunto das especialidades com atribuição ATIVA
 * naquele atleta — não o conjunto do cadastro do profissional. É o que a CA-44
 * exige: um profissional de dupla especialidade vê, para cada atleta,
 * exatamente as abas para as quais tenha atribuição ativa NAQUELE atleta.
 */
type AtletaDaCarteira = {
  atleta: AtletaProjetado;
  specialties: string[];
};

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let professionalId: string;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);

    // Guarda 1 (CA-31). `professional` é lido como SINALIZADOR BOOLEANO. A
    // especialidade não está no token (AC-01) e não seria usada aqui de qualquer
    // forma: quem decide a aba é a atribuição, atleta por atleta (CA-43).
    if (decoded.professional !== true) {
      return json(403, { erro: "Acesso não autorizado.", reason: "sem-papel-profissional" });
    }
    if (typeof decoded.professionalId !== "string" || !decoded.professionalId) {
      // Token com o papel e sem o vínculo é token malformado, não caso de uso.
      return json(403, { erro: "Acesso não autorizado.", reason: "vinculo-ausente" });
    }
    professionalId = decoded.professionalId;
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  const db = getFirestore(app);

  // Guarda 2 (AC-13, CA-47). O cadastro é a verdade; o token é cache.
  const profSnap = await db.collection(COLECAO_PROFISSIONAIS).doc(professionalId).get();
  const verdicto = conferirProfissionalAtivo(profSnap);
  if (!verdicto.ok) {
    // Mesma resposta para inexistente e para inativo: quem porta token revogado
    // não precisa saber em qual dos dois estados o cadastro dele está.
    return json(403, { erro: "Acesso não autorizado.", reason: verdicto.reason });
  }

  // O nível de projeção vem da CLASSIFICAÇÃO DO CADASTRO, e não da reivindicação
  // homônima do token. São o mesmo valor enquanto a AC-08 mantiver os dois em
  // dia, e o documento é o que manda quando divergirem.
  const nivel = nivelPara(verdicto.dados.classification);

  // Guarda 3 (CA-32). Índice já existente: assignments[professionalId, endedAt].
  const atribuicoes = await db
    .collection(COLECAO_ATRIBUICOES)
    .where("professionalId", "==", professionalId)
    .where("endedAt", "==", null)
    .get();

  // Agrupa por atleta: um profissional de dupla especialidade pode ter DUAS
  // atribuições ativas para o mesmo atleta, e o atleta aparece uma vez só, com
  // as duas especialidades (CA-44).
  const porAtleta = new Map<string, Set<string>>();
  for (const doc of atribuicoes.docs) {
    const d = doc.data();
    const uid = typeof d.athleteUid === "string" ? d.athleteUid : "";
    const specialty = typeof d.specialty === "string" ? d.specialty : "";
    if (!uid || !specialty) continue;
    if (!porAtleta.has(uid)) porAtleta.set(uid, new Set());
    porAtleta.get(uid)!.add(specialty);
  }

  const uids = [...porAtleta.keys()];
  const atletas: AtletaDaCarteira[] = [];

  if (uids.length > 0) {
    // Leitura em lote pelas referências. `getAll` sem argumentos rejeita, e uma
    // carteira vazia é caso normal — daí a guarda acima.
    const refs = uids.map((uid) => db.collection(COLECAO_ATLETAS).doc(uid));
    const docs = await db.getAll(...refs);

    for (const doc of docs) {
      // Atribuição apontando para atleta que não existe mais é omitida em
      // silêncio: a exclusão de atleta é matéria do Adendo 04, e devolver uma
      // linha vazia na tela seria pior que não devolvê-la.
      if (!doc.exists) continue;
      atletas.push({
        atleta: projetarAtleta(doc.id, doc.data() ?? {}, nivel),
        specialties: [...(porAtleta.get(doc.id) ?? [])].sort(),
      });
    }
  }

  return json(200, { nivel, total: atletas.length, atletas });
};
