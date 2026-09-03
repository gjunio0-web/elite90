// Ponte ESM para @elite90/situacao. O conteúdo real está em nucleo.js, que
// precisa permanecer sem import/export para também ser injetável como
// script clássico no navegador (ver o cabeçalho de nucleo.js). Como imports
// ESM são executados antes do corpo deste módulo, globalThis.__elite90Situacao
// já existe quando a linha abaixo roda.
import './nucleo.js';

const s = globalThis.__elite90Situacao;

export const FUSO_VIRADA = s.FUSO_VIRADA;
export const SITUACOES = s.SITUACOES;
export const SITUACAO_LABEL = s.SITUACAO_LABEL;
export const derivarSituacao = s.derivarSituacao;
