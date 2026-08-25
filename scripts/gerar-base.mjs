// ELITE90 PRO · gerar-base
// -----------------------------------------------------------------------------
// Lê uma coleção de base de domínio do Firestore e escreve o arquivo-fonte
// versionado no Git, que é a entrada do filtro de publicação.
//
// Divisão de papéis:
//   • Firestore     → fonte de verdade para EDIÇÃO (o Coach revisa e corrige).
//   • arquivo-fonte → entrada do filtro, versionada, auditável no histórico.
//   • filtrar-bases → recorta por contexto e emite o que o painel lê.
//
// ESTE SCRIPT NÃO FILTRA POR CONTEXTO — e a razão importa.
//
// A primeira versão lia a variável CONTEXT, que o Netlify define por contexto
// de publicação, e emitia só os revisados quando o valor era 'production'. O
// desenho estava errado: este script pode rodar na MÁQUINA de quem publica,
// nunca dentro do Netlify. O CONTEXT que ficaria congelado no arquivo seria o
// de quem digitou o comando, e o mesmo arquivo seria servido em homologação e
// em produção. O portão que parecia mecânico era, na prática, a disciplina de
// quem rodava o comando.
//
// Por isso as duas operações continuam separadas: este script precisa de
// credencial e de rede; filtrar-bases.mjs é transformação local pura e roda em
// toda publicação, dentro do Netlify.
//
// Só entram itens com publicado = true E ativo = true. Item arquivado continua
// no Firestore para resolver o nome em planos antigos, mas não deve aparecer no
// seletor de novos planos.
//
// MODO DE BUILD (--se-possivel) — a opção C, decidida em 25/08/2026 para o
// catálogo de exercícios e generalizada aqui para toda base.
//
// Sem a bandeira, este script é ferramenta de linha de comando: falta de
// credencial, ou consulta vazia onde o arquivo-fonte já tinha itens, é erro de
// quem digitou, e abortar é a resposta certa.
//
// COM a bandeira, ele roda dentro do build do Netlify, e a régua muda: cada
// base é uma base de domínio, não o site inteiro. Derrubar a publicação porque
// o Firestore piscou, ou porque UMA base teve consulta vazia, seria
// desproporcional. Então toda falha vira aviso, aquela base específica é pulada
// e o arquivo-fonte COMMITADO permanece como estava — que é a reserva. As
// demais bases seguem processadas normalmente: uma instabilidade não deve
// derrubar quem está bem.
//
// É isso que dissolve o impasse da seção 7 da especificação do catálogo: a
// frescura vem do banco quando ele responde, e a resiliência vem do arquivo
// versionado quando ele não responde. Nenhuma das duas opções originais dava
// as duas coisas.
//
// ARTEFATO DURÁVEL. Roda a cada publicação de lote revisado, e a cada build do
// site (--se-possivel, sem --base: todas as bases da tabela).
//
// Uso:
//   npm run catalogo:exercicios     (equivale a --base=exercicios)
//   npm run catalogo:alimentos      (equivale a --base=alimentos)
//   node scripts/gerar-base.mjs --base=exercicios
//   node scripts/gerar-base.mjs --se-possivel        (todas as bases, modo build)
// -----------------------------------------------------------------------------

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { conectar, abortar, RAIZ_PROJETO } from './_firestore-cli.mjs';

// ── TABELA DE BASES ──────────────────────────────────────────────────────────
// `campos` mapeia o documento do Firestore para o item do arquivo-fonte. O que
// não estiver aqui não chega ao painel — o que é deliberado: campos de auditoria
// e de procedência ficam no banco, não no arquivo servido ao navegador.
//
// `revisado` é acrescentado por este script em todas as bases, a partir de
// revisadoPor. É a marca que permite ao filtro recortar depois, sem consultar o
// banco de novo.
const BASES = {
  exercicios: {
    rotulo: 'catálogo de exercícios',
    colecao: 'exercises',
    saida: 'scripts/dados-exercicios/catalogo-fonte.json',
    chave: 'exercicios',
    ordenarPor: 'nome_pt',
    // O identificador do documento é o vínculo estável gravado nos planos.
    // O nome NUNCA é a chave.
    mapear: (id, d) => ({
      id,
      nome_pt: d.nome_pt,
      nome_en: d.nome_en ?? null,
      instrucao_pt: d.instrucao_pt ?? '',
      instrucao_en: d.instrucao_en ?? null,
      grupo: d.grupo,
      musculoPrimario: d.musculoPrimario,
      musculosSecundarios: d.musculosSecundarios ?? [],
      equipamento: d.equipamento,
      mecanica: d.mecanica ?? null,
      nivel: d.nivel ?? null,
    }),
  },
  alimentos: {
    rotulo: 'base de alimentos',
    colecao: 'foods',
    saida: 'scripts/dados-alimentos/alimentos-fonte.json',
    chave: 'alimentos',
    ordenarPor: 'nomeExibicao',
    // Campos definidos no repasse da frente de alimentos. `medidaCaseira` nasce
    // nula em todos os 597 itens: a TACO não fornece esse dado, e preenchê-lo é
    // trabalho de curadoria do Coach.
    mapear: (id, d) => ({
      id,
      nomeExibicao: d.nomeExibicao,
      nomeBusca: d.nomeBusca ?? null,
      categoria: d.categoria ?? null,
      macros: d.macros ?? null,
      medidaCaseira: d.medidaCaseira ?? null,
    }),
  },
};

const argv = process.argv.slice(2);
const argBase = argv.find((a) => a.startsWith('--base='));
const ID = argBase ? argBase.split('=')[1] : null;
const SE_POSSIVEL = argv.includes('--se-possivel');

if (ID && !BASES[ID]) {
  abortar(`base desconhecida: "${ID}".\n  Use --base=<${Object.keys(BASES).join('|')}>, ou omita para gerar todas.`);
}
// Sem --base: todas — é o modo que o build usa, para que uma base nova só
// precise de uma linha na tabela acima, igual a filtrar-bases.mjs.
const ALVOS = ID ? [[ID, BASES[ID]]] : Object.entries(BASES);

/**
 * Guarda contra apagar uma base em silêncio. Consulta que volta vazia não é
 * sinônimo de base vazia: pode ser coleção errada, regra nova, credencial de
 * outro projeto. Sobrescrever um arquivo-fonte com itens por zero deixaria o
 * site sem essa base sem nada acusar, e o arquivo versionado — a reserva —
 * teria sido destruído junto.
 *
 * Devolve o número de itens que o arquivo já tinha (0 se não existir ou for
 * ilegível — nesse caso não há nada a proteger).
 */
function quantidadeAnterior(caminho, chave) {
  if (!existsSync(caminho)) return 0;
  try {
    return (JSON.parse(readFileSync(caminho, 'utf8'))[chave] ?? []).length;
  } catch {
    return 0; // arquivo ilegível conta como vazio: nada a proteger.
  }
}

async function gerarUma(db, id, base) {
  const marca = `[${id}]`;
  const saida = resolve(RAIZ_PROJETO, base.saida);

  const snap = await db.collection(base.colecao).where('publicado', '==', true).get();
  const itens = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d.ativo === false) return;
    itens.push({ revisado: Boolean(d.revisadoPor), ...base.mapear(doc.id, d) });
  });
  itens.sort((a, b) => String(a[base.ordenarPor] ?? '').localeCompare(String(b[base.ordenarPor] ?? ''), 'pt-BR'));

  const anterior = itens.length === 0 ? quantidadeAnterior(saida, base.chave) : 0;
  if (anterior > 0) {
    const recado = `${marca} consulta devolveu 0 itens, mas o arquivo-fonte tem ${anterior}. NÃO sobrescrito.`;
    if (SE_POSSIVEL) { console.warn(`\n${recado}\n`); return true; }
    abortar(`${recado}\n  Confira a coleção e o projeto da credencial antes de repetir.`);
    return false;
  }

  const saidaJson = { geradoEm: new Date().toISOString(), total: itens.length, [base.chave]: itens };
  mkdirSync(dirname(saida), { recursive: true });
  writeFileSync(saida, JSON.stringify(saidaJson), 'utf8');

  const kb = (Buffer.byteLength(JSON.stringify(saidaJson), 'utf8') / 1024).toFixed(1);
  const revisados = itens.filter((i) => i.revisado).length;
  console.log(`\n${marca} arquivo-fonte gerado — ${base.rotulo}: ${itens.length} item(ns), ${kb} KB`);
  console.log(`${marca}   revisados pelo Coach (chegam a produção): ${revisados}`);
  console.log(`${marca}   sem revisão (só homologação, com selo):   ${itens.length - revisados}`);
  console.log(`${marca}   arquivo: ${saida}`);
  if (!itens.length) console.log(`${marca}   ATENÇÃO: nenhum item publicado — a carga ainda não rodou.`);
  return true;
}

async function principal() {
  const db = conectar({ sePossivel: SE_POSSIVEL });
  // conectar() só devolve null quando sePossivel é true — sem a bandeira, ela
  // mesma já derrubou o processo. Sem banco, não há o que gerar para base
  // nenhuma: o build segue com todos os arquivos-fonte versionados como estão.
  if (!db) return;

  let houveFalhaDura = false;
  for (const [id, base] of ALVOS) {
    const ok = await gerarUma(db, id, base).catch((e) => {
      const recado = `[${id}] ${e?.message ?? e}`;
      if (SE_POSSIVEL) { console.warn(`\n  AVISO: ${recado}\n`); return true; }
      console.error(`\n  ERRO: ${recado}\n`);
      return false;
    });
    if (!ok) houveFalhaDura = true;
  }

  // Modo estrito com falha dura: sai aqui, antes do rodapé de "próximos
  // passos" — nada foi gravado para revisar, e imprimir esse convite depois de
  // um "ERRO" leria como se o processo tivesse dado certo.
  if (houveFalhaDura && !SE_POSSIVEL) process.exit(1);

  console.log('\nPróximos passos: revise o diff do(s) arquivo(s)-fonte, faça commit e publique.');
  console.log('O recorte por contexto acontece no build, em filtrar-bases.mjs.\n');
}

principal().catch((e) => abortar(e?.stack ?? String(e)));
