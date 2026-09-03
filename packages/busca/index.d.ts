export declare function dobraBusca(texto: unknown): string;
export declare function normalizarNomeBusca(nome: string): string;
export declare function termosBusca(consulta: string): string[];
export declare function casaTodosTermos(nomeNormalizado: string, termos: string[]): boolean;
export declare function pontuaAlimento(
  nomeNormalizado: string,
  termos: string[],
  consultaNormalizada: string
): number;
