// ELITE90 PRO · atualizar-alimento
// Netlify Function: escrita da coleção foods/ a partir da tela de curadoria.
//
// Segurança: requer Firebase ID token com custom claim admin:true, mesmo
// padrão de atualizar-exercicio.ts, que este arquivo espelha — "espelhe, não
// redesenhe" (repasse "tela de revisão da base de alimentos", 26/08/2026).
//
// POR QUE A ESCRITA NÃO PARTE DO NAVEGADOR
// Mesmo motivo de atualizar-exercicio.ts: o firestore.rules nega escrita
// direta em foods/, e "autenticado" não é "autorizado" — a autorização real é
// o claim admin, conferido aqui pelo Admin SDK, que ignora as regras por ser
// servidor.
//
// OPERAÇÕES: `criar`, `editar`, `revisar`, `desrevisar`, `revisar-lote`,
// `desrevisar-lote`, `arquivar`, `desarquivar` — as oito da especificação,
// completas com este arquivo (passos 2, 4, 7 e 9 da ordem de execução).
//
// A DIFERENÇA REAL EM RELAÇÃO A atualizar-exercicio.ts
// validarCampos aqui recebe a fonte do documento (ver _vocabulario-alimentos.ts):
// macros só é gravável em item de curadoria própria. Antes de `criar` existir,
// todo documento tinha fonte === FONTE_TACO e editar macros era sempre
// recusado; agora um item criado pela tela tem fonte 'curadoria' e pode ter
// seus macros corrigidos depois, com a mesma checagem de coerência calórica
// que a criação exige.
//
// PASSO 8 — POR QUE 'revisar' RECUSA ITEM SEM MACROS COMPLETOS
// A especificação (4.4) diz que estes itens "não são revisáveis" e que "a
// tela não deve oferecer um botão que não muda nada". A tela de fato não
// oferece — mas a garantia real precisa estar aqui: sem a recusa do servidor,
// a regra vira só um costume da interface, e uma chamada direta (ou uma tela
// futura que esqueça o filtro) marcaria como revisado um alimento que nunca
// vai aparecer na busca mesmo assim, porque publicado:false é quem barra a
// busca, não revisadoPor. A mesma exclusão entra no filtro de revisar-lote,
// pela razão simétrica: aprovar uma categoria inteira não deve tentar aprovar
// silenciosamente os itens dela que não têm macros.
//
// nomeBusca É RECALCULADO AQUI, NÃO SÓ POR scripts/carregar-alimentos.mjs
// Editar nomeExibicao sem atualizar nomeBusca deixaria o catálogo publicado
// (que lê nomeBusca do documento, sem recalcular) buscando pelo nome antigo.
// Ver normalizarNomeBusca em _vocabulario-alimentos.ts.
//
// SOBRE A CHEGADA AO PORTAL
// Mesmo mecanismo de exercícios: nada aqui regenera arquivo nem publica
// diretamente. Todo build já lê o Firestore direto (opção C, generalizada em
// scripts/gerar-base.mjs), e toda gravação real chama
// marcarPendente("alimentos") — a mesma função genérica que exercícios usa,
// como o próprio cabeçalho de _publicacao.ts já antecipava.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import {
  CAMPOS_EDITAVEIS, validarCampos, validarNovo, normalizarNomeBusca, dobraBusca,
  categoriaValida, FONTE_CURADORIA,
} from "./_vocabulario-alimentos";
import { marcarPendente } from "./_publicacao";

const COLECAO = "foods";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

const LOTE_MAX_POR_GRAVACAO = 400;

/**
 * Revisão em bloco por categoria (passo 4) — mesma razão de existir do par em
 * exercícios: 582 itens não se revisam um a um. O servidor refaz o filtro a
 * partir de `filtro` e exige `esperados` bater com o que a tela prometeu —
 * ver o comentário longo de revisarLote em atualizar-exercicio.ts, que
 * explica os dois porquês (não confiar numa lista de ids da tela; não
 * aprovar em silêncio um conjunto que mudou entre carregar e clicar).
 *
 * Exclui publicado:false dos alvos, nas duas direções — ver o cabeçalho do
 * arquivo sobre o passo 8.
 */
async function revisarLote(corpo: Record<string, any>, uid: string, marcar: boolean) {
  const filtro = corpo.filtro ?? {};
  const esperados = Number(corpo.esperados);
  if (!Number.isInteger(esperados) || esperados < 1) {
    return json(400, { erro: "esperados deve ser um inteiro positivo — é o número que a tela prometeu ao Coach." });
  }
  if (filtro.categoria && !categoriaValida(filtro.categoria)) {
    return json(400, { erro: `categoria fora do vocabulário: ${String(filtro.categoria)}` });
  }

  const db = getFirestore();
  const snap = await db.collection(COLECAO).get();
  const busca = dobraBusca(filtro.busca).trim();

  const alvos = snap.docs.filter((d) => {
    const x = d.data() as Record<string, any>;
    if (x.ativo === false) return false;
    if (x.publicado === false) return false; // passo 8: nunca alvo de revisão em bloco
    if (marcar ? Boolean(x.revisadoPor) : !x.revisadoPor) return false;
    if (filtro.categoria && x.categoria !== filtro.categoria) return false;
    if (busca && !dobraBusca(x.nomeExibicao).includes(busca) && !dobraBusca(x.nome).includes(busca)) return false;
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

  await marcarPendente("alimentos");
  return json(200, {
    ok: true,
    operacao: marcar ? "revisar-lote" : "desrevisar-lote",
    [marcar ? "revisados" : "desrevisados"]: alvos.length,
  });
}

/**
 * Cadastro de item que a TACO não cobre — industrializado de marca: whey,
 * barra de proteína, iogurte com nome comercial (spec 6, passo 9).
 *
 * PROCEDÊNCIA É ESCRITA AQUI, NUNCA RECEBIDA — mesma razão de criar() em
 * atualizar-exercicio.ts: fonte, criadoPor e os carimbos não saem do corpo.
 *
 * NASCE SEMPRE publicado:true — ao contrário de exercício, que pode nascer
 * "aguardando" sem bloquear nada, aqui não existe o equivalente ao item sem
 * macros completos: a validação de coerência calórica já barrou antes de
 * chegar aqui, então o item criado sempre tem os quatro macros bons.
 *
 * DUPLICATA — mesma razão de exercícios, adaptada ao motivo da seção 6: nome
 * repetido não quebra a gravação, mas cria duplicata silenciosa de item já
 * existente na TACO (ou de outro item de curadoria), e o Coach escolheria um
 * dos dois ao acaso no construtor nutricional.
 */
async function criar(corpo: Record<string, any>, uid: string) {
  const campos = corpo.campos;
  if (!campos || typeof campos !== "object" || Array.isArray(campos)) {
    return json(400, { erro: "campos obrigatório para 'criar'." });
  }

  const erros = validarNovo(campos);
  if (erros.length) return json(422, { erro: "Campos inválidos.", detalhes: erros });

  const db = getFirestore();
  const alvo = dobraBusca(campos.nomeExibicao);
  const snap = await db.collection(COLECAO).get();
  const igual = snap.docs.find((d) => dobraBusca((d.data() as Record<string, any>).nomeExibicao) === alvo);
  if (igual) {
    const d = igual.data() as Record<string, any>;
    return json(409, {
      erro: "Já existe um alimento com esse nome.",
      detalhe: `"${d.nomeExibicao}" (${d.categoria})${d.ativo === false ? " — está arquivado; desarquive em vez de criar outro." : ""}`,
      foodId: igual.id,
    });
  }

  const revisar = corpo.revisar === true;
  const agora = FieldValue.serverTimestamp();
  const nomeExibicao = String(campos.nomeExibicao).trim();

  const documento: Record<string, any> = {
    // Sem nome de origem: não veio da TACO. O campo existe para a busca pelo
    // nome oficial e para o bloco de procedência — mentir um valor aqui faria
    // o item parecer importado quando não é.
    nome: null,
    nomeExibicao,
    nomeBusca: normalizarNomeBusca(nomeExibicao),
    categoria: campos.categoria,
    base: "por100g",
    // Sem tabela bruta de nutrientes: essa granularidade é da planilha da
    // TACO, e o Coach só declara os quatro macros. macrosFaltando não se
    // aplica a item de curadoria — ele só nasce com macros completos.
    nutrientes: null,
    macros: campos.macros,
    macrosTemTraco: false,
    medidaCaseira: campos.medidaCaseira ?? null,
    publicado: true,
    ativo: true,
    fonte: FONTE_CURADORIA,
    revisadoPor: revisar ? uid : null,
    revisadoEm: revisar ? agora : null,
    criadoPor: uid,
    criadoEm: agora,
    atualizadoPor: uid,
    atualizadoEm: agora,
  };

  const ref = await db.collection(COLECAO).add(documento);
  await marcarPendente("alimentos");
  return json(201, { ok: true, operacao: "criar", foodId: ref.id, revisado: revisar });
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Autenticação antes de qualquer leitura do corpo — mesma razão do
  // cabeçalho de atualizar-exercicio.ts.
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };

  let uid: string;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
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

  const { operacao, foodId, campos } = corpo;

  // As que não trabalham sobre um documento existente saem antes da exigência
  // de foodId — mesma ordem de atualizar-exercicio.ts.
  if (operacao === "criar") return criar(corpo, uid);
  if (operacao === "revisar-lote") return revisarLote(corpo, uid, true);
  if (operacao === "desrevisar-lote") return revisarLote(corpo, uid, false);

  const SOBRE_UM = ["editar", "revisar", "desrevisar", "arquivar", "desarquivar"];
  if (!SOBRE_UM.includes(operacao)) {
    return json(400, { erro: `Operação não reconhecida: ${String(operacao)}. Aceitas: 'criar', 'editar', 'revisar', 'desrevisar', 'arquivar', 'desarquivar', 'revisar-lote', 'desrevisar-lote'.` });
  }
  if (!foodId || typeof foodId !== "string") {
    return json(400, { erro: "foodId obrigatório." });
  }

  try {
    const db = getFirestore();
    const ref = db.collection(COLECAO).doc(foodId);
    const doc = await ref.get();
    if (!doc.exists) return json(404, { erro: "Alimento não encontrado." });

    const dados = doc.data() ?? {};
    const agora = FieldValue.serverTimestamp();

    if (operacao === "editar") {
      if (!campos || typeof campos !== "object" || Array.isArray(campos)) {
        return json(400, { erro: "campos obrigatório para 'editar'." });
      }
      const chaves = Object.keys(campos);
      if (chaves.length === 0) return json(400, { erro: "Nenhum campo para alterar." });

      // Validação de servidor — a tela também valida, mas isso é conveniência.
      // Ver o cabeçalho de _vocabulario-alimentos.ts sobre por que a fonte do
      // documento entra na validação.
      const erros = validarCampos(campos, String(dados.fonte ?? ""));
      if (erros.length) return json(422, { erro: "Campos inválidos.", detalhes: erros });

      const patch: Record<string, any> = {
        atualizadoPor: uid,
        atualizadoEm: agora,
      };
      for (const c of chaves) patch[c] = campos[c];
      if ("nomeExibicao" in patch) patch.nomeBusca = normalizarNomeBusca(patch.nomeExibicao);

      // Editar NÃO aprova — mesma separação de atos de exercícios: corrigir
      // uma medida caseira não é atestar que o alimento está pronto para o
      // atleta. revisadoPor/revisadoEm não são tocados aqui.
      await ref.update(patch);
      await marcarPendente("alimentos");

      return json(200, {
        ok: true,
        operacao: "editar",
        foodId,
        alterados: chaves,
        revisado: Boolean(dados.revisadoPor),
      });
    }

    // ── Arquivar e desarquivar (passo 7) ──
    // ativo:false tira o alimento do seletor de planos novos e o mantém
    // resolvendo o nome nos planos antigos — mesmo padrão de exercícios. Aqui
    // o motivo prático é outro (spec 6): os 15 sem macros completos, e as
    // duplicatas que vão surgir quando produto de marca entrar ao lado de
    // item da TACO. Revisão e arquivamento são eixos independentes: arquivar
    // não toca revisadoPor, e desarquivar devolve o registro intacto.
    if (operacao === "arquivar" || operacao === "desarquivar") {
      const arquivando = operacao === "arquivar";
      const jaEstavaArquivado = dados.ativo === false;
      if (jaEstavaArquivado === arquivando) {
        return json(200, { ok: true, operacao, foodId, jaEstava: true });
      }
      await ref.update({ ativo: !arquivando, atualizadoPor: uid, atualizadoEm: agora });
      await marcarPendente("alimentos");
      return json(200, { ok: true, operacao, foodId, ativo: !arquivando });
    }

    if (operacao === "desrevisar") {
      if (!dados.revisadoPor) {
        return json(200, { ok: true, operacao: "desrevisar", foodId, jaEstavaPendente: true });
      }
      await ref.update({
        revisadoPor: null,
        revisadoEm: null,
        atualizadoPor: uid,
        atualizadoEm: agora,
      });
      await marcarPendente("alimentos");
      return json(200, { ok: true, operacao: "desrevisar", foodId, revisadoPorAnterior: dados.revisadoPor });
    }

    // operacao === "revisar"
    // Passo 8: publicado:false é quem barra a busca, não revisadoPor — marcar
    // como revisado um item sem macros completos não mudaria nada além do
    // registro, e a especificação (4.4) diz explicitamente que estes itens
    // não são revisáveis. Ver o cabeçalho do arquivo.
    if (dados.publicado === false) {
      return json(422, {
        erro: "Este alimento não tem os quatro macronutrientes completos e não é revisável.",
        detalhe: "publicado:false é o que o mantém fora da busca — revisar não mudaria isso. Complete os macros (item de curadoria) ou aguarde nova análise da TACO.",
      });
    }
    if (dados.revisadoPor) {
      // Idempotente e explícito: repetir a revisão não reescreve quem revisou
      // nem quando. Devolve 200 para que a tela não trate reenvio como erro.
      return json(200, {
        ok: true,
        operacao: "revisar",
        foodId,
        jaEstavaRevisado: true,
        revisadoPor: dados.revisadoPor,
      });
    }

    await ref.update({
      revisadoPor: uid,
      revisadoEm: agora,
      atualizadoPor: uid,
      atualizadoEm: agora,
    });
    await marcarPendente("alimentos");

    return json(200, { ok: true, operacao: "revisar", foodId, revisadoPor: uid });
  } catch (e: any) {
    console.error("[atualizar-alimento]", e?.stack ?? e);
    return json(500, { erro: "Falha ao gravar o alimento." });
  }
};

// Reexportado para a tela montar o formulário a partir da mesma lista que o
// servidor aceita, em vez de manter a sua própria.
export { CAMPOS_EDITAVEIS };
