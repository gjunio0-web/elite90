// ELITE90 PRO · aprovar-sugestao
// Netlify Function: AC-06 do Adendo 07 — estrutura mínima de versão publicada e
// função de aprovação. Adendo 02: AD-02, seção 5.2, CA-11, CA-14.
//
// O ATO QUE FECHA O FLUXO DE DELEGAÇÃO. O profissional produz e nunca publica;
// o Coach publica (AD-02 do Adendo 02, D-02 dos casos de uso). Esta função é a
// única passagem de `suggestions/` para `versions/`.
//
// POR QUE `originatedBy` É CÓPIA, E NÃO REFERÊNCIA
//
// O documento de versão é imutável e permanente; o cadastro do profissional pode
// mudar — e a CA-12 do Adendo 02 exige que alterar o número de conselho NÃO
// altere versão já publicada. Referenciar o cadastro faria a autoria histórica
// mudar junto com ele. Copia-se no instante da publicação, e nunca mais se toca.
//
// É a mesma razão da seção 2 daquele adendo: quem produziu cada versão, sob qual
// registro profissional, NÃO É RECONSTITUÍVEL depois do fato — e a rastreabilidade,
// que retém vinte e quatro meses, não serve de prova de autoria.
//
// A NUMERAÇÃO É SEQUENCIAL E VIVE DENTRO DA TRANSAÇÃO
//
// `vNNN` precisa ser lido e escrito no mesmo passo: duas aprovações simultâneas
// no mesmo plano leriam o mesmo último número e uma sobrescreveria a outra.
// A transação do Firestore recusa a segunda, que reexecuta e obtém o número
// seguinte.
//
// UMA OPERAÇÃO ATÔMICA, DOIS DOCUMENTOS
//
// A versão nasce e a sugestão passa a `published` com `resultingVersion` no mesmo
// commit. Se fossem escritas separadas, uma falha entre elas deixaria versão
// publicada com sugestão ainda `pending` — e o Coach aprovaria de novo, criando
// segunda versão do mesmo conteúdo.
//
// O EVENTO É UM SÓ, E SEM `detalhe`
//
// `plano.publicado`, `detalhe: nenhum`. O conteúdo do plano é dado protegido, e a
// versão publicada já tem histórico próprio e permanente. O evento prova que a
// publicação ocorreu, quando e por quem — não o que foi publicado.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { validarIdDocumento } from "./_m2-validacao";

const COLECAO_PROFISSIONAIS = "professionals";
const COLECAO_SUGESTOES = "suggestions";
const COLECAO_ATLETAS = "athletes";

/** `vNNN` — três dígitos, zero à esquerda, para que a ordem lexical seja a ordem numérica. */
const idDaVersao = (n: number) => "v" + String(n).padStart(3, "0");

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

class NaoEncontrada extends Error {}
class EstadoInvalido extends Error {}

/**
 * Remove recursivamente qualquer chave cujo valor seja `undefined`, de mapas
 * e de arrays. O Firestore lança em tempo de execução ao encontrar
 * `undefined` em qualquer profundidade. Aqui `content` vem de
 * `atual.get("content")` — já passou pelo Firestore uma vez, ao ser gravado
 * por `rascunhar-sugestao.ts` ou `submeter-sugestao.ts` —, então o risco é
 * menor que em `publicar-plano-direto.ts`. Mesmo assim, saneia: defesa em
 * profundidade custa pouco e a F-27 mostrou que a suposição "já passou pelo
 * Firestore, então está limpo" não é garantia — o dado pode ter sido
 * modificado por caminho que não passou pela mesma validação.
 */
function sanearUndefined<T>(valor: T): T {
  if (Array.isArray(valor)) {
    return valor.map((v) => sanearUndefined(v)) as unknown as T;
  }
  if (valor !== null && typeof valor === "object" && valor.constructor === Object) {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (v === undefined) continue;
      saida[k] = sanearUndefined(v);
    }
    return saida as T;
  }
  return valor;
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
  let publishedBy: Record<string, unknown>;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    // CA-35 · Só o Coach publica. `professional: true` não abre esta porta —
    // AC-07: o Coach nunca deixa de aprovar.
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    ator = {
      tipo: "humano",
      uid: decoded.uid,
      email: decoded.email ?? null,
      papel: "admin",
    };
    // `publishedBy` conforme a AC-06: { uid, name, role }. O nome vem do token —
    // é quem publicou, e não um cadastro que possa mudar depois.
    publishedBy = {
      uid: decoded.uid,
      name: decoded.name ?? decoded.email ?? null,
      role: "admin",
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

  const vId = validarIdDocumento(corpo.suggestionId, "suggestionId");
  if (!vId.ok) return json(400, { erro: vId.erro });
  const suggestionId = String(corpo.suggestionId);

  const db = getFirestore(app);
  const refSugestao = db.collection(COLECAO_SUGESTOES).doc(suggestionId);

  // Leitura do cadastro FORA da transação: `originatedBy` é retrato do cadastro,
  // e o cadastro não participa da consistência que a transação protege — ela
  // protege a numeração da versão e o par versão/sugestão.
  const sugestaoPrevia = await refSugestao.get();
  if (!sugestaoPrevia.exists) return json(404, { erro: "Sugestão não encontrada." });

  const professionalId = sugestaoPrevia.get("professionalId");
  const planType = sugestaoPrevia.get("planType");
  const athleteUid = sugestaoPrevia.get("athleteUid");
  if (typeof professionalId !== "string" || typeof planType !== "string" || typeof athleteUid !== "string") {
    return json(409, { erro: "Sugestão malformada." });
  }

  const profSnap = await db.collection(COLECAO_PROFISSIONAIS).doc(professionalId).get();
  if (!profSnap.exists) {
    // Cadastro apagado seria falha grave: a AD-13 diz que ele nunca é apagado.
    // Publicar sem autoria produziria versão que a CA-11 reprova.
    return json(409, { erro: "Cadastro do profissional não encontrado.", reason: "sem-cadastro" });
  }
  const prof = profSnap.data() ?? {};

  // O identificador da CONTA do profissional. `originatedBy.uid` é de conta de
  // autenticação (seção 5.2 do Adendo 02), e a sugestão guarda o identificador do
  // CADASTRO — são coisas distintas, e o e-mail é a chave de vínculo entre elas
  // (seção 4.1). Ausência de conta não impede publicar: o profissional pode ter
  // sido cadastrado e ainda não ter recebido acesso, e o trabalho dele existe.
  let uidProfissional: string | null = null;
  try {
    const email = typeof prof.email === "string" ? prof.email.trim().toLowerCase() : "";
    if (email) uidProfissional = (await getAuth(app).getUserByEmail(email)).uid;
  } catch {
    uidProfissional = null;
  }

  // AD-02 e seção 5.2 · cópia no instante, com os oito campos. `role` é
  // `professional` porque é quem produziu; o Substituto, quando existir, publica
  // e não produz (seção 8.1 do Adendo 02).
  const originatedBy = {
    uid: uidProfissional,
    name: prof.name ?? null,
    role: "professional",
    specialty: planType,
    professionalId,
    council: prof.council ?? null,
    councilNumber: prof.councilNumber ?? null,
    councilState: prof.councilState ?? null,
  };

  const refPlano = db
    .collection(COLECAO_ATLETAS).doc(athleteUid)
    .collection("plans").doc(planType);

  let versaoCriada = 0;

  try {
    await db.runTransaction(async (tx) => {
      const atual = await tx.get(refSugestao);
      if (!atual.exists) throw new NaoEncontrada();

      // Só `pending` se aprova. `draft` nunca foi submetida; `returned` está com
      // o profissional; `rejected` e `published` já foram resolvidas — aprovar
      // qualquer uma delas publicaria conteúdo que ninguém pôs em revisão.
      const estado = atual.get("status");
      if (estado !== "pending") throw new EstadoInvalido(String(estado));

      // A numeração, dentro da transação. Lê o maior existente pela ordem
      // lexical, que é a numérica por causa do zero à esquerda.
      const ultima = await tx.get(
        refPlano.collection("versions").orderBy("__name__", "desc").limit(1),
      );
      const anterior = ultima.empty ? 0 : Number(String(ultima.docs[0].id).replace(/^v/, "")) || 0;
      versaoCriada = anterior + 1;

      const refVersao = refPlano.collection("versions").doc(idDaVersao(versaoCriada));

      // A versão. Deliberadamente mínima — a Fase 5 acrescenta `coachNotes` e
      // `formulaSnapshot`, e generaliza sem recriar.
      tx.set(refVersao, {
        content: sanearUndefined(atual.get("content") ?? null),
        originatedBy,
        publishedBy,
        publishedAt: FieldValue.serverTimestamp(),
      });

      // A sugestão resolvida, no MESMO commit.
      tx.update(refSugestao, {
        status: "published",
        resultingVersion: versaoCriada,
        resolvedAt: FieldValue.serverTimestamp(),
        resolvedBy: { uid: ator.uid, email: ator.email },
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    if (e instanceof NaoEncontrada) return json(404, { erro: "Sugestão não encontrada." });
    if (e instanceof EstadoInvalido) {
      return json(409, {
        erro: "Só uma sugestão em revisão pode ser aprovada.",
        reason: "estado-invalido",
      });
    }
    // F-27: antes desta correção, qualquer exceção que não fosse uma das duas
    // acima subia sem log e sem resposta estruturada — `throw e;` relançava
    // para o runtime do Netlify, que devolvia 502 com corpo genérico. Agora
    // vira log e uma resposta 500 que o cliente sabe ler, no mesmo padrão de
    // `desativar-profissional.ts` e `atribuir-carteira.ts`.
    console.error("[aprovar-sugestao] falha ao gravar versão:", e);
    // F-28: `m2Escrever` só lê o campo `erro` — concatenado, mesma correção
    // de publicar-plano-direto.ts.
    const msg = e instanceof Error ? e.message : String(e);
    return json(500, { erro: "Não foi possível aprovar agora — " + msg });
  }

  // Depois da transação, e não dentro dela: escrita de auditoria não participa da
  // atomicidade do ato, e falhar aqui não pode desfazer uma publicação que já
  // aconteceu. `detalhe: nenhum`.
  await registrar({
    acao: "plano.publicado",
    ator,
    origem: "aprovar-sugestao",
    alvo: { colecao: COLECAO_SUGESTOES, id: suggestionId } as Alvo,
    _test: process.env.CONTEXT !== "production",
  });

  return json(200, { ok: true, suggestionId, version: versaoCriada, versionId: idDaVersao(versaoCriada) });
};
