// ELITE90 PRO · filtrar-catalogo
// -----------------------------------------------------------------------------
// Recorta o catálogo de exercícios conforme o contexto de publicação e escreve
// o arquivo que o painel consome.
//
//   ENTRADA  scripts/dados-exercicios/catalogo-fonte.json   (versionado no Git)
//   SAÍDA    apps/site/public/dados/exercicios.json         (artefato de build)
//
// ESTE É O PORTÃO DE PRODUÇÃO, e ele é mecânico por construção:
//
//   CONTEXT === 'production'  → emite APENAS os exercícios revisados pelo Coach.
//   qualquer outro contexto   → emite todos, cada um com a marca `revisado`,
//                               para o painel exibir o selo de pendência.
//   variável ausente          → assume produção. O erro seguro é publicar de
//                               menos, nunca vazar nome não validado.
//
// POR QUE ESTE SCRIPT EXISTE SEPARADO DO GERADOR
// A primeira versão do desenho punha o filtro dentro de gerar-catalogo-exercicios.mjs,
// que lê o Firestore. Mas aquele script roda na máquina de quem publica um lote,
// nunca dentro do Netlify — então o CONTEXT que ficava congelado no arquivo era o
// de quem digitou o comando, e o mesmo arquivo era servido em homologação e em
// produção. O portão descrito como mecânico era, na prática, disciplina humana.
//
// Aqui não há rede, credencial nem Firestore: é transformação de arquivo local.
// Por isso pode rodar em TODA publicação, dentro do Netlify, sem acoplar o build
// ao banco. Uma instabilidade do Firestore não derruba a publicação do site.
//
// Consequência: vazar nome não revisado passa a exigir que ESTE filtro falhe,
// não que alguém esqueça um comando.
//
// O que continua manual: o CONTEÚDO do arquivo-fonte depende de alguém rodar o
// gerador. Um lote revisado e não gerado não chega a produção — isso é atraso,
// não vazamento. O erro cai no lado seguro.
//
// ARTEFATO DURÁVEL. Chamado pelo script de build do apps/site.
//
// Uso (normalmente automático, via npm run build):
//   node scripts/filtrar-catalogo.mjs
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Caminhos ancorados na localização deste arquivo, não no diretório de trabalho:
// o Netlify chama o build a partir de apps/site, e o desenvolvedor costuma
// chamar da raiz. Ancorar no cwd faria o script achar o arquivo em um caso e
// falhar no outro.
const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const ENTRADA = resolve(RAIZ, 'scripts/dados-exercicios/catalogo-fonte.json');
const SAIDA = resolve(RAIZ, 'apps/site/public/dados/exercicios.json');

const CONTEXTO = process.env.CONTEXT ?? 'production';
const SO_REVISADOS = CONTEXTO === 'production';

function escrever(saida) {
  mkdirSync(dirname(SAIDA), { recursive: true });
  writeFileSync(SAIDA, JSON.stringify(saida), 'utf8');
}

// Ausência do arquivo-fonte NÃO derruba o build. O catálogo é uma base de
// domínio em construção; travar a publicação do site inteiro por causa dela
// seria desproporcional. Em vez disso, emite catálogo vazio com o motivo
// registrado, e o painel exibe uma mensagem que aponta a causa real.
if (!existsSync(ENTRADA)) {
  console.warn(`\n[catálogo] arquivo-fonte ausente: ${ENTRADA}`);
  console.warn('[catálogo] emitindo catálogo vazio. Rode "npm run catalogo:exercicios" para gerá-lo.\n');
  escrever({
    geradoEm: null,
    contexto: CONTEXTO,
    soRevisados: SO_REVISADOS,
    total: 0,
    exercicios: [],
    _motivo: 'arquivo-fonte ausente no momento do build',
  });
  process.exit(0);
}

let fonte;
try {
  fonte = JSON.parse(readFileSync(ENTRADA, 'utf8'));
} catch (e) {
  // JSON inválido é erro de quem commitou, não condição de ambiente: aqui vale
  // derrubar o build, porque publicar em silêncio esconderia o estrago.
  console.error(`\n[catálogo] arquivo-fonte inválido: ${e.message}\n`);
  process.exit(1);
}

const todos = Array.isArray(fonte.exercicios) ? fonte.exercicios : [];
const emitidos = SO_REVISADOS ? todos.filter((e) => e.revisado === true) : todos;
const ocultos = todos.length - emitidos.length;

escrever({
  geradoEm: fonte.geradoEm ?? null,
  contexto: CONTEXTO,
  soRevisados: SO_REVISADOS,
  total: emitidos.length,
  exercicios: emitidos,
});

const kb = (Buffer.byteLength(JSON.stringify(emitidos), 'utf8') / 1024).toFixed(1);
console.log(`[catálogo] contexto "${CONTEXTO}"${SO_REVISADOS ? ' — somente revisados' : ' — todos os publicados'}`);
console.log(`[catálogo] ${emitidos.length} de ${todos.length} exercício(s) emitidos, ${kb} KB`);
if (SO_REVISADOS && ocultos) console.log(`[catálogo] ${ocultos} ocultos por falta de revisão do Coach`);
if (!SO_REVISADOS && ocultos === 0 && todos.length) {
  const semRevisao = todos.filter((e) => !e.revisado).length;
  if (semRevisao) console.log(`[catálogo] ${semRevisao} exibidos com selo de pendência`);
}
