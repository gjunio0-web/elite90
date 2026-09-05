// ELITE90 PRO · criar-conta-profissional
// Netlify Function: primeira entrega do Bloco 1 da Fase 4-C do plano de
// persistência do M2 — decisões AC-01 e AC-02 do Adendo 07.
//
// Cria a CONTA DE AUTENTICAÇÃO de um profissional JÁ CADASTRADO em
// `professionals/{professionalId}`, e atribui a reivindicação customizada que
// dá acesso à tela restrita.
//
// O QUE ESTA FUNÇÃO NÃO FAZ, DELIBERADAMENTE
//
// Não cadastra. O cadastro é `cadastrar-profissional.ts`, e é ele quem valida a
// carga, guarda a unicidade do endereço e registra `profissional.cadastrado`.
// Aqui o cadastro é premissa, não produto: sem documento, não há conta.
//
// Não reemite `profissional.cadastrado`. Registra `profissional.acesso-concedido`
// (AC-11), que é ação própria porque o ato é próprio: o Coach pode cadastrar hoje
// quem só começa a trabalhar no mês seguinte. Reemitir a ação de cadastro poria
// dois nascimentos no histórico de uma pessoa só.
//
// Não grava `detalhe` no evento. Ausente, não `{}`. O alvo já identifica o
// profissional, e a única informação que um `detalhe` guardaria — se a conta era
// nova ou reaproveitada — descreveria um estado perigoso que a recusa da AC-14
// torna impossível. Guarda que impede, não campo que documenta.
//
// Não define senha utilizável. Mesmo arranjo de promote-lead.ts: senha aleatória
// e descartada. O acesso é entregue pelo fluxo de redefinição do próprio
// Firebase, fora desta função.
//
// Não escreve nada em `professionals/{professionalId}`. O elo de volta, do
// cadastro para a conta, é o endereço de correio, que já é único por guarda
// transacional do cadastro. Acrescentar aqui um campo com o identificador da
// conta criaria segunda fonte para a mesma relação, e nenhum documento a pede.
//
// Não revoga. A revogação é da desativação (AC-12), em função própria.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { CLASSIFICATIONS, type Classification } from "./_m2-validacao";

const COLECAO = "professionals";

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Autenticação antes de ler o corpo, no padrão das demais funções da fase:
  // requisição sem token não merece nem o custo de analisar o JSON.
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let ator: Ator & { tipo: "humano" };
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    // Só o Coach concede acesso a profissional (AC-02). `professional: true` no
    // token de quem chama não basta — um profissional não se promove nem promove
    // um colega. Não existe autocadastro nem autoconcessão.
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

  const professionalId =
    typeof corpo.professionalId === "string" ? corpo.professionalId.trim() : "";
  if (!professionalId) {
    return json(400, { erro: "professionalId ausente." });
  }

  const db = getFirestore(app);
  const snap = await db.collection(COLECAO).doc(professionalId).get();
  if (!snap.exists) {
    return json(404, { erro: "Profissional não encontrado." });
  }
  const prof = snap.data() ?? {};

  // Profissional desativado não ganha via de acesso. A desativação (AD-13) é o
  // ato pelo qual o Coach retira alguém de operação; criar conta logo depois
  // devolveria em silêncio o que a desativação tirou.
  if (prof.active !== true) {
    return json(409, { erro: "Profissional desativado. Reative o cadastro antes de criar o acesso." });
  }

  const email = typeof prof.email === "string" ? prof.email.trim().toLowerCase() : "";
  if (!email) {
    return json(409, { erro: "Cadastro sem endereço de correio." });
  }

  // `classification` vem do CADASTRO, nunca do corpo da requisição: o corpo é do
  // navegador, e aceitar de lá o valor que decide nível de projeção (D-04) e se
  // o delegado vê nome ou rótulo do atleta (D-14) deixaria quem chama escolher
  // o próprio escopo de leitura.
  const classification = prof.classification as Classification;
  if (!CLASSIFICATIONS.includes(classification)) {
    return json(409, { erro: "Cadastro com classification inválida." });
  }

  const auth = getAuth(app);

  let uid: string;
  let contaCriada = false;
  try {
    uid = (await auth.getUserByEmail(email)).uid;
  } catch {
    const criada = await auth.createUser({
      email,
      emailVerified: false,
      displayName: String(prof.name ?? "").trim() || undefined,
      // Senha aleatória e descartada, como em promote-lead.ts. O primeiro acesso
      // é definido pelo fluxo de redefinição do Firebase; até lá, o Coach envia
      // o convite por fora.
      password: `E90-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
    });
    uid = criada.uid;
    contaCriada = true;
  }

  const claimsAtuais = (await auth.getUser(uid)).customClaims ?? {};

  // AC-14 · A combinação de papéis é RECUSADA. Esta é a razão pela qual a conta
  // é localizada pelo endereço antes de qualquer atribuição: um profissional que
  // também seja atleta do programa — hipótese nada remota entre os internos —
  // terminaria com `athlete: true` e `professional: true` no mesmo token, e o
  // redirecionamento de três ramos da AC-03 não prevê a combinação. Essa pessoa
  // iria para a tela restrita e ficaria sem caminho para o próprio
  // acompanhamento. O profissional que também for atleta usa CONTA SEPARADA.
  //
  // Recusa distinta da de cadastro inativo, logo acima, e da de conta já
  // vinculada, logo abaixo. Três recusas, três razões, nenhuma substitui outra.
  if (claimsAtuais.athlete === true) {
    return json(409, {
      erro:
        "Esta conta já é de um atleta do programa. O profissional que também for " +
        "atleta precisa de uma conta separada, com outro endereço de e-mail.",
      reason: "combinacao-de-papeis",
    });
  }

  // Guarda de conta já vinculada. Simétrica à guarda de colisão de e-mail do
  // cadastro: aquela pergunta "este endereço já é de outro profissional?"; esta
  // pergunta "esta CONTA já responde por outro cadastro?". Sem ela, reapontar a
  // reivindicação trocaria em silêncio o cadastro que a pessoa representa, e
  // todas as atribuições de carteira do vínculo anterior deixariam de aparecer
  // para ela sem que nada falhasse.
  const vinculoAtual = claimsAtuais.professionalId;
  if (typeof vinculoAtual === "string" && vinculoAtual !== professionalId) {
    return json(409, {
      erro: "Esta conta já está vinculada a outro cadastro profissional.",
      reason: "conta-ja-vinculada",
    });
  }

  // Preserva as reivindicações existentes — a conta pode acumular papéis. É o
  // mesmo padrão de promote-lead.ts (Adendo 07, F-2), sem desvio: substituir o
  // objeto inteiro apagaria `admin` de quem o tenha. Depois da recusa acima,
  // `athlete` já não está entre os papéis possíveis aqui.
  await auth.setCustomUserClaims(uid, {
    ...claimsAtuais,
    professional: true,
    professionalId,
    classification,
  });

  // AC-11 · `profissional.acesso-concedido`, alvo no cadastro, ator `admin`,
  // SEM `detalhe`. Gravado nos dois caminhos — conta criada e conta reaproveitada
  // —, porque o ato registrado é a concessão, não a criação (CA-45).
  await registrar({
    acao: "profissional.acesso-concedido",
    ator,
    origem: "criar-conta-profissional",
    alvo: { colecao: COLECAO, id: professionalId } as Alvo,
    _test: process.env.CONTEXT !== "production",
  });

  // A reivindicação só chega ao navegador em token novo. Quem já estiver
  // autenticado precisa de `getIdTokenResult(true)` ou de entrar de novo — é a
  // mesma condição que a CA-38 descreve para a mudança de `classification`.
  //
  // E ela é CACHE, não verdade (AC-13): quem for autorizar este profissional
  // adiante confere `professionals/{professionalId}.active` no documento, e não
  // o token.
  return json(200, { ok: true, uid, contaCriada });
};
