// @elite90/busca — normalização e casamento de busca.
// ÚNICA FONTE para cliente (atletas.astro, via ?raw), funções Netlify e scripts.
// Este arquivo NÃO pode conter import/export: é injetado como script clássico
// em <script is:inline set:html={...}> (ver apps/site/src/pages/admin/atletas.astro),
// onde o navegador rejeita a sintaxe de módulo. index.js importa este arquivo
// e reexporta as funções a partir de globalThis.__elite90Busca (ver abaixo).

function dobraBusca(texto) {
  return String(texto ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[,;:\/()\-_"'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Forma GRAVADA em nomeBusca no Firestore. Texto idêntico ao
// normalizarNomeBusca de netlify/functions/_vocabulario-alimentos.ts e ao
// normalizarBusca de scripts/carregar-alimentos.mjs no momento da unificação
// (equivalência conferida sobre os 582 nomes publicados antes desta mudança).
// Alterar este texto exige recarregar os documentos existentes.
function normalizarNomeBusca(nome) {
  return String(nome ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function termosBusca(consulta) {
  return dobraBusca(consulta).split(' ').filter(Boolean);
}

function casaTodosTermos(nomeNormalizado, termos) {
  return termos.every(function (t) { return nomeNormalizado.includes(t); });
}

// Pontuação de relevância (maior = melhor), usada apenas no cliente (plano
// nutricional) para ordenar antes do corte em 10 resultados.
function pontuaAlimento(nomeNormalizado, termos, consultaNormalizada) {
  if (nomeNormalizado.startsWith(consultaNormalizada)) return 4;
  if (nomeNormalizado.startsWith(termos[0])) return 3;
  var palavras = nomeNormalizado.split(' ');
  var todosNoInicioDePalavra = termos.every(function (t) {
    return palavras.some(function (p) { return p.startsWith(t); });
  });
  if (todosNoInicioDePalavra) return 2;
  return 1;
}

globalThis.__elite90Busca = {
  dobraBusca: dobraBusca,
  normalizarNomeBusca: normalizarNomeBusca,
  termosBusca: termosBusca,
  casaTodosTermos: casaTodosTermos,
  pontuaAlimento: pontuaAlimento,
};
