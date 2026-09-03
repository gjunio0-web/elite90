// Ponte ESM para @elite90/busca. O conteúdo real está em nucleo.js, que
// precisa permanecer sem import/export para também ser injetável como
// script clássico no navegador (ver o cabeçalho de nucleo.js e D-10 da spec
// M2-BUSCA-DE-ALIMENTOS-SEM-PONTUACAO-v1.1.md). Como imports ESM são
// executados antes do corpo deste módulo, globalThis.__elite90Busca já
// existe quando a linha abaixo roda.
import './nucleo.js';

const b = globalThis.__elite90Busca;

export const dobraBusca = b.dobraBusca;
export const normalizarNomeBusca = b.normalizarNomeBusca;
export const termosBusca = b.termosBusca;
export const casaTodosTermos = b.casaTodosTermos;
export const pontuaAlimento = b.pontuaAlimento;
