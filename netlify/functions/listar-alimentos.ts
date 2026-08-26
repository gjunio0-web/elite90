// ELITE90 PRO · listar-alimentos
// Netlify Function: leitura da coleção foods/ para a tela de curadoria.
//
// Segurança: requer Firebase ID token com custom claim admin:true, no mesmo
// padrão de listar-exercicios.ts, que este arquivo espelha.
//
// POR QUE ESTA FUNÇÃO EXISTE — e por que a tela NÃO lê o arquivo estático
// Mesmo motivo de listar-exercicios.ts: o arquivo publicado
// (apps/site/public/dados/alimentos.json) passa pelo portão de contexto de
// filtrar-bases.mjs, que em PRODUÇÃO só emite os alimentos já revisados. Hoje
// são zero dos 582. A tela de curadoria existe para revisar exatamente o que
// falta — precisa do complemento do que o arquivo oferece, não do arquivo.
//
// SOBRE FILTRAR EM MEMÓRIA
// A coleção tem 582 documentos e é lida inteira a cada requisição — mesma
// escolha de listar-exercicios.ts, pelo mesmo motivo: a 582 documentos o custo
// é uma leitura pequena, e busca por trecho de nome não é filtro de igualdade.
// Se a base passar de alguns milhares, ver o comentário equivalente lá.
//
// ESCOPO DESTA RODADA (passo 1 de 10 da especificação)
// Os quatro estados aqui são os três de sempre — aguardando, revisados,
// arquivados — mais 'todos'. O quarto filtro da especificação ("sem macros
// completos", seção 4.4) é o passo 8, deliberadamente não incluído agora: os
// 15 itens sem os quatro macros aparecem hoje dentro de 'aguardando', sem
// distinção. Não é regressão — é a ordem de execução decidida no repasse.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { CATEGORIAS, categoriaValida, dobraBusca } from "./_vocabulario-alimentos";

const COLECAO = "foods";
const POR_PAGINA_PADRAO = 25;
const POR_PAGINA_MAX = 200;

const ESTADOS = ["aguardando", "revisados", "arquivados", "todos"] as const;
type Estado = (typeof ESTADOS)[number];

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

const dobra = dobraBusca;

/** Item do catálogo como esta função o devolve. */
export type ItemCatalogo = {
  nomeExibicao: string; nome: string; categoria: string;
  ativo: boolean; revisado: boolean; [k: string]: unknown;
};

/**
 * Recorta a coleção conforme filtros e página. Pura de propósito, mesmo
 * motivo de filtrarEPaginar em listar-exercicios.ts: é a lógica que decide o
 * que o Coach vê, e testá-la não deve exigir Firestore nem token.
 */
export function filtrarEPaginar<T extends ItemCatalogo>(
  todos: T[],
  o: { estado: Estado; categoria?: string; busca?: string; pagina: number; porPagina: number },
) {
  let itens = todos;
  if (o.estado === "arquivados") itens = itens.filter((a) => !a.ativo);
  else if (o.estado === "aguardando") itens = itens.filter((a) => a.ativo && !a.revisado);
  else if (o.estado === "revisados") itens = itens.filter((a) => a.ativo && a.revisado);
  else itens = itens.filter((a) => a.ativo); // "todos" = todos os ATIVOS

  if (o.categoria) itens = itens.filter((a) => a.categoria === o.categoria);

  const busca = dobra(o.busca).trim();
  if (busca) {
    // nome (o nome de origem da TACO) além de nomeExibicao: se o Coach já
    // renomeou um item, buscar pelo nome oficial ainda precisa achá-lo.
    itens = itens.filter((a) => dobra(a.nomeExibicao).includes(busca) || dobra(a.nome).includes(busca));
  }

  itens = [...itens].sort((a, b) => String(a.nomeExibicao).localeCompare(String(b.nomeExibicao), "pt-BR"));

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
  if (corpo.categoria && !categoriaValida(corpo.categoria)) {
    return json(400, { erro: `categoria fora do vocabulário: ${String(corpo.categoria)}` });
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
        nomeExibicao: x.nomeExibicao,
        nome: x.nome,
        categoria: x.categoria,
        macros: x.macros ?? null,
        medidaCaseira: x.medidaCaseira ?? null,
        publicado: x.publicado === true,
        ativo: x.ativo !== false,
        revisado: Boolean(x.revisadoPor),
        fonte: x.fonte ?? null,
        // Procedência — bloco somente leitura do painel de edição (spec 4.3).
        origem: {
          numeroAlimento: x.origem?.numeroAlimento ?? null,
          aba: x.origem?.aba ?? null,
          linha: x.origem?.linha ?? null,
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

    // Contadores sobre a coleção inteira, não sobre a página nem sobre o
    // filtro — o "582 · X revisados · Y aguardando" do topo da tela não pode
    // mudar quando o Coach filtra por categoria.
    const ativos = todos.filter((a) => a.ativo);
    const contadores = {
      total: todos.length,
      revisados: ativos.filter((a) => a.revisado).length,
      aguardando: ativos.filter((a) => !a.revisado).length,
      arquivados: todos.filter((a) => !a.ativo).length,
    };

    const recorte = filtrarEPaginar(todos, { estado, categoria: corpo.categoria, busca, pagina, porPagina });

    return json(200, { ok: true, ...recorte, contadores, categorias: CATEGORIAS });
  } catch (e: any) {
    console.error("[listar-alimentos]", e?.stack ?? e);
    return json(500, { erro: "Falha ao ler o catálogo." });
  }
};
