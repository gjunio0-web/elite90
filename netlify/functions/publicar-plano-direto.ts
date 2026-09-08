// ELITE90 PRO · publicar-plano-direto
// Netlify Function: AC-25 do Adendo 07 — a publicação direta do Coach, entrando
// na Fase 4-C por causa do achado F-25.
//
// O QUE O ACHADO F-25 REVELOU
//
// `doPublish`, em atletas.astro, altera um objeto em memória —
// `p.status = 'publicado'` sobre o retorno de `getPlanRef(kind)` — que some ao
// recarregar a página. Nenhuma função grava `trainingPlan` nem `nutritionPlan`
// no documento do atleta, e a página pública, que lê justamente esse campo,
// respondia "Nada publicado ainda" para todo atleta, sempre. O botão confirmava
// ao Coach uma publicação que não acontecia — a mesma falha que a AC-24 evita do
// lado do profissional, agora do lado de quem publica.
//
// POR QUE FUNÇÃO PRÓPRIA, E NÃO A MESMA DE `aprovar-sugestao.ts`
//
// As duas terminam no mesmo lugar — uma versão em `versions/{vNNN}` —, mas
// partem de origens diferentes: uma sugestão em revisão, ou o plano que o Coach
// está editando agora, sem sugestão nenhuma envolvida. Fundir as duas faria a
// guarda de estado de uma sugestão (`pending`) valer sobre um caminho que não
// tem sugestão, ou faria este caminho aceitar `suggestionId` que não faz
// sentido para ele.
//
// `originatedBy` NULO — a seção 5.2 do Adendo 02 já prevê o nulo para plano
// produzido pelo próprio Coach. Não é ausência de dado: é o valor correto
// quando não há profissional autor.
//
// A NUMERAÇÃO REPETE O PADRÃO DA AC-06: sequencial, lida e escrita na mesma
// transação, pela mesma razão — duas publicações simultâneas no mesmo plano não
// podem gerar o mesmo número.
//
// O CONGELAMENTO MIGRA PARA CÁ, COMO O COMENTÁRIO DE AGOSTO MANDAVA
//
// `nteCongelarItem`, no núcleo, grava `congeladoEm: null` e
// `_congeladoNoCliente` com o relógio do NAVEGADOR, exatamente porque não havia
// persistência para lhe dar um carimbo confiável. Agora há. O retrato definitivo
// — `congeladoEm` pelo relógio do SERVIDOR — é produzido aqui, e é este que entra
// em `versions/{vNNN}.content`. O campo do cliente nunca alcança o banco.

// POR QUE `sanearUndefined` EXISTE (INCIDENTE F-27)
//
// `content` chega direto do estado em memória do cliente — `wkePlanCache` ou
// `ntePlanCache` —, sem ter passado por validação de forma. O Firestore recusa
// em tempo de execução qualquer campo com valor `undefined`, e um objeto de
// edição construído incrementalmente no navegador é candidato natural a ter
// algum. A primeira versão desta função não saneava e não protegia a
// transação com try/catch: a exceção subia sem tratamento, o runtime do
// Netlify devolvia 502 com corpo genérico, e o cliente via "falha ao gravar"
// sem nenhum diagnóstico. Corrigido nesta revisão — ver também `aprovar-
// sugestao.ts`, que tinha a mesma lacuna parcial.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { validarUid, validarPlanType } from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";

const idDaVersao = (n: number) => "v" + String(n).padStart(3, "0");

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

/**
 * Congela um item de refeição para o retrato definitivo do servidor.
 *
 * Espelha `nteCongelarItem` do núcleo, campo a campo, com uma única troca: o
 * carimbo de tempo. O núcleo grava `congeladoEm: null` e
 * `_congeladoNoCliente` porque, do lado do cliente, não existe relógio de
 * confiança. Aqui existe — é o próprio Firestore.
 */
function congelarItemNoServidor(f: any): Record<string, unknown> {
  const b = f?.base ?? {};
  return {
    foodId: f?.foodId ?? b.id ?? null,
    quantidadeG: f?.qty ?? null,
    nomeSnapshot: f?.name ?? null,
    medidaCaseiraSnapshot: b.medidaCaseira ?? null,
    macrosSnapshot: {
      kcal: b.kcal || 0,
      p: b.p || 0,
      c: b.c || 0,
      g: b.g || 0,
    },
    fonteSnapshot: b.categoria ? { base: "foods", categoria: b.categoria } : { base: "foods" },
    congeladoEm: FieldValue.serverTimestamp(),
  };
}

/**
 * Congela um plano nutricional inteiro. Muda em relação a `nteCongelarPlano` do
 * núcleo só no que o núcleo não pode fazer: usar o relógio do servidor.
 *
 * Devolve um plano NOVO em vez de alterar `plano` no lugar — o objeto recebido
 * é o corpo da requisição, e mutar entrada não é hábito desta função.
 */
function congelarPlanoNutricional(plano: any): Record<string, unknown> {
  const dias: Record<string, unknown> = {};
  for (const dk of Object.keys(plano?.days ?? {})) {
    const dia = plano.days[dk];
    dias[dk] = {
      ...dia,
      meals: (dia.meals ?? []).map((meal: any) => ({
        ...meal,
        foods: (meal.foods ?? []).map((f: any) => ({
          ...f,
          snapshot: congelarItemNoServidor(f),
        })),
      })),
    };
  }
  return { ...plano, days: dias };
}

/**
 * Remove recursivamente qualquer chave cujo valor seja `undefined`, de mapas
 * e de arrays. O Firestore lança em tempo de execução ao encontrar
 * `undefined` em qualquer profundidade — não há como pedir para ele ignorar.
 *
 * Não usa `JSON.parse(JSON.stringify(...))` porque isso destruiria os
 * `FieldValue` que o próprio código insere depois (`serverTimestamp()`, que
 * não é dado plano e não sobrevive a uma volta por JSON). Percorre a
 * estrutura à mão, preservando qualquer objeto que não seja mapa nem array.
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
    // Só o Coach publica direto. Mesma guarda de `aprovar-sugestao.ts`.
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    ator = {
      tipo: "humano",
      uid: decoded.uid,
      email: decoded.email ?? null,
      papel: "admin",
    };
    // publishedBy do TOKEN, nunca de cadastro — mesma razão da AC-06 (CA-63):
    // o Coach não tem cadastro equivalente ao do profissional, e nome lido de
    // registro mutável faria a autoria histórica mudar junto com ele.
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

  const vUid = validarUid(corpo.athleteUid);
  if (!vUid.ok) return json(400, { erro: vUid.erro });
  const vTipo = validarPlanType(corpo.planType);
  if (!vTipo.ok) return json(400, { erro: vTipo.erro });

  const athleteUid: string = corpo.athleteUid;
  const planType: string = corpo.planType;

  if (corpo.content === null || typeof corpo.content !== "object" || Array.isArray(corpo.content)) {
    return json(400, { erro: "content precisa ser um mapa." });
  }

  let athleteSnap;
  try {
    athleteSnap = await getFirestore(app).collection(COLECAO_ATLETAS).doc(athleteUid).get();
  } catch (e) {
    console.error("[publicar-plano-direto] falha ao ler atleta:", e);
    return json(500, { erro: "Não foi possível verificar o atleta agora." });
  }
  if (!athleteSnap.exists) return json(404, { erro: "Atleta não encontrado." });

  // O congelamento acontece ANTES da transação: é cálculo puro sobre o corpo da
  // requisição, sem leitura de banco, e não precisa competir pela janela da
  // transação com a numeração da versão. `sanearUndefined` roda por último —
  // ver o cabeçalho do arquivo, F-27.
  const conteudoCongelado = sanearUndefined(
    planType === "nutrition" ? congelarPlanoNutricional(corpo.content) : corpo.content,
  );

  const db = getFirestore(app);
  const refPlano = db
    .collection(COLECAO_ATLETAS).doc(athleteUid)
    .collection("plans").doc(planType);

  let versaoCriada = 0;

  // PROTEGIDA (F-27). Antes desta correção, esta chamada não tinha try/catch
  // nenhum: uma exceção do Firestore subia sem tratamento até o runtime do
  // Netlify, que devolvia 502 com corpo genérico, sem o `erro` estruturado que
  // todo o resto desta função produz. O padrão abaixo é o mesmo de
  // `desativar-profissional.ts` e `atribuir-carteira.ts`: qualquer exceção não
  // prevista vira log e uma resposta 500 com corpo que o cliente sabe ler.
  try {
    await db.runTransaction(async (tx) => {
      // Mesma técnica da AC-06: número lido e escrito no mesmo passo, pela ordem
      // lexical dos identificadores de três dígitos.
      const ultima = await tx.get(
        refPlano.collection("versions").orderBy("__name__", "desc").limit(1),
      );
      const anterior = ultima.empty ? 0 : Number(String(ultima.docs[0].id).replace(/^v/, "")) || 0;
      versaoCriada = anterior + 1;

      const refVersao = refPlano.collection("versions").doc(idDaVersao(versaoCriada));

      tx.set(refVersao, {
        content: conteudoCongelado,
        // Nulo: não há profissional autor. A seção 5.2 do Adendo 02 prevê este
        // valor para plano produzido pelo próprio Coach.
        originatedBy: null,
        publishedBy,
        publishedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    console.error("[publicar-plano-direto] falha ao gravar versão:", e);
    return json(500, { erro: "Não foi possível publicar agora. Tente novamente." });
  }

  // Evento fora da transação, como em `aprovar-sugestao.ts`: falhar no registro
  // de auditoria não pode desfazer uma publicação que já aconteceu.
  //
  // MESMA AÇÃO de `aprovar-sugestao.ts` — a reserva em `_rastreabilidade.ts`
  // já a atribuía a este uso (AC-25), embora à Fase 5. `alvo` aponta para o
  // ATLETA, e não para uma sugestão: não há sugestão neste caminho.
  await registrar({
    acao: "plano.publicado",
    ator,
    origem: "publicar-plano-direto",
    alvo: { colecao: COLECAO_ATLETAS, id: athleteUid } as Alvo,
    _test: process.env.CONTEXT !== "production",
  });

  return json(200, { ok: true, version: versaoCriada, versionId: idDaVersao(versaoCriada) });
};
