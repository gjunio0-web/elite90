// ELITE90 PRO · _vocabulario-exercicios
// Vocabulário fechado da coleção exercises/ e a validação que o servidor aplica.
// Importado por atualizar-exercicio.ts. O prefixo _ impede o Netlify de tratar
// este arquivo como endpoint (mesma convenção de _firebase.ts e _mailer.ts).
//
// POR QUE A VALIDAÇÃO VIVE NO SERVIDOR
// A tela também vai validar, com seletores de lista fechada. Isso é conveniência
// para quem usa; não é garantia. Requisição não passa por seletor — passa por
// HTTP, e quem tem o token pode mandar o que quiser no corpo. Um valor fora do
// vocabulário quebra o filtro do painel e a agregação do Motor de Evolução, e o
// estrago só aparece semanas depois, num relatório que não fecha.
//
// DUPLICAÇÃO CONHECIDA, E POR QUE ELA EXISTE HOJE
// As mesmas cinco listas estão em scripts/carregar-exercicios.mjs e em
// scripts/conferir-exercicios.mjs. Não é descuido: nenhuma função deste projeto
// importa de fora de netlify/functions/, e os scripts são .mjs avulsos, fora do
// build do Netlify — unificar exigiria atravessar essa fronteira sem precedente
// no repositório. A escolha foi seguir a convenção existente e registrar o
// acoplamento em vez de escondê-lo.
//
// SE VOCÊ ALTERAR QUALQUER LISTA AQUI, ALTERE TAMBÉM NOS DOIS SCRIPTS. Uma lista
// mais larga aqui aceita, pela função, valor que a carga recusaria — e o
// catálogo passa a ter dado que o conferidor acusa como divergente sem explicar
// de onde veio.

export const GRUPOS = ['Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps', 'Antebraço', 'Pernas', 'Abdômen'] as const;

export const MUSCULOS = ['Peitoral', 'Dorsal', 'Trapézio', 'Lombar', 'Deltoide', 'Bíceps', 'Tríceps',
  'Antebraço', 'Quadríceps', 'Posterior de Coxa', 'Glúteo', 'Panturrilha', 'Adutor', 'Abdutor',
  'Abdômen', 'Oblíquo'] as const;

export const EQUIPAMENTOS = ['Barra', 'Halteres', 'Polia', 'Máquina', 'Peso Corporal', 'Barra W', 'Kettlebell'] as const;

export const MECANICAS = ['composto', 'isolado'] as const;

export const NIVEIS = ['iniciante', 'intermediario', 'avancado'] as const;

/** Campos que a tela pode alterar. Fora daqui, de propósito: nome_en, origem,
 *  publicado, criadoPor/criadoEm — procedência e autoria não se editam; e
 *  revisadoPor/revisadoEm, que só a operação `revisar` carimba. */
export const CAMPOS_EDITAVEIS = ['nome_pt', 'instrucao_pt', 'instrucao_en', 'grupo',
  'musculoPrimario', 'musculosSecundarios', 'equipamento', 'mecanica', 'nivel',
  'revisarMusculo'] as const;

const inclui = (lista: readonly string[], v: unknown) => typeof v === 'string' && lista.includes(v);

/**
 * Valida um conjunto parcial de campos editáveis.
 * Devolve a lista de problemas — vazia quer dizer válido.
 *
 * Parcial de propósito: a tela manda só o que mudou, e exigir o documento
 * inteiro faria toda edição carregar campos que ninguém tocou, multiplicando as
 * chances de sobrescrever com dado velho.
 */
export function validarCampos(campos: Record<string, unknown>): string[] {
  const erros: string[] = [];

  for (const chave of Object.keys(campos)) {
    if (!(CAMPOS_EDITAVEIS as readonly string[]).includes(chave)) {
      erros.push(`campo não editável: ${chave}`);
    }
  }

  if ('nome_pt' in campos) {
    const v = campos.nome_pt;
    if (typeof v !== 'string' || v.trim() === '') erros.push('nome_pt não pode ficar vazio');
  }
  if ('instrucao_pt' in campos) {
    const v = campos.instrucao_pt;
    // Instrução vazia é o que separa um exercício utilizável de uma linha morta
    // no seletor: o atleta recebe o nome e nenhuma orientação de execução.
    if (typeof v !== 'string' || v.trim() === '') erros.push('instrucao_pt não pode ficar vazia');
  }
  if ('instrucao_en' in campos && campos.instrucao_en !== null && typeof campos.instrucao_en !== 'string') {
    erros.push('instrucao_en deve ser texto ou nulo');
  }
  if ('grupo' in campos && !inclui(GRUPOS, campos.grupo)) {
    erros.push(`grupo fora do vocabulário: ${String(campos.grupo)}`);
  }
  if ('musculoPrimario' in campos && !inclui(MUSCULOS, campos.musculoPrimario)) {
    erros.push(`musculoPrimario fora do vocabulário: ${String(campos.musculoPrimario)}`);
  }
  if ('musculosSecundarios' in campos) {
    const v = campos.musculosSecundarios;
    if (!Array.isArray(v)) erros.push('musculosSecundarios deve ser lista');
    else {
      for (const m of v) if (!inclui(MUSCULOS, m)) erros.push(`músculo secundário fora do vocabulário: ${String(m)}`);
      if (new Set(v).size !== v.length) erros.push('musculosSecundarios tem valor repetido');
    }
  }
  if ('equipamento' in campos && !inclui(EQUIPAMENTOS, campos.equipamento)) {
    erros.push(`equipamento fora do vocabulário: ${String(campos.equipamento)}`);
  }
  if ('mecanica' in campos && campos.mecanica !== null && !inclui(MECANICAS, campos.mecanica)) {
    erros.push(`mecânica fora do vocabulário: ${String(campos.mecanica)}`);
  }
  if ('nivel' in campos && !inclui(NIVEIS, campos.nivel)) {
    erros.push(`nível fora do vocabulário: ${String(campos.nivel)}`);
  }
  if ('revisarMusculo' in campos && typeof campos.revisarMusculo !== 'boolean') {
    erros.push('revisarMusculo deve ser booleano');
  }

  return erros;
}
