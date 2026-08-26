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
//
// PASSOS 4 A 10 (26/08/2026) — o que este módulo ganhou:
//   • macrosFaltando lê o bloco bruto `nutrientes` (gravado por
//     scripts/carregar-alimentos.mjs mesmo quando macros fica nulo) e nomeia
//     qual dos quatro macronutrientes falta — passo 8, "a tela precisa deixar
//     isso visível".
//   • validarMacros ganhou a checagem de coerência calórica (divergência 4 do
//     repasse): aqui, não em atualizar-alimento.ts, porque tanto `criar`
//     quanto editar um item de curadoria gravam macros, e as duas gravações
//     merecem a mesma garantia — duplicá-la nos dois pontos de chamada
//     envelheceria mal.
//   • CAMPOS_OBRIGATORIOS_NOVO/validarNovo são para `criar` (passo 9). Não
//     reaproveitam CAMPOS_EDITAVEIS como o par equivalente de exercícios faz:
//     lá, todo campo de criar já está em CAMPOS_EDITAVEIS. Aqui não — categoria
//     é obrigatória ao criar e nunca editável depois, então validarNovo valida
//     por conta própria em vez de delegar a validarCampos.

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

/** Procedência de item cadastrado pela tela (passo 9). Nome do valor gravado
 *  por atualizar-alimento.ts na operação `criar` — mora aqui, e não como
 *  string solta lá, para que só existir um lugar de onde `fonte === 'curadoria'`
 *  possa ser digitado errado. */
export const FONTE_CURADORIA = 'curadoria';

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

// Tolerância da coerência calórica (divergência 4 do repasse). Nem tão
// apertada que recuse arredondamento normal de rótulo, nem tão larga que deixe
// passar erro de dígito ou leitura em porção diferente de 100 g — os dois
// erros que o repasse aponta como os prováveis. Relativa E mínima absoluta:
// só relativa deixaria um alimento de poucas calorias (uma folha, um tempero)
// sem margem nenhuma; só absoluta seria frouxa demais num prato calórico.
const TOLERANCIA_CALORICA_MINIMA_KCAL = 15;
const TOLERANCIA_CALORICA_RELATIVA = 0.2;

/** Atwater: proteína e carboidrato a 4 kcal/g, gordura a 9 kcal/g. */
function caloriasEsperadas(m: { proteinaG: number; carboidratoG: number; lipideosG: number }): number {
  return m.proteinaG * 4 + m.carboidratoG * 4 + m.lipideosG * 9;
}

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
  // Só checa coerência com os quatro números já válidos — com um deles
  // recusado acima, o cálculo daria um segundo erro em cima do primeiro.
  if (!erros.length) {
    const numeros = m as { kcal: number; proteinaG: number; carboidratoG: number; lipideosG: number };
    const esperado = caloriasEsperadas(numeros);
    const tolerancia = Math.max(TOLERANCIA_CALORICA_MINIMA_KCAL, esperado * TOLERANCIA_CALORICA_RELATIVA);
    if (Math.abs(numeros.kcal - esperado) > tolerancia) {
      erros.push(
        `macros.kcal (${numeros.kcal}) não bate com o cálculo a partir dos outros três ` +
        `(proteína×4 + carboidrato×4 + gordura×9 ≈ ${Math.round(esperado)} kcal) — confira o dígito ` +
        `e se a leitura foi mesmo para 100 g.`,
      );
    }
  }
  return erros;
}

// ── Passo 8: qual macronutriente falta ──
// scripts/dados-alimentos/preparar-alimentos.mjs grava, por alimento, o estado
// bruto de cada nutriente da planilha (nutrientes.{campo}.st) mesmo quando
// macros fica nulo — é dali que vem a resposta a "por que não encontro X".
const CAMPOS_MACRO_NUTRIENTE = ['energiaKcal', 'proteinaG', 'carboidratoG', 'lipideosG'] as const;
const ROTULO_MACRO_NUTRIENTE: Record<string, string> = {
  energiaKcal: 'calorias', proteinaG: 'proteína', carboidratoG: 'carboidrato', lipideosG: 'lipídeos',
};
// Os três estados que a TACO usa para "não é um número" — ver
// scripts/dados-alimentos/preparar-alimentos.mjs, função interpretar().
const ROTULO_ESTADO_NUTRIENTE: Record<string, string> = {
  nao_solicitada: 'não solicitada nesta análise',
  nao_aplicavel: 'não aplicável a este alimento',
  em_reavaliacao: 'em reavaliação pela TACO',
};

/**
 * Nomeia qual macronutriente falta e por quê, a partir do bloco bruto
 * `nutrientes` do documento. Devolve lista vazia quando os quatro estão
 * completos ('ok' ou 'traco' — traço vira zero e conta como presente, mesma
 * regra de preparar-alimentos.mjs).
 */
export function macrosFaltando(nutrientes: Record<string, { st?: string }> | null | undefined): string[] {
  if (!nutrientes) return [];
  const faltando: string[] = [];
  for (const campo of CAMPOS_MACRO_NUTRIENTE) {
    const st = nutrientes[campo]?.st;
    if (st === 'ok' || st === 'traco') continue;
    faltando.push(`${ROTULO_MACRO_NUTRIENTE[campo]} (${ROTULO_ESTADO_NUTRIENTE[st ?? ''] ?? st ?? 'ausente'})`);
  }
  return faltando;
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

/** Campos sem os quais um alimento novo não serve a ninguém: sem nome não é
 *  achável, sem categoria não entra em filtro nem faixa, sem macros não é
 *  publicável — e "a definir" não existe aqui como existe em nível de
 *  exercício, porque macronutriente errado gera conta errada no plano do
 *  atleta (divergência 4 do repasse), não texto pobre. medidaCaseira fica de
 *  fora de propósito: é o campo que a TACO nunca preenche, e exigi-lo na
 *  criação também seria inconsistente com os 582 itens que já não o têm. */
export const CAMPOS_OBRIGATORIOS_NOVO = ['nomeExibicao', 'categoria', 'macros'] as const;

/**
 * Valida o corpo de um alimento novo (operação `criar`). Devolve a lista de
 * problemas.
 *
 * NÃO delega para validarCampos como o par de exercícios faz — lá, os campos
 * de criação já são um subconjunto de CAMPOS_EDITAVEIS. Aqui categoria é
 * obrigatória ao criar e nunca editável depois (ver o comentário de
 * CAMPOS_EDITAVEIS), então validarNovo valida cada campo por conta própria.
 * A checagem de coerência calórica vem de validarMacros, chamada abaixo — não
 * duplicada aqui.
 */
export function validarNovo(campos: Record<string, unknown>): string[] {
  const erros: string[] = [];
  for (const chave of CAMPOS_OBRIGATORIOS_NOVO) {
    const v = campos[chave];
    if (v == null || (typeof v === 'string' && v.trim() === '')) {
      erros.push(`${chave} é obrigatório em alimento novo`);
    }
  }
  if (campos.categoria != null && !inclui(CATEGORIAS, campos.categoria)) {
    erros.push(`categoria fora do vocabulário: ${String(campos.categoria)}`);
  }
  if (campos.macros != null) erros.push(...validarMacros(campos.macros));
  if (campos.medidaCaseira != null && typeof campos.medidaCaseira !== 'string') {
    erros.push('medidaCaseira deve ser texto ou nulo');
  }
  return erros;
}
