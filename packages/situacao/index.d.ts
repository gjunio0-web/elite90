export declare const FUSO_VIRADA: string;
export declare const SITUACOES: readonly [
  'recem-promovido',
  'no-prazo',
  'acima-7-dias',
  'acima-14-dias'
];
export declare const SITUACAO_LABEL: Record<(typeof SITUACOES)[number], string>;
export declare function derivarSituacao(
  createdAt: Date,
  ultimoCheckinEnviadoEm?: Date | null,
  agora?: Date
): (typeof SITUACOES)[number];
