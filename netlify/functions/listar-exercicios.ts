// ELITE90 PRO · listar-exercicios
// Netlify Function: leitura da coleção exercises/ para a tela de catálogo.
//
// Segurança: requer Firebase ID token com custom claim admin:true, no mesmo
// padrão de delete-lead.ts e de atualizar-exercicio.ts.
//
// POR QUE ESTA FUNÇÃO EXISTE — e por que a tela NÃO lê o arquivo estático
// A especificação (seção 7) dizia "a tela lê o arquivo estático e escreve pela
// função". Isso não fecha: o arquivo estático passa pelo portão de contexto de
// filtrar-catalogo.mjs, que em PRODUÇÃO emite somente os exercícios já
// revisados. Hoje são zero de 519.
//
// A tela de catálogo existe justamente para revisar o que ainda não foi
// revisado — ou seja, precisa exatamente do complemento do que o arquivo
// oferece em produção. Lendo dali, o Coach abriria a tela no endereço real e
// veria catálogo vazio, sem nada para revisar, para sempre: revisar é o que
// colocaria algo no arquivo.
//
// Publicar um segundo arquivo estático sem filtro resolveria a leitura e abriria
// um buraco maior: arquivo estático não tem controle de acesso, e os nomes não
// validados vazariam em produção — que é precisamente o que o portão impede.
// Daí a leitura por função, autenticada.
//
// O portão do arquivo estático continua exatamente como está. Ele serve ao
// portal e ao construtor de treino; esta função serve à tela de curadoria. São
// públicos diferentes com necessidades opostas, e é correto que leiam de fontes
// diferentes.
//
// SOBRE FILTRAR EM MEMÓRIA
// A coleção tem 519 documentos e é lida inteira a cada requisição. É deliberado:
// combinar busca textual com filtros de igualdade no Firestore exigiria índices
// compostos e ainda assim não faria busca por trecho de nome. A 519 documentos o
// custo é uma leitura pequena; se o catálogo passar de alguns milhares, a
// filtragem deve migrar para a consulta, e este comentário é o aviso.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { GRUPOS, EQUIPAMENTOS } from "./_vocabulario-exercicios";

const COLECAO = "exercises";
const POR_PAGINA_PADRAO = 25;
const POR_PAGINA_MAX = 200;

const ESTADOS = ["aguardando", "revisados", "arquivados", "todos"] as const;
type Estado = (typeof ESTADOS)[number];

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

// Mesma dobra usada na busca do construtor de treino (dobraBusca, em
// atletas.astro): minúsculas E sem acento. Sem isso, "biceps" não encontra
// "Bíceps", e 200 dos 519 nomes têm diacrítico.
const dobra = (texto: unknown) =>
  String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Item do catálogo como esta função o devolve. */
export type ItemCatalogo = {
  nome_pt: string; nome_en: string | null; grupo: string; equipamento: string;
  ativo: boolean; revisado: boolean; [k: string]: unknown;
};

/**
 * Recorta a coleção conforme filtros e página. Pura de propósito: é a lógica
 * que decide o que o Coach vê, e testá-la não deve exigir Firestore nem token.
 *
 * `encontrados` é o tamanho do resultado do FILTRO. Não confundir com os
 * contadores da coleção, que o chamador calcula à parte — misturar os dois faria
 * o cabeçalho da tela mudar de número toda vez que alguém filtrasse por grupo.
 */
export function filtrarEPaginar<T extends ItemCatalogo>(
  todos: T[],
  o: { estado: Estado; grupo?: string; equipamento?: string; busca?: string; pagina: number; porPagina: number },
) {
  let itens = todos;
  if (o.estado === "arquivados") itens = itens.filter((e) => !e.ativo);
  else if (o.estado === "aguardando") itens = itens.filter((e) => e.ativo && !e.revisado);
  else if (o.estado === "revisados") itens = itens.filter((e) => e.ativo && e.revisado);
  else itens = itens.filter((e) => e.ativo); // "todos" = todos os ATIVOS

  if (o.grupo) itens = itens.filter((e) => e.grupo === o.grupo);
  if (o.equipamento) itens = itens.filter((e) => e.equipamento === o.equipamento);

  const busca = dobra(o.busca).trim();
  if (busca) {
    // Busca em português E em inglês: o nome de origem localiza o exercício
    // quando a tradução não é óbvia (spec 5.1).
    itens = itens.filter((e) => dobra(e.nome_pt).includes(busca) || dobra(e.nome_en).includes(busca));
  }

  itens = [...itens].sort((a, b) => String(a.nome_pt).localeCompare(String(b.nome_pt), "pt-BR"));

  const encontrados = itens.length;
  const paginas = Math.max(1, Math.ceil(encontrados / o.porPagina));
  const pagina = Math.min(Math.max(1, o.pagina), paginas);
  const inicio = (pagina - 1) * o.porPagina;

  return { itens: itens.slice(inicio, inicio + o.porPagina), encontrados, pagina, porPagina: o.porPagina, paginas };
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo não é JSON válido." });
  }

  const estado: Estado = corpo.estado ?? "aguardando";
  if (!ESTADOS.includes(estado)) {
    return json(400, { erro: `estado inválido: ${String(corpo.estado)}. Aceitos: ${ESTADOS.join(", ")}.` });
  }
  if (corpo.grupo && !(GRUPOS as readonly string[]).includes(corpo.grupo)) {
    return json(400, { erro: `grupo fora do vocabulário: ${String(corpo.grupo)}` });
  }
  if (corpo.equipamento && !(EQUIPAMENTOS as readonly string[]).includes(corpo.equipamento)) {
    return json(400, { erro: `equipamento fora do vocabulário: ${String(corpo.equipamento)}` });
  }

  const pagina = Math.max(1, Number(corpo.pagina) || 1);
  const porPagina = Math.min(POR_PAGINA_MAX, Math.max(1, Number(corpo.porPagina) || POR_PAGINA_PADRAO));
  const busca = dobra(corpo.busca).trim();

  try {
    const db = getFirestore();
    const snap = await db.collection(COLECAO).get();

    const todos = snap.docs.map((d) => {
      const x = d.data() as Record<string, any>;
      return {
        id: d.id,
        nome_pt: x.nome_pt,
        nome_en: x.nome_en ?? null,
        instrucao_pt: x.instrucao_pt ?? "",
        instrucao_en: x.instrucao_en ?? null,
        grupo: x.grupo,
        musculoPrimario: x.musculoPrimario,
        musculosSecundarios: x.musculosSecundarios ?? [],
        equipamento: x.equipamento,
        mecanica: x.mecanica ?? null,
        nivel: x.nivel ?? null,
        revisarMusculo: x.revisarMusculo === true,
        ativo: x.ativo !== false,
        revisado: Boolean(x.revisadoPor),
        // Procedência — bloco somente leitura do painel de edição (spec 5.3).
        origem: {
          fonte: x.origem?.fonte ?? null,
          idOrigem: x.origem?.idOrigem ?? null,
        },
        criadoPor: x.criadoPor ?? null,
        revisadoPor: x.revisadoPor ?? null,
        // Carimbos viram ISO: Timestamp do Firestore não sobrevive ao JSON de
        // forma legível, e a tela só precisa exibir.
        revisadoEm: x.revisadoEm?.toDate?.()?.toISOString() ?? null,
        atualizadoEm: x.atualizadoEm?.toDate?.()?.toISOString() ?? null,
        atualizadoPor: x.atualizadoPor ?? null,
      };
    });

    // Contadores sobre a coleção inteira, não sobre a página nem sobre o filtro:
    // é o "519 · 96 revisados · 423 aguardando" do topo da tela, e ele não pode
    // mudar quando o Coach filtra por grupo.
    const ativos = todos.filter((e) => e.ativo);
    const contadores = {
      total: todos.length,
      revisados: ativos.filter((e) => e.revisado).length,
      aguardando: ativos.filter((e) => !e.revisado).length,
      arquivados: todos.filter((e) => !e.ativo).length,
    };

    const recorte = filtrarEPaginar(todos, { estado, grupo: corpo.grupo, equipamento: corpo.equipamento, busca, pagina, porPagina });

    return json(200, { ok: true, ...recorte, contadores });
  } catch (e: any) {
    console.error("[listar-exercicios]", e?.stack ?? e);
    return json(500, { erro: "Falha ao ler o catálogo." });
  }
};
