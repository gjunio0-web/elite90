// ELITE90 PRO · _prazo
// -----------------------------------------------------------------------------
// Tempo limite e orçamento de tempo para funções que fazem várias chamadas
// externas em sequência (submit-lead).
//
// POR QUE EXISTE (06/10/2026)
// submit-lead só respondia depois de gravar a ficha, enviar dois e-mails,
// pontuar com o modelo e gravar de novo — tudo em série, e nenhuma dessas
// chamadas externas tinha tempo limite. Uma delas lenta (Resend, Gemini,
// Storage, que tenta de novo com espera crescente) segurava a resposta até o
// limite da plataforma, e o candidato via "Enviando..." sem fim. Aqui ficam as
// duas peças que limitam isso: `comPrazo`, para uma chamada, e `criarOrcamento`,
// para o conjunto — o que não couber no orçamento é pulado, porque a ficha já
// está gravada e é o que importa.
// -----------------------------------------------------------------------------

export class PrazoEsgotado extends Error {
  constructor(public rotulo: string, public ms: number) {
    super(`${rotulo}: tempo limite de ${ms} ms esgotado`);
    this.name = "PrazoEsgotado";
  }
}

/**
 * Rejeita com PrazoEsgotado se `promessa` não terminar em `ms`. NÃO cancela o
 * trabalho por baixo — só para de esperar por ele; quem pode cancelar de
 * verdade (fetch) deve usar também um AbortSignal.
 */
export function comPrazo<T>(promessa: Promise<T>, ms: number, rotulo: string): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(() => rejeitar(new PrazoEsgotado(rotulo, ms)), ms);
  });
  // Uma promessa que perde a corrida e rejeita depois não pode virar rejeição
  // não tratada.
  promessa.catch(() => {});
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(relogio));
}

export type Orcamento = {
  /** Milissegundos que ainda restam (nunca negativo). */
  restante(): number;
  /** Parte do que resta que um passo pode usar: no máximo `maxMs`, menos `reservaMs` guardados para os passos seguintes. */
  fatia(maxMs: number, reservaMs?: number): number;
};

export function criarOrcamento(totalMs: number, agora: () => number = Date.now): Orcamento {
  const inicio = agora();
  const restante = () => Math.max(0, totalMs - (agora() - inicio));
  return {
    restante,
    fatia: (maxMs, reservaMs = 0) => Math.max(0, Math.min(maxMs, restante() - reservaMs)),
  };
}
