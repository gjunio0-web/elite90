// ELITE90 PRO · preparar-alimentos
// -----------------------------------------------------------------------------
// Passo 1 de 2 da carga da coleção foods/. Lê a planilha oficial da TACO
// (4ª edição revisada e ampliada, NEPA/UNICAMP, 2011) e emite o arquivo
// normalizado scripts/dados-alimentos/alimentos-taco.json.
//
// Este passo NÃO toca o Firestore. Roda offline, é reexecutável, e existe para
// que toda a esquisitice da planilha — fórmulas na coluna do identificador,
// categorias em linhas intercaladas, quatro códigos distintos de ausência de
// dado — seja resolvida e CONFERIDA antes de qualquer gravação.
//
// Contrato: especificação "Base de alimentos — esquema do documento e regras de
// carga", seções 2, 4 e 7.
//
// Decisões que este arquivo materializa:
//   • FONTE CANÔNICA É A PLANILHA, não o PDF. A planilha traz o valor bruto
//     (proteína do arroz integral cozido = 2,58825 g); o PDF traz 2,6. O
//     arredondamento acontece na exibição, nunca aqui.
//   • AUSÊNCIA DE DADO TEM QUATRO ESTADOS, e nenhum vira zero. 'NA' é não
//     aplicável, 'Tr' é traço, '*' é análise em reavaliação, célula vazia é
//     análise não solicitada. Colapsar os quatro em zero produziria soma de
//     macros silenciosamente errada num plano nutricional.
//   • FALHA ALTA. Valor malformado aborta com linha, coluna e nome do alimento.
//     Há um defeito conhecido na planilha publicada (item 373, piridoxina,
//     valor ",0,02"); ele deve interromper a execução, não ser aproximado.
//   • SEM DEPENDÊNCIA EXTERNA. O leitor de planilha abaixo abre o arquivo como
//     o pacote zip que ele é e lê os valores em CACHE das fórmulas. Um leitor
//     que ignore o cache devolve a coluna do número do alimento inteira vazia.
//
// Uso:
//   node scripts/dados-alimentos/preparar-alimentos.mjs
//   node scripts/dados-alimentos/preparar-alimentos.mjs --planilha=/caminho/Taco-4a-Edicao.xlsx
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argPlanilha = args.find((a) => a.startsWith('--planilha='));
const CAMINHO_PLANILHA = argPlanilha
  ? resolve(argPlanilha.split('=').slice(1).join('='))
  : join(AQUI, 'Taco-4a-Edicao.xlsx');
const SAIDA = join(AQUI, 'alimentos-taco.json');

const ABA_PRINCIPAL = 'CMVCol taco3'; // o nome da aba diz "taco3" por herança
                                      // da 3ª versão; o conteúdo é o da 4ª
                                      // edição, com 597 alimentos.
const TOTAL_ESPERADO = 597;

function abortar(msg) {
  console.error(`\n  ERRO: ${msg}\n`);
  process.exit(1);
}

// ── Leitor de planilha ───────────────────────────────────────────────────────
// Um .xlsx é um pacote zip com XML dentro. Só é preciso o diretório central do
// zip, a tabela de textos compartilhados e a aba desejada.

function abrirZip(buf) {
  const assinatura = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const fim = buf.lastIndexOf(assinatura);
  if (fim < 0) abortar('arquivo não é um .xlsx válido (fim do diretório zip não encontrado)');
  const quantidade = buf.readUInt16LE(fim + 10);
  let cursor = buf.readUInt32LE(fim + 16);
  const entradas = new Map();
  for (let i = 0; i < quantidade; i++) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) abortar('diretório do zip corrompido');
    const compressao = buf.readUInt16LE(cursor + 10);
    const tamanho = buf.readUInt32LE(cursor + 20);
    const nomeLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const comentLen = buf.readUInt16LE(cursor + 32);
    const inicioLocal = buf.readUInt32LE(cursor + 42);
    const nome = buf.toString('utf8', cursor + 46, cursor + 46 + nomeLen);
    const localNomeLen = buf.readUInt16LE(inicioLocal + 26);
    const localExtraLen = buf.readUInt16LE(inicioLocal + 28);
    const inicioDados = inicioLocal + 30 + localNomeLen + localExtraLen;
    const dados = buf.subarray(inicioDados, inicioDados + tamanho);
    entradas.set(nome, compressao === 8 ? inflateRawSync(dados) : dados);
    cursor += 46 + nomeLen + extraLen + comentLen;
  }
  return entradas;
}

const ENTIDADES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
function desescapar(s) {
  return s
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTIDADES[m])
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** Textos compartilhados: a tabela onde o Excel guarda as cadeias repetidas. */
function lerTextosCompartilhados(entradas) {
  const xml = entradas.get('xl/sharedStrings.xml');
  if (!xml) return [];
  const texto = xml.toString('utf8');
  const itens = texto.match(/<si\b[\s\S]*?<\/si>|<si\b[^>]*\/>/g) ?? [];
  return itens.map((si) => {
    const partes = si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [];
    return partes.map((t) => desescapar(t.replace(/<t\b[^>]*>|<\/t>/g, ''))).join('');
  });
}

/** Caminho interno da aba, resolvido pelo nome visível. */
function caminhoDaAba(entradas, nomeVisivel) {
  const wb = entradas.get('xl/workbook.xml')?.toString('utf8');
  if (!wb) abortar('planilha sem xl/workbook.xml');
  const marcas = wb.match(/<sheet\b[^>]*\/>|<sheet\b[^>]*>/g) ?? [];
  const rels = entradas.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  for (const marca of marcas) {
    const nome = desescapar(marca.match(/name="([^"]*)"/)?.[1] ?? '');
    if (nome !== nomeVisivel) continue;
    const rid = marca.match(/r:id="([^"]*)"/)?.[1];
    // A ordem dos atributos varia conforme o programa que gravou o arquivo:
    // Excel escreve Id antes de Target, outros escrevem o contrário. Por isso
    // cada relação é lida inteira, e não por posição.
    let alvo = null;
    for (const rel of rels.match(/<Relationship\b[^>]*\/>|<Relationship\b[^>]*>/g) ?? []) {
      if (rel.match(/\bId="([^"]*)"/)?.[1] !== rid) continue;
      alvo = desescapar(rel.match(/\bTarget="([^"]*)"/)?.[1] ?? '');
      break;
    }
    if (!alvo) abortar(`aba "${nomeVisivel}" encontrada, mas sem alvo no arquivo de relações`);
    return alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`;
  }
  abortar(`aba "${nomeVisivel}" não encontrada na planilha. Abas disponíveis: ` +
    marcas.map((m) => desescapar(m.match(/name="([^"]*)"/)?.[1] ?? '?')).join(', '));
}

function colunaParaIndice(ref) {
  const letras = ref.match(/^[A-Z]+/)?.[0] ?? '';
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n; // 1 = A
}

/**
 * Lê a aba como matriz de linhas. Cada célula vira { v, formula } onde v é o
 * valor em cache — que é o que interessa: a coluna do número do alimento
 * guarda fórmulas (=A5+1), não valores digitados.
 */
function lerAba(entradas, caminho, textos) {
  const xml = entradas.get(caminho)?.toString('utf8');
  if (!xml) abortar(`aba não encontrada no pacote: ${caminho}`);
  const linhas = [];
  const marcasLinha = xml.match(/<row\b[\s\S]*?<\/row>|<row\b[^>]*\/>/g) ?? [];
  for (const linhaXml of marcasLinha) {
    const numero = Number(linhaXml.match(/\br="(\d+)"/)?.[1] ?? 0);
    const celulas = [];
    const marcasCelula = linhaXml.match(/<c\b[\s\S]*?<\/c>|<c\b[^>]*\/>/g) ?? [];
    for (const celulaXml of marcasCelula) {
      const ref = celulaXml.match(/\br="([A-Z]+\d+)"/)?.[1];
      if (!ref) continue;
      const coluna = colunaParaIndice(ref);
      const tipo = celulaXml.match(/\bt="([^"]*)"/)?.[1] ?? 'n';
      const temFormula = /<f[\s>]/.test(celulaXml) || /<f\/>/.test(celulaXml);
      let valor = null;
      if (tipo === 'inlineStr') {
        const partes = celulaXml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [];
        valor = partes.length ? partes.map((t) => desescapar(t.replace(/<t\b[^>]*>|<\/t>/g, ''))).join('') : null;
      } else {
        const bruto = celulaXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
        // <v></v> vazio significa fórmula sem valor em cache. Sem esta guarda,
        // Number('') devolveria 0 e a coluna do número do alimento viraria uma
        // fileira de zeros — dado errado, silencioso, e difícil de rastrear.
        if (bruto != null && bruto !== '') {
          if (tipo === 's') valor = textos[Number(bruto)] ?? null;
          else if (tipo === 'str' || tipo === 'e') valor = desescapar(bruto);
          else if (tipo === 'b') valor = bruto === '1';
          else valor = Number(bruto);
        }
      }
      celulas[coluna] = { v: valor, formula: temFormula };
    }
    linhas[numero] = celulas;
  }
  return linhas;
}

// ── Mapa de colunas da aba principal ─────────────────────────────────────────
// Conferido na planilha publicada. A coluna 14 repete o número do alimento
// (artifício de paginação do PDF) e é ignorada de propósito.
const COLUNAS = {
  numero: 1, descricao: 2,
  umidadePct: 3, energiaKcal: 4, energiaKj: 5, proteinaG: 6, lipideosG: 7,
  colesterolMg: 8, carboidratoG: 9, fibraG: 10, cinzasG: 11, calcioMg: 12,
  magnesioMg: 13, manganesMg: 15, fosforoMg: 16, ferroMg: 17, sodioMg: 18,
  potassioMg: 19, cobreMg: 20, zincoMg: 21, retinolMcg: 22, reMcg: 23,
  raeMcg: 24, tiaminaMg: 25, riboflavinaMg: 26, piridoxinaMg: 27,
  niacinaMg: 28, vitaminaCMg: 29,
};
const NUTRIENTES = Object.keys(COLUNAS).filter((k) => k !== 'numero' && k !== 'descricao');
const MACROS = ['energiaKcal', 'proteinaG', 'carboidratoG', 'lipideosG'];

// Os 16 grupos da TACO, em linhas intercaladas na planilha.
const CATEGORIAS = new Set([
  'Cereais e derivados', 'Verduras, hortaliças e derivados', 'Frutas e derivados',
  'Gorduras e óleos', 'Pescados e frutos do mar', 'Carnes e derivados',
  'Leite e derivados', 'Bebidas (alcoólicas e não alcoólicas)', 'Ovos e derivados',
  'Produtos açucarados', 'Miscelâneas', 'Outros alimentos industrializados',
  'Alimentos preparados', 'Leguminosas e derivados', 'Nozes e sementes',
]);

// ── Exceções declaradas ──────────────────────────────────────────────────────
// A PLANILHA DO NEPA NUNCA É EDITADA. Ela é publicação de terceiro e é a fonte
// primária: alterá-la converteria a fonte em cópia local modificada e faria o
// resumo criptográfico gravado em cada documento deixar de bater com o do
// arquivo publicado. Quando um valor da planilha não puder ser lido como está,
// a correção é declarada AQUI — versionada no Git, visível no relatório, com a
// justificativa ao lado.
//
// Cada entrada precisa dizer exatamente o que espera encontrar na célula. Se a
// planilha for republicada e a célula mudar, a exceção fica obsoleta e a
// execução aborta, em vez de aplicar em silêncio uma correção que não vale mais.
// Duas naturezas de exceção, distinguidas por `campo`:
//   campo: 'nome'  → corrige a descrição do alimento
//   qualquer outro → corrige um nutriente, com `estado` associado
const EXCECOES_DECLARADAS = [
  {
    numeroAlimento: 373,
    campo: 'piridoxinaMg',
    // Célula AA424, gravada como texto compartilhado de índice 425, com o
    // conteúdo literal abaixo. Verificado no XML bruto do arquivo publicado
    // (sha256 a66b8ec5…) em 23/08/2026.
    esperadoNaPlanilha: ',0,02',
    valor: 0.02,
    estado: 'ok',
    confirmadoNaFonte: true,
    fonteDaConferencia: 'PDF da 4ª edição, página 54, Tabela 1 (vitaminas): ' +
      '"373 Tr 158 1,8 65 250 0,08 3,7 Tr Tr Tr Tr 0,04 0,02 0,91". ' +
      'A riboflavina (0,04) e a niacina (0,91) que ladeiam a coluna conferem com a planilha, ' +
      'o que prende a leitura na coluna certa.',
    justificativa: 'Erro de digitação na planilha publicada: vírgula sobrando à esquerda do valor.',
  },
  {
    numeroAlimento: 540,
    campo: 'nome',
    // Célula B620, texto compartilhado de índice 714, com o conteúdo literal
    // 'L'. O alimento existe e tem todos os valores; só a descrição se perdeu.
    esperadoNaPlanilha: 'L',
    valor: 'Feijoada',
    confirmadoNaFonte: true,
    fonteDaConferencia: 'PDF da 4ª edição, página 63, Tabela 1 (centesimal): ' +
      '"540 Feijoada 71,8 117 489 8,7 6,5 22 11,6 5,1 1,4 32 32". ' +
      'Os valores conferem com a planilha, e a posição alfabética entre ' +
      '"Feijão tropeiro mineiro" (539) e "Frango, com açafrão" (541) confirma.',
    justificativa: 'Descrição perdida na planilha publicada, reduzida à letra "L".',
  },
];

/** Exceção de nome, se houver, para o alimento. */
function excecaoDeNome(numeroAlimento) {
  return EXCECOES_DECLARADAS.find((e) => e.numeroAlimento === numeroAlimento && e.campo === 'nome') ?? null;
}

// Nome mais curto da 4ª edição, fora exceção: "Shoyu", com 5 caracteres. O piso
// de 3 é folgado de propósito — não serve para julgar nome curto legítimo, e sim
// para barrar descrição truncada. Foi a ausência desta guarda que deixou o
// alimento 540 chegar ao ensaio em seco chamando-se "L".
const NOME_MINIMO = 3;

// Carboidrato da TACO é obtido POR DIFERENÇA — o que sobra depois de descontar
// água, proteína, lipídeo e cinzas. Em alimento proteico, quando não sobra
// nada, o arredondamento das parcelas empurra o resultado para baixo de zero.
// O PDF publica zero nesses casos; a planilha guarda o resíduo do cálculo.
// Quatro alimentos da 4ª edição caem aqui — Corimba cru, Tucunaré filé
// congelado cru, Capa de contra-filé sem gordura grelhada e Fígado de frango
// cru — nenhum passando de cinco centésimos de grama.
const TOLERANCIA_DIFERENCA = 0.5;

// ── Interpretação de célula de nutriente ─────────────────────────────────────
// Espelha a legenda da própria planilha.
function interpretar(celula, onde, campo, numeroAlimento, registro) {
  const bruto = celula?.v;

  const excecao = EXCECOES_DECLARADAS.find(
    (e) => e.numeroAlimento === numeroAlimento && e.campo === campo,
  );
  if (excecao) {
    const naCelula = bruto === null || bruto === undefined ? '' : String(bruto).trim();
    if (naCelula !== excecao.esperadoNaPlanilha) {
      abortar(`${onde}: exceção declarada para ${campo} não confere com a planilha.\n` +
        `  Esperado na célula: ${JSON.stringify(excecao.esperadoNaPlanilha)}\n` +
        `  Encontrado:         ${JSON.stringify(naCelula)}\n` +
        '  A planilha mudou. Reveja a exceção em EXCECOES_DECLARADAS antes de seguir —\n' +
        '  aplicar a correção antiga sobre um dado novo seria pior que abortar.');
    }
    registro.excecoes.push({ ...excecao, onde });
    return { v: excecao.valor, st: excecao.estado, excecaoDeclarada: true };
  }

  if (bruto === null || bruto === undefined) return { v: null, st: 'nao_solicitada' };
  if (typeof bruto === 'number') {
    if (!Number.isFinite(bruto)) abortar(`${onde}: valor não finito em ${campo}`);
    if (bruto < 0) {
      if (campo === 'carboidratoG' && bruto > -TOLERANCIA_DIFERENCA) {
        registro.ajustes.push({ onde, campo, valorNaPlanilha: bruto });
        return { v: 0, st: 'ok', ajustePorDiferenca: true };
      }
      abortar(`${onde}: valor negativo em ${campo}: ${bruto}\n` +
        '  A tolerância de carboidrato por diferença não se aplica aqui: ou o campo é outro,\n' +
        `  ou o resíduo passa de ${TOLERANCIA_DIFERENCA} g. Conferir na fonte antes de seguir.`);
    }
    return { v: bruto, st: 'ok' };
  }
  const texto = String(bruto).trim();
  if (texto === '') return { v: null, st: 'nao_solicitada' };
  if (texto === 'NA') return { v: null, st: 'nao_aplicavel' };
  if (texto === 'Tr') return { v: null, st: 'traco' };
  if (texto === '*') return { v: null, st: 'em_reavaliacao' };
  // Qualquer outra coisa é dado malformado sem exceção declarada. Não se
  // aproxima, não se adivinha: aborta.
  abortar(`${onde}: valor não reconhecido em ${campo}: ${JSON.stringify(texto)}\n` +
    '  A planilha do NEPA NÃO deve ser editada — ela é a fonte primária.\n' +
    '  Se a leitura correta do valor puder ser confirmada na fonte, declare uma entrada\n' +
    '  em EXCECOES_DECLARADAS, no alto deste arquivo, com a justificativa.');
}

function normalizarBusca(nome) {
  return nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Execução ─────────────────────────────────────────────────────────────────
function principal() {
  if (!existsSync(CAMINHO_PLANILHA)) {
    abortar(`planilha não encontrada: ${CAMINHO_PLANILHA}\n` +
      '  Baixe de https://nepa.unicamp.br (Publicações → Tabela TACO (Excel)) e coloque\n' +
      '  em scripts/dados-alimentos/Taco-4a-Edicao.xlsx, ou use --planilha=<caminho>.');
  }
  const buffer = readFileSync(CAMINHO_PLANILHA);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const entradas = abrirZip(buffer);
  const textos = lerTextosCompartilhados(entradas);
  const linhas = lerAba(entradas, caminhoDaAba(entradas, ABA_PRINCIPAL), textos);

  const registros = [];
  const vistosNumero = new Map();
  const relatorio = { categorias: new Map(), semMacros: [], estados: {}, excecoes: [], ajustes: [] };
  let categoriaAtual = null;
  let semCache = 0;

  for (let n = 1; n < linhas.length; n++) {
    const linha = linhas[n];
    if (!linha) continue;
    const cNumero = linha[COLUNAS.numero];
    const cDescricao = linha[COLUNAS.descricao];
    // Espaços duplos são colapsados: a 4ª edição traz dois casos (itens 315 e
    // 591) em que o buraco apareceria na tela do Coach. O nome segue sendo o da
    // TACO — o que muda é só o espaçamento.
    const descricao = typeof cDescricao?.v === 'string'
      ? cDescricao.v.replace(/\s+/g, ' ').trim()
      : null;

    // Linha de grupo: nome de categoria na primeira coluna, sem descrição.
    if (typeof cNumero?.v === 'string' && !descricao) {
      const rotulo = cNumero.v.trim();
      if (CATEGORIAS.has(rotulo)) categoriaAtual = rotulo;
      continue;
    }
    // Cabeçalho repetido, legenda e linha vazia: ruído de paginação.
    if (typeof cNumero?.v !== 'number') {
      if (cNumero?.formula && cNumero.v === null) semCache++;
      continue;
    }
    if (!descricao) continue;

    const numero = cNumero.v;
    const onde = `linha ${n} (item ${numero}: ${descricao})`;
    if (!Number.isInteger(numero)) abortar(`${onde}: número do alimento não é inteiro`);
    if (vistosNumero.has(numero)) abortar(`${onde}: número do alimento repetido, já visto em ${vistosNumero.get(numero)}`);
    vistosNumero.set(numero, onde);
    if (!categoriaAtual) abortar(`${onde}: alimento antes de qualquer linha de grupo — a categoria seria indefinida`);

    // Correção de nome declarada, se houver.
    let nome = descricao;
    const excNome = excecaoDeNome(numero);
    if (excNome) {
      if (descricao !== excNome.esperadoNaPlanilha) {
        abortar(`${onde}: exceção de nome declarada não confere com a planilha.\n` +
          `  Esperado na célula: ${JSON.stringify(excNome.esperadoNaPlanilha)}\n` +
          `  Encontrado:         ${JSON.stringify(descricao)}\n` +
          '  A planilha mudou. Reveja a exceção em EXCECOES_DECLARADAS antes de seguir.');
      }
      nome = excNome.valor;
      relatorio.excecoes.push({ ...excNome, onde });
    } else if (descricao.length < NOME_MINIMO) {
      abortar(`${onde}: nome de alimento com menos de ${NOME_MINIMO} caracteres: ${JSON.stringify(descricao)}\n` +
        '  Descrição truncada na planilha. NÃO edite a planilha do NEPA: confira o nome no PDF\n' +
        '  da mesma edição e declare uma exceção de nome em EXCECOES_DECLARADAS.');
    }

    const nutrientes = {};
    for (const campo of NUTRIENTES) {
      const estado = interpretar(linha[COLUNAS[campo]], onde, campo, numero, relatorio);
      nutrientes[campo] = estado;
      relatorio.estados[estado.st] = (relatorio.estados[estado.st] ?? 0) + 1;
    }

    // Bloco derivado de exibição e cálculo. 'traco' vira zero AQUI e somente
    // aqui; o dado íntegro permanece em nutrientes.
    const macrosCompletos = MACROS.every((m) => nutrientes[m].st === 'ok' || nutrientes[m].st === 'traco');
    const arredondar = (x) => Math.round(x * 10) / 10;
    const macros = macrosCompletos ? {
      kcal: Math.round(nutrientes.energiaKcal.v ?? 0),
      proteinaG: arredondar(nutrientes.proteinaG.v ?? 0),
      carboidratoG: arredondar(nutrientes.carboidratoG.v ?? 0),
      lipideosG: arredondar(nutrientes.lipideosG.v ?? 0),
    } : null;
    const macrosTemTraco = MACROS.some((m) => nutrientes[m].st === 'traco');
    if (!macrosCompletos) {
      relatorio.semMacros.push(`${nome} → ` +
        MACROS.filter((m) => nutrientes[m].st !== 'ok' && nutrientes[m].st !== 'traco')
          .map((m) => `${m}: ${nutrientes[m].st}`).join(', '));
    }

    relatorio.categorias.set(categoriaAtual, (relatorio.categorias.get(categoriaAtual) ?? 0) + 1);
    registros.push({
      numeroAlimento: numero,
      linha: n,
      nome,
      nomeBusca: normalizarBusca(nome),
      categoria: categoriaAtual,
      base: 'por100g',
      nutrientes,
      macros,
      macrosTemTraco,
      publicado: macrosCompletos,
    });
  }

  const naoAplicadas = EXCECOES_DECLARADAS.filter(
    (e) => !relatorio.excecoes.some((a) => a.numeroAlimento === e.numeroAlimento && a.campo === e.campo),
  );
  if (naoAplicadas.length) {
    abortar('exceção declarada que não encontrou a célula correspondente:\n' +
      naoAplicadas.map((e) => `  item ${e.numeroAlimento}, campo ${e.campo}`).join('\n') +
      '\n  Ou o alimento saiu da planilha, ou o número mudou. Exceção órfã é dívida escondida:\n' +
      '  reveja EXCECOES_DECLARADAS antes de seguir.');
  }

  if (semCache) {
    abortar(`${semCache} célula(s) de fórmula sem valor em cache na coluna do número do alimento.\n` +
      '  A planilha foi reescrita por um programa que não gravou o cache das fórmulas.\n' +
      '  Abra e salve o arquivo no Excel ou no LibreOffice e reexecute.');
  }
  if (registros.length !== TOTAL_ESPERADO) {
    abortar(`foram lidos ${registros.length} alimentos, e a 4ª edição tem ${TOTAL_ESPERADO}.\n` +
      '  A planilha não é a esperada, ou o mapa de colunas mudou. Conferir antes de seguir.');
  }
  const numeros = registros.map((r) => r.numeroAlimento);
  const esperados = Array.from({ length: TOTAL_ESPERADO }, (_, i) => i + 1);
  if (numeros.join(',') !== esperados.join(',')) {
    abortar('a sequência do número do alimento tem falha ou está fora de ordem.');
  }
  const duplicados = [...registros.reduce((m, r) => m.set(r.nomeBusca, (m.get(r.nomeBusca) ?? 0) + 1), new Map())]
    .filter(([, c]) => c > 1);
  if (duplicados.length) {
    abortar('nome normalizado repetido, o que quebraria a busca por prefixo: ' +
      duplicados.map(([k]) => k).join('; '));
  }

  const saida = {
    fonte: 'taco-4ed-2011',
    referencia: 'NEPA-UNICAMP. Tabela Brasileira de Composição de Alimentos — TACO. 4ª ed. rev. e ampl. Campinas, 2011.',
    // basename, e não corte manual por '/': no Windows o separador é '\\', e o
    // corte gravava o caminho completo da máquina de quem gerou dentro de um
    // arquivo versionado.
    arquivo: { nome: basename(CAMINHO_PLANILHA), sha256, aba: ABA_PRINCIPAL },
    geradoEm: new Date().toISOString(),
    total: registros.length,
    excecoesAplicadas: relatorio.excecoes.map((e) => ({
      numeroAlimento: e.numeroAlimento, campo: e.campo, valor: e.valor,
      justificativa: e.justificativa, confirmadoNaFonte: e.confirmadoNaFonte,
      fonteDaConferencia: e.fonteDaConferencia ?? null,
    })),
    ajustesPorDiferenca: relatorio.ajustes.map((a) => ({ onde: a.onde, valorNaPlanilha: a.valorNaPlanilha })),
    alimentos: registros,
  };
  writeFileSync(SAIDA, JSON.stringify(saida, null, 2) + '\n', 'utf8');

  console.log('\n══ PREPARAÇÃO DA BASE DE ALIMENTOS (TACO 4ª edição) ══');
  console.log(`Planilha:     ${CAMINHO_PLANILHA}`);
  console.log(`sha256:       ${sha256}`);
  console.log(`Alimentos:    ${registros.length}`);
  console.log(`Publicáveis:  ${registros.filter((r) => r.publicado).length}`);
  console.log(`Com traço nos macros: ${registros.filter((r) => r.macrosTemTraco).length}`);
  console.log('\nPor categoria:');
  for (const [cat, qtd] of relatorio.categorias) console.log(`  ${String(qtd).padStart(4)}  ${cat}`);
  console.log('\nEstados dos nutrientes:');
  for (const [st, qtd] of Object.entries(relatorio.estados).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(qtd).padStart(6)}  ${st}`);
  }
  if (relatorio.ajustes.length) {
    console.log(`\nCarboidrato por diferença ajustado a zero (${relatorio.ajustes.length}):`);
    relatorio.ajustes.forEach((a) => console.log(`  · ${a.onde} → ${a.valorNaPlanilha}`));
    console.log('  Resíduo de arredondamento do cálculo por diferença. O PDF publica zero.');
  }
  if (relatorio.excecoes.length) {
    console.log(`\nExceções declaradas aplicadas (${relatorio.excecoes.length}):`);
    relatorio.excecoes.forEach((e) => {
      console.log(`  · item ${e.numeroAlimento}, ${e.campo}: ${JSON.stringify(e.esperadoNaPlanilha)} → ${JSON.stringify(e.valor)}`);
      console.log(`    ${e.justificativa}`);
      if (e.confirmadoNaFonte) console.log(`    Conferido: ${e.fonteDaConferencia}`);
      else console.log('    ATENÇÃO: valor NÃO conferido no PDF da mesma edição. Pendência aberta.');
    });
    console.log('  A planilha do NEPA permanece intacta.');
  }
  if (relatorio.semMacros.length) {
    console.log(`\nNão publicáveis — sem os quatro macros (${relatorio.semMacros.length}):`);
    relatorio.semMacros.forEach((l) => console.log('  - ' + l));
    console.log('  Entram na coleção com publicado: false. Não aparecem na busca do painel.');
  }
  console.log(`\nArquivo gerado: ${SAIDA}`);
  console.log('Confira o conteúdo antes de rodar a carga.\n');
}

principal();
