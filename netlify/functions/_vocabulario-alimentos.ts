// ELITE90 PRO · _vocabulario-alimentos
// Vocabulário fechado da coleção foods/ e a validação que o servidor aplica.
// Importado por atualizar-alimento.ts e listar-alimentos.ts. O prefixo _ impede
// o Netlify de tratar este arquivo como endpoint (mesma convenção de
// _firebase.ts, _mailer.ts e _vocabulario-exercicios.ts, que este módulo espelha).
//
// A DIFERENÇA REAL EM RELAÇÃO A _vocabulario-exercicios.ts
// (Repasse "tela de revisão da base de alimentos", divergência 2, 26/08/2026.)
// Em exercícios, um campo ou é editável ou não é — vale igual para qualquer
// documento. Aqui não: macros só é editável em item de curadoria própria
// (fonte diferente de FONTE_TACO). Editar o macro de um item da TACO quebraria
// a procedência citável — a razão pela qual a TACO foi escolhida na auditoria
// de licenças. Por isso validarCampos recebe também a procedência do
// DOCUMENTO, não só os campos do corpo: a mesma requisição de editar é válida
// para um item e recusada para outro, dependendo de onde ele veio.
//
// DUPLICAÇÃO CONHECIDA, E POR QUE ELA EXISTE HOJE
// FONTE_TACO precisa ser exatamente a string gravada por
// scripts/carregar-alimentos.mjs ('taco-4ed-2011'), e normalizarNomeBusca
// precisa produzir o mesmo valor que a função normalizarBusca de lá. Nenhuma
// função deste projeto importa de fora de netlify/functions/ — mesma fronteira
// registrada no cabeçalho de _vocabulario-exercicios.ts, mesma escolha aqui.
//
// SE VOCÊ ALTERAR FONTE_TACO OU normalizarNomeBusca AQUI, ALTERE TAMBÉM EM
// scripts/carregar-alimentos.mjs. Um valor fora de sincronia faz a próxima
// carga reescrever, em silêncio, o que o Coach acabou de editar pela tela — ou
// faz a busca da tela de curadoria divergir da busca do catálogo publicado.
//
// CATEGORIAS: as 15 categorias da TACO, conferidas contra o arquivo-fonte real
// (scripts/dados-alimentos/alimentos-fonte.json, carga de 26/08/2026). Não são
// vocabulário livre — vêm da carga, e um valor fora daqui não corresponde a
// nenhum alimento real.

export const CATEGORIAS = [
  'Alimentos preparados',
  'Bebidas (alcoólicas e não alcoólicas)',
  'Carnes e derivados',
  'Cereais e derivados',
  'Frutas e derivados',
  'Gorduras e óleos',
  'Leguminosas e derivados',
  'Leite e derivados',
  'Miscelâneas',
  'Nozes e sementes',
  'Outros alimentos industrializados',
  'Ovos e derivados',
  'Pescados e frutos do mar',
  'Produtos açucarados',
  'Verduras, hortaliças e derivados',
] as const;

/** Procedência dos itens carregados da TACO. Item de curadoria própria (passo
 *  9 desta especificação) nasce com uma fonte diferente — 'curadoria'. */
export const FONTE_TACO = 'taco-4ed-2011';

/** Campos que a tela pode alterar. Fora daqui, de propósito: nome, nomeBusca
 *  (derivado de nomeExibicao, recalculado pelo servidor — ver
 *  normalizarNomeBusca), categoria, base, nutrientes, macrosTemTraco,
 *  publicado, fonte, origem, criadoPor/criadoEm — procedência e classificação
 *  bruta não se editam pela tela; e revisadoPor/revisadoEm, que só as
 *  operações revisar/desrevisar carimbam. */
export const CAMPOS_EDITAVEIS = ['nomeExibicao', 'medidaCaseira', 'macros'] as const;

const inclui = (lista: readonly string[], v: unknown) => typeof v === 'string' && lista.includes(v);

/**
 * Dobra de busca: minúsculas E sem acento, dos dois lados da comparação.
 *
 * Mesma normalização de _vocabulario-exercicios.ts, repetida aqui em vez de
 * importada por ele: são módulos irmãos, cada um fechado sobre sua própria
 * coleção, e duplicar uma função pura de duas linhas custa menos do que abrir
 * uma dependência cruzada entre os dois vocabulários.
 */
export const dobraBusca = (texto: unknown) =>
  String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Recalcula nomeBusca a partir de um nomeExibicao novo — mesma fórmula de
 * scripts/carregar-alimentos.mjs (normalizarBusca), duplicada aqui pela razão
 * do cabeçalho: sem isso, editar o nome pela tela deixaria nomeBusca apontando
 * para o nome antigo, e o catálogo publicado (que lê nomeBusca do documento,
 * não recalcula) buscaria pelo que o Coach já trocou.
 */
export const normalizarNomeBusca = (nome: string) =>
  nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const MACRO_CAMPOS = ['kcal', 'proteinaG', 'carboidratoG', 'lipideosG'] as const;

function validarMacros(v: unknown): string[] {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return ['macros deve ser um objeto'];
  const m = v as Record<string, unknown>;
  const erros: string[] = [];
  for (const campo of MACRO_CAMPOS) {
    const n = m[campo];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      erros.push(`macros.${campo} deve ser um número não negativo`);
    }
  }
  return erros;
}

/**
 * Valida um conjunto parcial de campos editáveis de um alimento existente.
 * Devolve a lista de problemas — vazia quer dizer válido.
 *
 * `fonte` é a procedência do DOCUMENTO já gravado, não algo que o corpo possa
 * declarar — ver o cabeçalho deste arquivo sobre a divergência 2.
 */
export function validarCampos(campos: Record<string, unknown>, fonte: string): string[] {
  const erros: string[] = [];

  for (const chave of Object.keys(campos)) {
    if (!(CAMPOS_EDITAVEIS as readonly string[]).includes(chave)) {
      erros.push(`campo não editável: ${chave}`);
    }
  }

  if ('nomeExibicao' in campos) {
    const v = campos.nomeExibicao;
    if (typeof v !== 'string' || v.trim() === '') erros.push('nomeExibicao não pode ficar vazio');
  }
  if ('medidaCaseira' in campos && campos.medidaCaseira !== null && typeof campos.medidaCaseira !== 'string') {
    erros.push('medidaCaseira deve ser texto ou nulo');
  }
  if ('macros' in campos) {
    if (fonte === FONTE_TACO) {
      erros.push('macros é somente leitura para item da TACO — editar quebraria a procedência citável');
    } else {
      erros.push(...validarMacros(campos.macros));
    }
  }

  return erros;
}

/** Exportado para listar-alimentos.ts validar o filtro de categoria contra o
 *  mesmo vocabulário fechado, no mesmo padrão de GRUPOS em exercícios. */
export const categoriaValida = (v: unknown) => inclui(CATEGORIAS, v);
