// ELITE90 PRO · carregar-alimentos
// -----------------------------------------------------------------------------
// Passo 2 de 2 da carga da coleção foods/ do Firestore, a partir do arquivo
// normalizado scripts/dados-alimentos/alimentos-taco.json, emitido pelo
// preparar-alimentos.mjs.
//
// Contrato: especificação "Base de alimentos — esquema do documento e regras de
// carga", seções 3, 4 e 7.
//   • ENSAIO EM SECO POR PADRÃO. Só grava com --commit.
//   • IDEMPOTENTE: a chave de reconciliação é fonte + origem.numeroAlimento,
//     nunca o nome. Reexecutar não duplica; atualiza o que mudou e cria o que
//     falta.
//   • CHAVE DO DOCUMENTO É UM IDENTIFICADOR PRÓPRIO, gerado aqui. O número do
//     alimento da TACO não serve: na planilha ele é uma fórmula (=A5+1), ou
//     seja, consequência da posição da linha. Reordenar a planilha renumeraria
//     tudo. Os planos referenciam o identificador próprio, e só ele.
//   • publicado: vem do preparador. Item sem os quatro macros entra com
//     publicado: false — não aparece na busca do painel, e a ausência fica
//     nomeada no relatório. O que separa homologação de produção NÃO é este
//     campo, e sim revisadoPor.
//   • REEXECUÇÃO NÃO APAGA TRABALHO DO COACH. O script guarda, em
//     origem.snapshotCarga, o retrato do que ele mesmo escreveu. Na reexecução
//     compara três pontas — arquivo, banco e snapshot — e só sobrescreve o que
//     ninguém editou pela tela. Divergência dos dois lados vira conflito
//     relatado, não decisão silenciosa.
//   • MEDIDA CASEIRA NUNCA É TOCADA POR REEXECUÇÃO. A TACO não fornece esse
//     dado; ele é curadoria, e curadoria não se perde por rodar um script de
//     novo.
//   • AMBIENTE: projeto de PRODUÇÃO, uma vez só. A base de alimentos é conteúdo
//     durável, e a curadoria do Coach precisa viver onde o Coach trabalha. O
//     ambiente de qualidade não recebe carga própria: consome o mesmo
//     arquivo-fonte versionado, com o portão de revisão aberto.
//   • ALIMENTO NUNCA É EXCLUÍDO. Referenciado por plano histórico, vira
//     inativo (ativo: false), some da busca e continua resolvendo nos planos
//     antigos.
//
// Uso:
//   node scripts/carregar-alimentos.mjs                 # ensaio em seco
//   node scripts/carregar-alimentos.mjs --commit        # grava
//   node scripts/carregar-alimentos.mjs --forcar --commit  # exceção: reinicia
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import { normalizarNomeBusca } from '@elite90/busca';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = process.cwd();
const ARQUIVO = existsSync(join(AQUI, 'dados-alimentos/alimentos-taco.json'))
  ? join(AQUI, 'dados-alimentos/alimentos-taco.json')
  : resolve(RAIZ, 'scripts/dados-alimentos/alimentos-taco.json');
const COLECAO = 'foods';
const AUTOR_SISTEMA = 'sistema:carga-inicial';
const FONTE = 'taco-4ed-2011';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
// Não existe --test aqui, e é de propósito. A base de alimentos é conteúdo
// durável: marcá-la com _test a colocaria na rota das rotinas de limpeza de
// homologação. Um sinalizador cujo único efeito seria esse é armadilha.
if (args.includes('--test')) {
  console.error('\n  ERRO: --test não existe nesta carga. A base de alimentos é conteúdo durável\n' +
    '  e não deve ser marcada como registro de homologação. Rode sem o sinalizador.\n');
  process.exit(1);
}
// --forcar não é rotina: existe para reiniciar a base de propósito, aceitando
// sobrescrever até o que o Coach editou pela tela.
const FORCAR = args.includes('--forcar');

export function abortar(msg) {
  console.error(`\n  ERRO: ${msg}\n`);
  process.exit(1);
}

// ── Leitura do arquivo preparado ─────────────────────────────────────────────
export function lerPreparado(caminho = ARQUIVO) {
  if (!existsSync(caminho)) {
    abortar(`arquivo preparado não encontrado: ${caminho}\n` +
      '  Rode antes: node scripts/dados-alimentos/preparar-alimentos.mjs');
  }
  const dados = JSON.parse(readFileSync(caminho, 'utf8'));
  if (dados.fonte !== FONTE) abortar(`fonte inesperada no arquivo preparado: ${dados.fonte}`);
  if (!Array.isArray(dados.alimentos) || !dados.alimentos.length) abortar('arquivo preparado sem alimentos');
  if (!dados.arquivo?.sha256) abortar('arquivo preparado sem o resumo criptográfico da planilha de origem');

  const vistos = new Map();
  for (const [i, a] of dados.alimentos.entries()) {
    const onde = `alimentos[${i}] (${a.nome ?? 'sem nome'})`;
    for (const campo of ['numeroAlimento', 'nome', 'nomeBusca', 'categoria', 'base', 'nutrientes']) {
      if (a[campo] === undefined || a[campo] === null || a[campo] === '') abortar(`${onde}: campo ausente: ${campo}`);
    }
    if (!Number.isInteger(a.numeroAlimento)) abortar(`${onde}: numeroAlimento não é inteiro`);
    if (vistos.has(a.numeroAlimento)) abortar(`${onde}: numeroAlimento repetido, já visto em ${vistos.get(a.numeroAlimento)}`);
    vistos.set(a.numeroAlimento, onde);
    if (a.publicado && !a.macros) abortar(`${onde}: marcado como publicável, mas sem bloco de macros`);
  }
  return dados;
}

// ── Firestore ────────────────────────────────────────────────────────────────
function conectar() {
  const bruto = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim();
  if (!bruto) abortar('FIREBASE_SERVICE_ACCOUNT_JSON não definida. Em ambiente local, carregue o .env.local antes de rodar.');
  let credencial;
  try {
    credencial = JSON.parse(bruto.startsWith('"') && bruto.endsWith('"') ? bruto.slice(1, -1) : bruto);
  } catch {
    abortar('FIREBASE_SERVICE_ACCOUNT_JSON não é um JSON válido.');
  }
  if (typeof credencial.private_key === 'string') {
    credencial.private_key = credencial.private_key.replace(/\\n/g, '\n');
  }
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(credencial) });
  return admin.firestore();
}

// ── Documento ────────────────────────────────────────────────────────────────
export function snapshotDe(item) {
  return {
    nome: item.nome,
    nomeExibicao: item.nome,
    categoria: item.categoria,
    base: item.base,
    nutrientes: item.nutrientes,
    macros: item.macros ?? null,
    macrosTemTraco: !!item.macrosTemTraco,
  };
}

export function documentoDe(item, meta, agora) {
  return {
    nome: item.nome,
    nomeExibicao: item.nome,
    nomeBusca: item.nomeBusca,
    categoria: item.categoria,
    base: item.base,
    nutrientes: item.nutrientes,
    macros: item.macros ?? null,
    macrosTemTraco: !!item.macrosTemTraco,
    // A TACO não fornece medida caseira — verificado no PDF e na planilha.
    // O campo nasce previsto e vazio para que a curadoria não exija mudança
    // de estrutura depois.
    medidaCaseira: null,
    publicado: !!item.publicado,
    ativo: true,
    fonte: FONTE,
    origem: {
      numeroAlimento: item.numeroAlimento,
      aba: meta.aba ?? null,
      linha: item.linha ?? null,
      arquivoSha256: meta.sha256,
      carregadoEm: agora,
      // Retrato do que ESTA carga escreveu. É a terceira ponta da comparação:
      // sem ele não há como distinguir "a planilha mudou" de "o Coach editou".
      snapshotCarga: snapshotDe(item),
    },
    revisadoPor: null,
    revisadoEm: null,
    criadoPor: AUTOR_SISTEMA,
    atualizadoPor: AUTOR_SISTEMA,
    criadoEm: agora,
    atualizadoEm: agora,
  };
}

// Campos que a carga pode reescrever numa reexecução. Deliberadamente fora
// desta lista: nomeBusca (derivado de nomeExibicao, recalculado junto),
// medidaCaseira, publicado, ativo, revisadoPor, revisadoEm, criadoPor, criadoEm.
// São curadoria, estado de revisão e autoria — reexecutar a carga não pode
// desfazer o trabalho que o Coach já fez.
export const CAMPOS_ATUALIZAVEIS = ['nome', 'nomeExibicao', 'categoria', 'base',
  'nutrientes', 'macros', 'macrosTemTraco'];

export function igual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ca = Object.keys(a), cb = Object.keys(b);
  if (ca.length !== cb.length) return false;
  return ca.every((k) => Object.prototype.hasOwnProperty.call(b, k) && igual(a[k], b[k]));
}

// normalizarBusca vem de @elite90/busca (normalizarNomeBusca), sem alteração
// de texto (M2-BUSCA-DE-ALIMENTOS-SEM-PONTUACAO-v1.1.md, 02/09/2026). Mantido
// com este nome como alias porque scripts/teste-reconciliacao.mjs importa
// normalizarBusca daqui — trocar o nome quebraria esse teste sem necessidade.
export const normalizarBusca = normalizarNomeBusca;

// COMPARAÇÃO DE TRÊS PONTAS
// -------------------------
// arquivo   = o que a planilha preparada diz hoje
// banco     = o que está gravado no Firestore
// snapshot  = o que ESTA carga escreveu da última vez
//
//   banco == snapshot  e  arquivo != snapshot  → ninguém editou: ATUALIZA
//   banco != snapshot  e  arquivo == snapshot  → o Coach editou: NÃO TOCA
//   banco != snapshot  e  arquivo != snapshot  → CONFLITO: relata e pula
//
// Sem snapshot (documento anterior a esta versão do script), o script trata o
// banco como possivelmente editado e prefere não tocar — a escolha conservadora
// é preservar o que já está lá, não sobrescrever por conveniência.
export function classificar(atual, novo) {
  const snap = atual?.origem?.snapshotCarga ?? null;
  const atualizar = [];
  const conflitos = [];
  const preservados = [];

  for (const campo of CAMPOS_ATUALIZAVEIS) {
    const noArquivo = novo[campo];
    const noBanco = atual[campo];
    if (igual(noArquivo, noBanco)) continue;

    if (!snap) { preservados.push(campo); continue; }
    const noSnap = snap[campo];
    const bancoIntocado = igual(noBanco, noSnap);
    const arquivoMudou = !igual(noArquivo, noSnap);

    if (bancoIntocado && arquivoMudou) atualizar.push(campo);
    else if (!bancoIntocado && !arquivoMudou) preservados.push(campo);
    else if (!bancoIntocado && arquivoMudou) conflitos.push(campo);
    else atualizar.push(campo); // banco intocado e arquivo igual ao snapshot: divergência residual
  }
  return { atualizar, conflitos, preservados };
}

// ── Execução ─────────────────────────────────────────────────────────────────
async function principal() {
  const preparado = lerPreparado();
  const meta = { sha256: preparado.arquivo.sha256, aba: preparado.arquivo.aba };
  const itens = preparado.alimentos;

  console.log('\n══ CARGA DA COLEÇÃO foods/ ══');
  console.log(`Modo:            ${COMMIT ? 'GRAVAÇÃO (--commit)' : 'ENSAIO EM SECO — nada será escrito'}`);
  console.log(`Arquivo:         ${ARQUIVO}`);
  console.log(`Planilha sha256: ${meta.sha256.slice(0, 16)}…`);
  console.log(`Registros:       ${itens.length}`);
  console.log(`Publicáveis:     ${itens.filter((i) => i.publicado).length}`);
  if (FORCAR) console.log('Forçar:          SIM — edições feitas no painel serão sobrescritas');
  console.log('');

  const db = conectar();
  const existentes = new Map();
  const snap = await db.collection(COLECAO).where('fonte', '==', FONTE).get();
  snap.forEach((doc) => {
    const d = doc.data();
    if (d?.origem?.numeroAlimento != null) existentes.set(d.origem.numeroAlimento, { id: doc.id, dados: d });
  });
  console.log(`Já na coleção:   ${snap.size} documento(s) desta fonte, ${existentes.size} com número de origem.\n`);

  const agora = admin.firestore.FieldValue.serverTimestamp();
  const relatorio = { criados: [], atualizados: [], inalterados: 0, conflitos: [], preservados: [], naoPublicados: [] };
  let lote = db.batch();
  let pendentes = 0;

  async function descarregar() {
    if (!COMMIT || pendentes === 0) { lote = db.batch(); pendentes = 0; return; }
    await lote.commit();
    lote = db.batch();
    pendentes = 0;
  }

  for (const item of itens) {
    const novo = documentoDe(item, meta, agora);
    const existente = existentes.get(item.numeroAlimento);

    // `naoPublicados` reflete o item RECÉM-LIDO da planilha, não o documento no
    // banco — os dois só divergem se alguém tiver editado `publicado` fora da
    // carga, o que não é operação prevista. Empurrado aqui, fora do if/else de
    // criação, para que uma reexecução continue relatando o estado real em vez
    // de mostrar zero só porque nada foi criado desta vez.
    if (!item.publicado) relatorio.naoPublicados.push(item.nome);

    if (!existente) {
      const id = randomUUID();
      if (COMMIT) { lote.set(db.collection(COLECAO).doc(id), novo); pendentes++; }
      relatorio.criados.push(`${item.nome} (${id.slice(0, 8)}…)`);
    } else {
      const { atualizar, conflitos, preservados } = FORCAR
        ? { atualizar: CAMPOS_ATUALIZAVEIS.filter((c) => !igual(existente.dados[c], novo[c])), conflitos: [], preservados: [] }
        : classificar(existente.dados, novo);

      if (conflitos.length) relatorio.conflitos.push(`${item.nome} → ${conflitos.join(', ')}`);
      if (preservados.length) relatorio.preservados.push(`${item.nome} → ${preservados.join(', ')}`);

      if (atualizar.length) {
        const patch = {
          atualizadoEm: agora,
          atualizadoPor: AUTOR_SISTEMA,
          'origem.snapshotCarga': novo.origem.snapshotCarga,
          'origem.arquivoSha256': meta.sha256,
        };
        for (const c of atualizar) patch[c] = novo[c];
        // nomeBusca é derivado: acompanha nomeExibicao sempre que ele for
        // reescrito, ou a busca por prefixo passa a procurar por um nome que
        // não é mais o exibido.
        if (atualizar.includes('nomeExibicao')) patch.nomeBusca = normalizarBusca(novo.nomeExibicao);
        if (COMMIT) { lote.update(db.collection(COLECAO).doc(existente.id), patch); pendentes++; }
        relatorio.atualizados.push(`${item.nome} → ${atualizar.join(', ')}`);
      } else if (!conflitos.length && !preservados.length) {
        relatorio.inalterados++;
      }
    }
    if (pendentes >= 400) await descarregar();
  }
  await descarregar();

  console.log('── RELATÓRIO ──');
  console.log(`Criados:        ${relatorio.criados.length}`);
  console.log(`Atualizados:    ${relatorio.atualizados.length}`);
  console.log(`Inalterados:    ${relatorio.inalterados}`);
  console.log(`Preservados:    ${relatorio.preservados.length} (editados no painel, não sobrescritos)`);
  console.log(`Conflitos:      ${relatorio.conflitos.length}`);
  console.log(`Não publicados: ${relatorio.naoPublicados.length} (sem os quatro macros)`);
  if (relatorio.criados.length) {
    console.log('\nCriados:');
    relatorio.criados.forEach((l) => console.log('  + ' + l));
  }
  if (relatorio.atualizados.length) {
    console.log('\nAtualizados:');
    relatorio.atualizados.forEach((l) => console.log('  ~ ' + l));
  }
  if (relatorio.naoPublicados.length) {
    console.log('\nNão publicados — sem energia, proteína, carboidrato ou lipídeos:');
    relatorio.naoPublicados.forEach((l) => console.log('  · ' + l));
    console.log('  Estão na coleção e resolvem em planos antigos; apenas não aparecem na busca.');
  }
  if (relatorio.preservados.length) {
    console.log('\nPreservados (o banco foi editado; a planilha não mudou):');
    relatorio.preservados.forEach((l) => console.log('  = ' + l));
  }
  if (relatorio.conflitos.length) {
    console.log('\nCONFLITOS — banco e planilha mudaram no mesmo campo. Nada foi feito nestes.');
    console.log('Decida caso a caso: ou o arquivo preparado está velho, ou a edição do painel');
    console.log('precisa ser refeita. --forcar sobrescreve tudo, inclusive o que o Coach editou.');
    relatorio.conflitos.forEach((l) => console.log('  ! ' + l));
  }
  if (FORCAR) console.log('\nATENÇÃO: --forcar ativo. Edições feitas no painel foram sobrescritas.');
  if (!COMMIT) console.log('\nEnsaio em seco. Nada foi gravado. Repita com --commit para aplicar.');
  console.log('');
}

// Execução só quando chamado direto — permite exercitar a reconciliação em
// teste sem tocar no Firestore.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => abortar(e?.stack ?? String(e)));
}
