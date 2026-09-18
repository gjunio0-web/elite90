// ELITE90 PRO · _conteudo-plano
// Módulo compartilhado: um plano (treino ou nutrição) tem conteúdo de verdade?
//
// EXISTE PORQUE A FUNÇÃO ESTAVA DUPLICADA E A CÓPIA TINHA UM BURACO
//
// `publicar-plano-direto.ts` (AC-40) e `submeter-sugestao.ts` (guarda de envio
// sem alteração) tinham cada uma a sua própria `semConteudo`, texto idêntico.
// A cópia contava REFEIÇÕES, não ALIMENTOS DENTRO DELAS:
//
//   const refeicoes = Array.isArray(dia.meals) ? dia.meals : [];
//   if (... || refeicoes.length > 0) return false;
//
// `nteCreateFirstPlan()` (nucleo.js) cria o primeiro dia já com uma refeição
// dentro — "Café da manhã", `foods: []` — porque é assim que a tela oferece um
// ponto de partida para o Coach editar. Uma refeição sem nenhum alimento
// contava como "tem conteúdo" e passava pelas duas guardas: publicado direto
// pelo Coach (achado em homologação — o teste do Bloco B2) ou enviado pelo
// profissional (mesmo defeito, nunca chegou a ser testado). O treino não tinha
// o problema, porque `wkeCreateFirstDay()` cria `exercises: []` de fato vazio.
//
// Correção: um dia só tem conteúdo se ALGUMA refeição tiver ALGUM alimento.

function temAlimento(refeicao: unknown): boolean {
  const alimentos = (refeicao as Record<string, unknown> | null)?.foods;
  return Array.isArray(alimentos) && alimentos.length > 0;
}

export function planoSemConteudo(plano: unknown): boolean {
  const p = (plano ?? {}) as Record<string, unknown>;
  const dias = (p.days ?? {}) as Record<string, unknown>;

  for (const chave of Object.keys(dias)) {
    const dia = (dias[chave] ?? {}) as Record<string, unknown>;

    const exercicios = Array.isArray(dia.exercises) ? dia.exercises : [];
    if (exercicios.length > 0) return false;

    const refeicoes = Array.isArray(dia.meals) ? dia.meals : [];
    if (refeicoes.some(temAlimento)) return false;
  }

  return true;
}
