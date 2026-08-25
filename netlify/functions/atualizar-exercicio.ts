// ELITE90 PRO · atualizar-exercicio
// Netlify Function: escrita da coleção exercises/ a partir da tela de catálogo.
//
// Segurança: requer Firebase ID token com custom claim admin:true, no mesmo
// padrão de delete-lead.ts e promote-lead.ts.
//
// POR QUE A ESCRITA NÃO PARTE DO NAVEGADOR
// (Decisão 1 da especificação, 24/08/2026.) O firestore.rules nega escrita
// direta em exercises/, e é assim que deve permanecer: qualquer pessoa consegue
// criar conta neste projeto — o provedor de e-mail/senha está aberto e a chave
// pública está no HTML —, então "autenticado" não é "autorizado". A autorização
// real é o claim admin, e quem o confere aqui é o Admin SDK, que ignora as
// regras por ser servidor.
//
// O QUE ESTA VERSÃO FAZ, E O QUE AINDA NÃO FAZ
// Autenticação, `editar`, `revisar`, `revisar-lote` e os dois desfazeres —
// `desrevisar` e `desrevisar-lote`. Ficam para os passos seguintes `arquivar` e
// `criar`.
//
// POR QUE DESFAZER EXISTE
// A especificação decidiu que exclusão definitiva não existe porque arquivar
// cobre o caso e é reversível. Não tratou da revisão, que ficou sendo o único
// ato definitivo do catálogo — e o mais fácil de errar em massa, já que aprova
// um grupo inteiro de uma vez. Desfazer devolve o exercício a "aguardando" e
// não destrói nada: quem já tem o exerciseId num plano continua resolvendo o
// nome, exatamente como no arquivamento.
//
// O QUE SE PERDE AO DESFAZER: o registro de quem aprovou e quando, naquela
// aprovação. Nada no sistema lê esse histórico — revisadoPor responde "está
// aprovado agora?", não "quem aprovou em março?". Se um dia precisar responder
// a segunda pergunta, isso vira coleção de eventos, não campo.
//
// SOBRE A CHEGADA AO PORTAL
// Nada aqui regenera arquivo nem dispara publicação, e isso é consequência da
// opção C escolhida em 25/08/2026: o build passa a ler o Firestore, com o
// arquivo commitado como reserva quando o banco não responde. Com isso a
// revisão alcança o portal na próxima publicação, seja ela qual for, sem que a
// função precise escrever no repositório nem acumular disparos. O gatilho de
// build com acúmulo continua desejável por prontidão — não por correção — e é
// item próprio.
//
// ENQUANTO A OPÇÃO C NÃO ESTIVER IMPLEMENTADA, o que esta função grava fica no
// banco e não chega ao portal. Ver o item aberto na especificação.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { CAMPOS_EDITAVEIS, validarCampos, dobraBusca, GRUPOS, EQUIPAMENTOS } from "./_vocabulario-exercicios";

const COLECAO = "exercises";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

const LOTE_MAX_POR_GRAVACAO = 400;

/**
 * Revisão em bloco. A peça central da tela: sem ela o Coach clicaria 519 vezes
 * e o catálogo nunca sairia do lugar.
 *
 * POR QUE O SERVIDOR REFAZ O FILTRO, EM VEZ DE RECEBER UMA LISTA DE IDs
 * Receber ids seria mais simples e menos seguro de outra maneira: a tela mostra
 * 25 por página, e a faixa promete aprovar os 68 do grupo — os outros 43 o Coach
 * nunca teve na mão. Ou a tela buscaria todos os ids só para devolvê-los, ou
 * aprovaria menos do que anunciou.
 *
 * E POR QUE ELE EXIGE O NÚMERO ESPERADO
 * Refazer o filtro no servidor tem o risco oposto: entre a tela carregar e o
 * Coach clicar, o conjunto pode ter mudado, e ele aprovaria em silêncio algo que
 * não leu. Por isso a tela manda quantos ela prometeu, e divergência vira recusa
 * com os dois números à vista — não uma aprovação a mais.
 *
 * SEM LIMITE ARTIFICIAL (decisão 13): o maior grupo é Pernas, com 96. A gravação
 * é dividida em blocos de 400 apenas porque é o teto do Firestore, não como
 * política.
 */
async function revisarLote(corpo: Record<string, any>, uid: string, marcar: boolean) {
  const filtro = corpo.filtro ?? {};
  const esperados = Number(corpo.esperados);
  if (!Number.isInteger(esperados) || esperados < 1) {
    return json(400, { erro: "esperados deve ser um inteiro positivo — é o número que a tela prometeu ao Coach." });
  }
  if (filtro.grupo && !(GRUPOS as readonly string[]).includes(filtro.grupo)) {
    return json(400, { erro: `grupo fora do vocabulário: ${String(filtro.grupo)}` });
  }
  if (filtro.equipamento && !(EQUIPAMENTOS as readonly string[]).includes(filtro.equipamento)) {
    return json(400, { erro: `equipamento fora do vocabulário: ${String(filtro.equipamento)}` });
  }

  const db = getFirestore();
  const snap = await db.collection(COLECAO).get();
  const busca = dobraBusca(filtro.busca).trim();

  // Ao marcar, só entra o que está ATIVO e AINDA NÃO revisado — recarimbar quem
  // já foi revisado apagaria quem o revisou. Ao desfazer, o espelho: só o que
  // está revisado. Nos dois casos, arquivado fica de fora.
  const alvos = snap.docs.filter((d) => {
    const x = d.data() as Record<string, any>;
    if (x.ativo === false) return false;
    if (marcar ? Boolean(x.revisadoPor) : !x.revisadoPor) return false;
    if (filtro.grupo && x.grupo !== filtro.grupo) return false;
    if (filtro.equipamento && x.equipamento !== filtro.equipamento) return false;
    if (busca && !dobraBusca(x.nome_pt).includes(busca) && !dobraBusca(x.nome_en).includes(busca)) return false;
    return true;
  });

  if (alvos.length !== esperados) {
    return json(409, {
      erro: "O conjunto mudou desde que a tela carregou.",
      detalhe: `A tela prometeu ${esperados} e o filtro encontra ${alvos.length} agora. Recarregue e confira antes de aprovar.`,
      esperados, encontrados: alvos.length,
    });
  }

  const agora = FieldValue.serverTimestamp();
  for (let i = 0; i < alvos.length; i += LOTE_MAX_POR_GRAVACAO) {
    const bloco = db.batch();
    for (const d of alvos.slice(i, i + LOTE_MAX_POR_GRAVACAO)) {
      bloco.update(d.ref, marcar
        ? { revisadoPor: uid, revisadoEm: agora, atualizadoPor: uid, atualizadoEm: agora }
        : { revisadoPor: null, revisadoEm: null, atualizadoPor: uid, atualizadoEm: agora });
    }
    await bloco.commit();
  }

  return json(200, {
    ok: true,
    operacao: marcar ? "revisar-lote" : "desrevisar-lote",
    [marcar ? "revisados" : "desrevisados"]: alvos.length,
  });
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Autenticação antes de qualquer leitura do corpo: requisição sem token não
  // merece nem o custo de analisar o JSON, e responder de forma diferente para
  // corpo inválido revelaria que o endpoint existe a quem não deveria saber.
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };

  let uid: string;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    // O uid real é o ponto da tela existir. Até aqui, revisão era carimbada em
    // bloco por script, com o sentinela 'coach:aprovacao-lote-NN', porque não
    // havia sessão autenticada do Coach em nenhum ponto do fluxo.
    uid = decoded.uid;
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo não é JSON válido." });
  }

  const { operacao, exerciseId, campos } = corpo;
  if (operacao !== "revisar-lote" && (!exerciseId || typeof exerciseId !== "string")) {
    return json(400, { erro: "exerciseId obrigatório." });
  }
  if (operacao === "revisar-lote") return revisarLote(corpo, uid, true);
  if (operacao === "desrevisar-lote") return revisarLote(corpo, uid, false);
  if (operacao !== "editar" && operacao !== "revisar" && operacao !== "desrevisar") {
    return json(400, { erro: `Operação não reconhecida: ${String(operacao)}. Aceitas: 'editar', 'revisar', 'desrevisar', 'revisar-lote', 'desrevisar-lote'.` });
  }

  try {
    const db = getFirestore();
    const ref = db.collection(COLECAO).doc(exerciseId);
    const doc = await ref.get();
    if (!doc.exists) return json(404, { erro: "Exercício não encontrado." });

    const agora = FieldValue.serverTimestamp();

    if (operacao === "editar") {
      if (!campos || typeof campos !== "object" || Array.isArray(campos)) {
        return json(400, { erro: "campos obrigatório para 'editar'." });
      }
      const chaves = Object.keys(campos);
      if (chaves.length === 0) return json(400, { erro: "Nenhum campo para alterar." });

      // Validação de servidor. A tela também valida, mas isso é conveniência —
      // a garantia é aqui. Ver o cabeçalho de _vocabulario-exercicios.ts.
      const erros = validarCampos(campos);
      if (erros.length) return json(422, { erro: "Campos inválidos.", detalhes: erros });

      const patch: Record<string, any> = {
        atualizadoPor: uid,
        atualizadoEm: agora,
      };
      for (const c of chaves) patch[c] = campos[c];

      // Editar NÃO aprova. Corrigir uma vírgula não é atestar que o exercício
      // está pronto para o atleta — a especificação separa os dois atos de
      // propósito, e por isso revisadoPor/revisadoEm não são tocados aqui.
      await ref.update(patch);

      return json(200, {
        ok: true,
        operacao: "editar",
        exerciseId,
        alterados: chaves,
        revisado: Boolean(doc.data()?.revisadoPor),
      });
    }

    if (operacao === "desrevisar") {
      const d = doc.data() ?? {};
      if (!d.revisadoPor) {
        return json(200, { ok: true, operacao: "desrevisar", exerciseId, jaEstavaPendente: true });
      }
      await ref.update({
        revisadoPor: null,
        revisadoEm: null,
        atualizadoPor: uid,
        atualizadoEm: agora,
      });
      return json(200, { ok: true, operacao: "desrevisar", exerciseId, revisadoPorAnterior: d.revisadoPor });
    }

    // operacao === "revisar"
    const dados = doc.data() ?? {};
    if (dados.revisadoPor) {
      // Idempotente e explícito: repetir a revisão não reescreve quem revisou
      // nem quando. Devolve 200 para que a tela não trate reenvio como erro.
      return json(200, {
        ok: true,
        operacao: "revisar",
        exerciseId,
        jaEstavaRevisado: true,
        revisadoPor: dados.revisadoPor,
      });
    }

    await ref.update({
      revisadoPor: uid,
      revisadoEm: agora,
      atualizadoPor: uid,
      atualizadoEm: agora,
      // revisarMusculo NÃO é limpo aqui, de propósito. A marca diz "a
      // classificação de músculo veio da base de origem e merece um olhar";
      // revisar em bloco um grupo inteiro não é ter olhado músculo por músculo.
      // Limpar a marca junto apagaria em silêncio o único sinal de onde ainda
      // falta conferência. Quem confere, desmarca — pela operação 'editar'.
    });

    return json(200, { ok: true, operacao: "revisar", exerciseId, revisadoPor: uid });
  } catch (e: any) {
    console.error("[atualizar-exercicio]", e?.stack ?? e);
    return json(500, { erro: "Falha ao gravar o exercício." });
  }
};

// Reexportado para a tela montar o formulário a partir da mesma lista que o
// servidor aceita, em vez de manter a sua própria.
export { CAMPOS_EDITAVEIS };
