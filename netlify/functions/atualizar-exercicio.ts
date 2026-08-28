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
// OPERAÇÕES
// `criar`, `editar`, `revisar`, `desrevisar`, `revisar-lote`, `desrevisar-lote`,
// `arquivar` e `desarquivar`. A operação `excluir` do rascunho inicial do
// contrato NÃO existe e não deve ser adicionada: a decisão 14 a removeu porque
// arquivar cobre o caso e é reversível.
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
// Nada aqui regenera arquivo nem dispara publicação diretamente — consequência
// da opção C (25/08/2026, generalizada em scripts/gerar-base.mjs): todo build
// já lê o Firestore direto, com o arquivo commitado como reserva quando o banco
// não responde. Isso resolveu a metade "atualizar o arquivo" da decisão 11 da
// especificação: a função não precisa escrever no repositório, porque qualquer
// build já busca o estado atual sozinho.
//
// A metade que sobrava — algo precisa CAUSAR um build depois de uma revisão
// pura, sem código mudando junto — foi fechada em 26/08/2026: toda operação
// que grava de verdade chama marcarPendente("exercicios") (ver _publicacao.ts).
// Quem lê esse carimbo e decide a hora certa de publicar é
// publicar-bases-pendentes.ts, Netlify Scheduled Function, no mesmo padrão de
// purge-rejected-leads. O acúmulo da decisão 12 vive lá, não aqui: cada
// chamada só AVANÇA o carimbo, e é a função agendada que decide se já passou
// tempo suficiente desde o último avanço para valer a pena publicar.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { CAMPOS_EDITAVEIS, validarCampos, validarNovo, dobraBusca, GRUPOS, EQUIPAMENTOS } from "./_vocabulario-exercicios";
import { marcarPendente } from "./_publicacao";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";

const COLECAO = "exercises";
const ORIGEM = "atualizar-exercicio";

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
async function revisarLote(corpo: Record<string, any>, ator: Ator & { tipo: "humano" }, marcar: boolean) {
  const uid = ator.uid;
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

  await marcarPendente("exercicios");
  // UM evento por lote, não um por item: um lote de 96 itens vira 96 linhas
  // idênticas numa lista de consulta e a torna inútil no dia seguinte. O
  // conjunto exato continua reconstituível por `detalhe.filtro`. Acima de 50
  // alvos o módulo trunca o array e preserva a contagem real em `alvosTotal`.
  await registrar({
    acao: marcar ? "catalogo.revisar-lote" : "catalogo.desrevisar-lote",
    ator,
    origem: ORIGEM,
    alvos: alvos.map((d): Alvo => ({ colecao: COLECAO, id: d.id })),
    detalhe: { filtro, aplicados: alvos.length },
  });
  return json(200, {
    ok: true,
    operacao: marcar ? "revisar-lote" : "desrevisar-lote",
    [marcar ? "revisados" : "desrevisados"]: alvos.length,
  });
}

/**
 * Cadastro de exercício que o acervo externo não tem — agachamento búlgaro,
 * abdução de quadril, elevação de quadril bem classificada (spec 5.5).
 *
 * PROCEDÊNCIA É ESCRITA AQUI, NUNCA RECEBIDA
 * origem.fonte, criadoPor e os carimbos não saem do corpo da requisição: são o
 * registro de onde o documento veio, e um registro que a própria requisição
 * pode ditar não registra nada. Vem do token o uid, e do servidor a hora.
 *
 * POR QUE PODE NASCER JÁ REVISADO
 * A especificação separa editar de atestar porque "corrigir uma vírgula não é
 * atestar que o exercício está pronto" (5.3) — e está certa para edição. Na
 * criação o texto inteiro é do Coach, e obrigá-lo a procurar na fila o que
 * acabou de escrever seria pedir que ele revisasse a si mesmo. Ainda assim a
 * escolha fica com ele, nos mesmos dois botões da edição: quem cria um rascunho
 * para conferir depois usa `criar` puro e o exercício entra aguardando.
 *
 * DUPLICATA
 * Nome repetido não quebra gravação nenhuma — e é exatamente por isso que
 * precisa de barreira aqui. Dois "Agachamento Búlgaro" no catálogo aparecem
 * lado a lado no buscador do construtor, indistinguíveis, e o Coach escolhe um
 * ao acaso; meses depois o histórico do atleta está partido entre os dois. A
 * comparação usa a mesma dobra da busca: acento e caixa não fazem exercício
 * diferente.
 */
async function criar(corpo: Record<string, any>, ator: Ator & { tipo: "humano" }) {
  const uid = ator.uid;
  const campos = corpo.campos;
  if (!campos || typeof campos !== "object" || Array.isArray(campos)) {
    return json(400, { erro: "campos obrigatório para 'criar'." });
  }

  const erros = validarNovo(campos);
  if (erros.length) return json(422, { erro: "Campos inválidos.", detalhes: erros });

  const db = getFirestore();
  const alvo = dobraBusca(campos.nome_pt);
  const snap = await db.collection(COLECAO).get();
  const igual = snap.docs.find((d) => dobraBusca((d.data() as Record<string, any>).nome_pt) === alvo);
  if (igual) {
    const d = igual.data() as Record<string, any>;
    return json(409, {
      erro: "Já existe um exercício com esse nome.",
      detalhe: `"${d.nome_pt}" (${d.grupo} · ${d.equipamento})${d.ativo === false ? " — está arquivado; desarquive em vez de criar outro." : ""}`,
      exerciseId: igual.id,
    });
  }

  const revisar = corpo.revisar === true;
  const agora = FieldValue.serverTimestamp();

  const documento: Record<string, any> = {
    nome_pt: String(campos.nome_pt).trim(),
    // Sem nome de origem: não veio de acervo nenhum. O campo existe para a
    // busca em inglês e para o bloco de procedência, e mentir um valor aqui
    // faria o exercício parecer importado.
    nome_en: null,
    instrucao_pt: String(campos.instrucao_pt).trim(),
    instrucao_en: campos.instrucao_en ?? null,
    grupo: campos.grupo,
    musculoPrimario: campos.musculoPrimario,
    musculosSecundarios: campos.musculosSecundarios ?? [],
    equipamento: campos.equipamento,
    mecanica: campos.mecanica ?? null,
    nivel: campos.nivel,
    // Falso, e não copiado do corpo: a marca significa "a classificação veio da
    // base de origem e merece um olhar". Aqui a classificação é do Coach.
    revisarMusculo: false,
    publicado: true,
    ativo: true,
    origem: { fonte: "curadoria-coach", idOrigem: null },
    revisadoPor: revisar ? uid : null,
    revisadoEm: revisar ? agora : null,
    criadoPor: uid,
    criadoEm: agora,
    atualizadoPor: uid,
    atualizadoEm: agora,
  };

  const ref = await db.collection(COLECAO).add(documento);
  await marcarPendente("exercicios");
  await registrar({
    acao: "catalogo.criar",
    ator,
    origem: ORIGEM,
    alvo: { colecao: COLECAO, id: ref.id },
    detalhe: { revisadoNaCriacao: revisar },
  });
  return json(201, { ok: true, operacao: "criar", exerciseId: ref.id, revisado: revisar });
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
  let ator: Ator & { tipo: "humano" };
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    // O uid real é o ponto da tela existir. Até aqui, revisão era carimbada em
    // bloco por script, com o sentinela 'coach:aprovacao-lote-NN', porque não
    // havia sessão autenticada do Coach em nenhum ponto do fluxo.
    uid = decoded.uid;
    // O e-mail é gravado NO MOMENTO do evento, e não resolvido na leitura
    // (DR-09): sem ele o histórico identificaria quem agiu por um uid opaco, e
    // ler exigiria consultar o console do Firebase item a item. Gravar agora
    // preserva a identificação ainda que a conta seja renomeada ou removida.
    ator = { tipo: "humano", uid: decoded.uid, email: decoded.email ?? null, papel: "admin" };
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

  // As que não trabalham sobre um documento existente saem antes da exigência
  // de exerciseId: criar ainda não tem id, e as de lote resolvem o conjunto
  // pelo filtro.
  if (operacao === "criar") return criar(corpo, ator);
  if (operacao === "revisar-lote") return revisarLote(corpo, ator, true);
  if (operacao === "desrevisar-lote") return revisarLote(corpo, ator, false);

  const SOBRE_UM = ["editar", "revisar", "desrevisar", "arquivar", "desarquivar"];
  if (!SOBRE_UM.includes(operacao)) {
    return json(400, { erro: `Operação não reconhecida: ${String(operacao)}. Aceitas: 'criar', 'editar', 'revisar', 'desrevisar', 'arquivar', 'desarquivar', 'revisar-lote', 'desrevisar-lote'.` });
  }
  if (!exerciseId || typeof exerciseId !== "string") {
    return json(400, { erro: "exerciseId obrigatório." });
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
      await marcarPendente("exercicios");
      // Apenas os NOMES dos campos alterados. Gravar os valores colocaria
      // conteúdo do documento dentro do evento, que DR-04 proíbe.
      await registrar({
        acao: "catalogo.editar",
        ator,
        origem: ORIGEM,
        alvo: { colecao: COLECAO, id: exerciseId },
        detalhe: { campos: chaves },
      });

      return json(200, {
        ok: true,
        operacao: "editar",
        exerciseId,
        alterados: chaves,
        revisado: Boolean(doc.data()?.revisadoPor),
      });
    }

    // ── Arquivar e desarquivar ──
    // `ativo: false` tira o exercício do seletor de planos novos e o mantém
    // resolvendo o nome nos planos antigos (spec 5.4). O par inverso não está
    // na tabela da seção 7, mas a decisão 14 dispensou a exclusão definitiva
    // JUSTAMENTE por arquivar ser reversível — sem desarquivar, o argumento
    // que dispensou a exclusão não se sustentaria.
    //
    // Revisão e arquivamento são eixos independentes de propósito: arquivar um
    // exercício revisado e depois desarquivá-lo devolve o registro de quem o
    // aprovou intacto, porque revisadoPor nunca foi tocado. Fossem o mesmo
    // eixo, guardar um exercício por uma temporada custaria a autoria da
    // aprovação.
    if (operacao === "arquivar" || operacao === "desarquivar") {
      const arquivando = operacao === "arquivar";
      const d = doc.data() ?? {};
      const jaEstavaArquivado = d.ativo === false;
      if (jaEstavaArquivado === arquivando) {
        return json(200, { ok: true, operacao, exerciseId, jaEstava: true });
      }
      await ref.update({ ativo: !arquivando, atualizadoPor: uid, atualizadoEm: agora });
      await marcarPendente("exercicios");
      // Depois da saída por `jaEstava`: sem gravação não há evento. Registrar um
      // ato que não alterou nada encheria o histórico de ruído.
      await registrar({
        acao: arquivando ? "catalogo.arquivar" : "catalogo.desarquivar",
        ator,
        origem: ORIGEM,
        alvo: { colecao: COLECAO, id: exerciseId },
      });
      return json(200, { ok: true, operacao, exerciseId, ativo: !arquivando });
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
      await marcarPendente("exercicios");
      // O evento de `catalogo.revisar` anterior PERMANECE na coleção — é
      // exatamente o que o campo revisadoPor perde ao ser zerado acima, e a
      // razão de esta coleção existir.
      await registrar({
        acao: "catalogo.desrevisar",
        ator,
        origem: ORIGEM,
        alvo: { colecao: COLECAO, id: exerciseId },
        detalhe: { de: "revisado", para: "aguardando" },
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
    await marcarPendente("exercicios");
    // Depois da saída idempotente por `jaEstavaRevisado`: repetir a revisão não
    // grava nada, logo não gera evento.
    await registrar({
      acao: "catalogo.revisar",
      ator,
      origem: ORIGEM,
      alvo: { colecao: COLECAO, id: exerciseId },
      detalhe: { de: "aguardando", para: "revisado" },
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
