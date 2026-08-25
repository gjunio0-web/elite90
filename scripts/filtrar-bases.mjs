// ELITE90 PRO · filtrar-bases
// -----------------------------------------------------------------------------
// Recorta as bases de domínio conforme o contexto de publicação e escreve os
// arquivos que o painel consome.
//
// ESTE É O PORTÃO DE PRODUÇÃO, e ele é mecânico por construção:
//
//   CONTEXT === 'production'  → emite APENAS os itens revisados pelo Coach.
//   qualquer outro contexto   → emite todos, cada um com a marca `revisado`,
//                               para o painel exibir o selo de pendência.
//   variável ausente          → assume produção. O erro seguro é publicar de
//                               menos, nunca vazar item não validado.
//
// POR QUE UM SCRIPT SÓ PARA TODAS AS BASES
// Toda a lógica aqui é genérica: ler um JSON, filtrar por `revisado`, escrever
// outro JSON. O que muda de uma base para outra são quatro literais — entrada,
// saída, chave do vetor e rótulo. Duplicar o arquivo por base significaria
// copiar as decisões de borda abaixo para cada cópia, e aplicar a próxima
// correção em uma só. Já aconteceu neste projeto: uma renomeação incompleta
// deixou um script quebrado e a documentação apontando uma opção inexistente.
//
// POR QUE ESTE SCRIPT CONTINUA SEPARADO DOS GERADORES
// Os geradores leem o Firestore: precisam de credencial e de rede, e rodam na
// máquina de quem publica. Este roda dentro do Netlify, em TODA publicação,
// porque está no script de build do apps/site. Fundir os dois estágios
// reintroduziria a dependência do build em relação ao Firestore — uma
// instabilidade do banco derrubaria a publicação do site inteiro. "Um script
// só" quer dizer não duplicar por base, não fundir os dois estágios.
//
// Consequência: vazar item não revisado passa a exigir que ESTE filtro falhe,
// não que alguém esqueça um comando.
//
// O que continua manual: o CONTEÚDO de cada arquivo-fonte depende de alguém
// rodar o gerador correspondente. Base revisada e não regerada não chega a
// produção — isso é atraso, não vazamento. O erro cai no lado seguro.
//
// ARTEFATO DURÁVEL. Chamado pelo script de build do apps/site.
//
// Uso (normalmente automático, via npm run build):
//   node scripts/filtrar-bases.mjs
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

// ── TABELA DE BASES ──────────────────────────────────────────────────────────
// Acrescentar uma base é acrescentar uma linha aqui. Nada mais precisa mudar:
// nem o package.json, nem o script de build — o que evita a falha silenciosa de
// criar a base e esquecer de encaixá-la na publicação.
//
// `chave` é o nome do vetor dentro do arquivo-fonte e do arquivo emitido. Ele
// difere entre as bases por herança dos geradores, e trocá-lo agora quebraria o
// painel, que já consome `exercicios`.
const BASES = [
  {
    id: 'exercicios',
    rotulo: 'catálogo de exercícios',
    entrada: 'scripts/dados-exercicios/catalogo-fonte.json',
    saida: 'apps/site/public/dados/exercicios.json',
    chave: 'exercicios',
    comando: 'npm run catalogo:exercicios',
  },
  {
    id: 'alimentos',
    rotulo: 'base de alimentos',
    entrada: 'scripts/dados-alimentos/alimentos-fonte.json',
    saida: 'apps/site/public/dados/alimentos.json',
    chave: 'alimentos',
    comando: 'npm run catalogo:alimentos',
  },
];

const CONTEXTO = process.env.CONTEXT ?? 'production';
const SO_REVISADOS = CONTEXTO === 'production';

function escrever(caminho, saida) {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, JSON.stringify(saida), 'utf8');
}

/** Devolve true se a base foi processada sem erro fatal. */
function processar(base) {
  const entrada = resolve(RAIZ, base.entrada);
  const saida = resolve(RAIZ, base.saida);
  const marca = `[${base.id}]`;

  // Ausência do arquivo-fonte NÃO derruba o build. As bases de domínio estão em
  // construção; travar a publicação do site inteiro por causa de uma delas seria
  // desproporcional — e travaria também a outra, que pode estar pronta. Em vez
  // disso, emite base vazia com o motivo registrado, e o painel exibe uma
  // mensagem que aponta a causa real.
  if (!existsSync(entrada)) {
    console.warn(`${marca} arquivo-fonte ausente: ${base.entrada}`);
    console.warn(`${marca} emitindo base vazia. Rode "${base.comando}" para gerá-la.`);
    escrever(saida, {
      geradoEm: null,
      contexto: CONTEXTO,
      soRevisados: SO_REVISADOS,
      total: 0,
      [base.chave]: [],
      _motivo: 'arquivo-fonte ausente no momento do build',
    });
    return true;
  }

  let fonte;
  try {
    fonte = JSON.parse(readFileSync(entrada, 'utf8'));
  } catch (e) {
    // JSON inválido é erro de quem commitou, não condição de ambiente: aqui vale
    // derrubar o build, porque publicar em silêncio esconderia o estrago.
    console.error(`${marca} arquivo-fonte inválido: ${e.message}`);
    return false;
  }

  const todos = Array.isArray(fonte[base.chave]) ? fonte[base.chave] : [];
  const emitidos = SO_REVISADOS ? todos.filter((i) => i.revisado === true) : todos;
  const ocultos = todos.length - emitidos.length;

  escrever(saida, {
    geradoEm: fonte.geradoEm ?? null,
    contexto: CONTEXTO,
    soRevisados: SO_REVISADOS,
    total: emitidos.length,
    [base.chave]: emitidos,
  });

  const kb = (Buffer.byteLength(JSON.stringify(emitidos), 'utf8') / 1024).toFixed(1);
  console.log(`${marca} ${emitidos.length} de ${todos.length} item(ns) emitidos, ${kb} KB`);
  if (SO_REVISADOS && ocultos) {
    console.log(`${marca} ${ocultos} oculto(s) por falta de revisão do Coach`);
  }
  if (!SO_REVISADOS) {
    const semRevisao = todos.filter((i) => !i.revisado).length;
    if (semRevisao) console.log(`${marca} ${semRevisao} exibido(s) com selo de pendência`);
  }
  return true;
}

console.log(`\n[bases] contexto "${CONTEXTO}"${SO_REVISADOS ? ' — somente revisados' : ' — todos os publicados'}`);

let houveFalha = false;
for (const base of BASES) {
  if (!processar(base)) houveFalha = true;
}
console.log('');

// Uma base com arquivo-fonte corrompido derruba o build, mas só depois de todas
// terem sido processadas — assim o relatório mostra o estado completo, em vez de
// parar na primeira e esconder o resto.
if (houveFalha) process.exit(1);
