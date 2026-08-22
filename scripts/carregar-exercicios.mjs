// ELITE90 PRO · carregar-exercicios
// -----------------------------------------------------------------------------
// Carga em lote da coleção exercises/ do Firestore, a partir dos arquivos de
// lote revisados (scripts/dados-exercicios/lote-NN.json).
//
// Contrato (Especificação "Coleção exercises/", Drive, seções 6, 9 e 11):
//   • ENSAIO EM SECO POR PADRÃO. Só grava com --commit.
//   • IDEMPOTENTE: a chave de reconciliação é origem.idOrigem, não o nome.
//     Reexecutar não duplica; atualiza o que mudou e cria o que falta.
//   • publicado: true em toda criação. O que separa homologação de produção
//     NÃO é este campo, e sim revisadoPor: o gerador do catálogo estático só
//     emite exercícios revisados quando o contexto de publicação é produção.
//     Assim o buscador funciona em homologação desde o primeiro dia, sem que
//     nenhum nome não validado chegue ao atleta.
//   • A revisão do Coach é registrada com --revisar-lote=NN, que preenche
//     revisadoPor/revisadoEm. Enquanto não houver tela de catálogo no painel,
//     o valor gravado é o sentinela 'coach:aprovacao-lote-NN'.
//   • REEXECUÇÃO NÃO APAGA TRABALHO REVISADO. O script guarda, em
//     origem.snapshotCarga, os valores que ele mesmo escreveu. Na reexecução
//     compara três pontas — arquivo, banco e snapshot — e só sobrescreve o que
//     ninguém editou pela tela. Divergência dos dois lados vira conflito
//     relatado, não decisão silenciosa.
//   • criadoPor / atualizadoPor recebem o valor sentinela AUTOR_SISTEMA.
//     Gravar aqui o uid de quem roda o script daria a impressão falsa de que
//     uma pessoa cadastrou centenas de exercícios à mão.
//   • ativo: true. Exercício nunca é excluído — ver seção 8 da especificação.
//
// ARTEFATO DE HOMOLOGAÇÃO: script de uso único. Entra na lista de remoção ao
// fim do projeto (grupo próprio). Não confundir com set-admin-claim.js nem com
// purge-rejected-leads.ts, que são duráveis.
//
// Uso:
//   node scripts/carregar-exercicios.mjs                    # ensaio em seco
//   node scripts/carregar-exercicios.mjs --commit           # grava
//   node scripts/carregar-exercicios.mjs --revisar-lote=01 --commit
//   node scripts/carregar-exercicios.mjs --forcar --commit   # exceção: reinicia
// -----------------------------------------------------------------------------

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import admin from 'firebase-admin';

const RAIZ = process.cwd();
const DIR_LOTES = resolve(RAIZ, 'scripts/dados-exercicios');
const COLECAO = 'exercises';
const AUTOR_SISTEMA = 'sistema:carga-inicial';

// Vocabulário fechado — espelha as seções 5.1, 5.2 e 5.3 da especificação.
// Qualquer valor fora daqui aborta a carga: é erro de preparação de dado, e
// deixar passar significa gravar lixo num catálogo que o Coach vai revisar.
const GRUPOS = ['Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps', 'Antebraço', 'Pernas', 'Abdômen'];
const MUSCULOS = ['Peitoral', 'Dorsal', 'Trapézio', 'Lombar', 'Deltoide', 'Bíceps', 'Tríceps',
  'Antebraço', 'Quadríceps', 'Posterior de Coxa', 'Glúteo', 'Panturrilha', 'Adutor', 'Abdutor',
  'Abdômen', 'Oblíquo'];
const EQUIPAMENTOS = ['Barra', 'Halteres', 'Polia', 'Máquina', 'Peso Corporal', 'Barra W', 'Kettlebell'];
const MECANICAS = ['composto', 'isolado'];
const NIVEIS = ['iniciante', 'intermediario', 'avancado'];

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const revisarArg = args.find((a) => a.startsWith('--revisar-lote='));
const LOTE_A_REVISAR = revisarArg ? revisarArg.split('=')[1] : null;
// --forcar não é rotina: existe para reiniciar o catálogo de propósito,
// aceitando sobrescrever até o que o Coach editou pela tela.
const FORCAR = args.includes('--forcar');

function abortar(msg) {
  console.error(`\n  ERRO: ${msg}\n`);
  process.exit(1);
}

// ── Leitura dos lotes ────────────────────────────────────────────────────────
// Só entram exercícios com nome_pt e instrucao_pt preenchidos. Um exercício sem
// redação em português não tem o que ser carregado: o nome em inglês não vai
// para a tela do Coach nem para a do atleta.
function lerLotes() {
  if (!existsSync(DIR_LOTES)) abortar(`diretório de lotes não encontrado: ${DIR_LOTES}`);
  const arquivos = readdirSync(DIR_LOTES).filter((f) => /^lote-\d{2}\.json$/.test(f)).sort();
  if (!arquivos.length) abortar(`nenhum arquivo lote-NN.json em ${DIR_LOTES}`);

  const registros = [];
  const vistosIdOrigem = new Map();
  const vistosNomePt = new Map();

  for (const arquivo of arquivos) {
    const lote = arquivo.slice(5, 7);
    const itens = JSON.parse(readFileSync(join(DIR_LOTES, arquivo), 'utf8'));
    itens.forEach((item, i) => {
      const onde = `${arquivo}[${i}] (${item.nome_en ?? 'sem nome_en'})`;

      for (const campo of ['idOrigem', 'nome_en', 'nome_pt', 'instrucao_pt', 'grupo',
        'musculoPrimario', 'equipamento', 'nivel']) {
        if (!item[campo] || String(item[campo]).trim() === '') abortar(`${onde}: campo obrigatório ausente ou vazio: ${campo}`);
      }
      if (!GRUPOS.includes(item.grupo)) abortar(`${onde}: grupo fora do vocabulário: ${item.grupo}`);
      if (!MUSCULOS.includes(item.musculoPrimario)) abortar(`${onde}: músculo primário fora do vocabulário: ${item.musculoPrimario}`);
      if (!EQUIPAMENTOS.includes(item.equipamento)) abortar(`${onde}: equipamento fora do vocabulário: ${item.equipamento}`);
      if (!NIVEIS.includes(item.nivel)) abortar(`${onde}: nível fora do vocabulário: ${item.nivel}`);
      if (item.mecanica != null && !MECANICAS.includes(item.mecanica)) abortar(`${onde}: mecânica fora do vocabulário: ${item.mecanica}`);
      for (const m of item.musculosSecundarios ?? []) {
        if (!MUSCULOS.includes(m)) abortar(`${onde}: músculo secundário fora do vocabulário: ${m}`);
      }

      if (vistosIdOrigem.has(item.idOrigem)) abortar(`${onde}: idOrigem repetido, já visto em ${vistosIdOrigem.get(item.idOrigem)}`);
      vistosIdOrigem.set(item.idOrigem, onde);
      const chaveNome = item.nome_pt.trim().toLowerCase();
      if (vistosNomePt.has(chaveNome)) abortar(`${onde}: nome_pt repetido ("${item.nome_pt}"), já visto em ${vistosNomePt.get(chaveNome)}`);
      vistosNomePt.set(chaveNome, onde);

      registros.push({ ...item, _lote: lote });
    });
  }
  return { registros, arquivos };
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

function documentoDe(item, agora) {
  return {
    nome_pt: item.nome_pt,
    nome_en: item.nome_en,
    instrucao_pt: item.instrucao_pt,
    instrucao_en: item.instrucao_en ?? null,
    grupo: item.grupo,
    musculoPrimario: item.musculoPrimario,
    musculosSecundarios: item.musculosSecundarios ?? [],
    equipamento: item.equipamento,
    mecanica: item.mecanica ?? null,
    nivel: item.nivel,
    publicado: true,
    ativo: true,
    origem: {
      fonte: 'free-exercise-db',
      idOrigem: item.idOrigem,
      // Retrato do que ESTA carga escreveu. É a terceira ponta da comparação:
      // sem ele não há como distinguir "o arquivo mudou" de "o Coach editou".
      snapshotCarga: snapshotDe(item),
    },
    revisadoPor: null,
    revisadoEm: null,
    criadoPor: AUTOR_SISTEMA,
    atualizadoPor: AUTOR_SISTEMA,
    criadoEm: agora,
    atualizadoEm: agora,
    _lote: item._lote,
  };
}

// Campos que a carga pode reescrever numa reexecução. Deliberadamente fora
// desta lista: publicado, revisadoPor, revisadoEm, criadoPor, criadoEm. São
// estado de revisão e de autoria — reexecutar a carga não pode desfazer o
// trabalho que o Coach já fez.
const CAMPOS_ATUALIZAVEIS = ['nome_pt', 'nome_en', 'instrucao_pt', 'instrucao_en', 'grupo',
  'musculoPrimario', 'musculosSecundarios', 'equipamento', 'mecanica', 'nivel', '_lote'];

function igual(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

/** Retrato dos campos atualizáveis, gravado em origem.snapshotCarga. */
function snapshotDe(item) {
  const d = {
    nome_pt: item.nome_pt,
    nome_en: item.nome_en,
    instrucao_pt: item.instrucao_pt,
    instrucao_en: item.instrucao_en ?? null,
    grupo: item.grupo,
    musculoPrimario: item.musculoPrimario,
    musculosSecundarios: item.musculosSecundarios ?? [],
    equipamento: item.equipamento,
    mecanica: item.mecanica ?? null,
    nivel: item.nivel,
    _lote: item._lote,
  };
  return d;
}

// COMPARAÇÃO DE TRÊS PONTAS
// -------------------------
// arquivo   = o que o lote diz hoje
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
function classificar(atual, novo) {
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

async function principal() {
  const { registros, arquivos } = lerLotes();

  console.log('\n══ CARGA DA COLEÇÃO exercises/ ══');
  console.log(`Modo:            ${COMMIT ? 'GRAVAÇÃO (--commit)' : 'ENSAIO EM SECO — nada será escrito'}`);
  console.log(`Lotes lidos:     ${arquivos.join(', ')}`);
  console.log(`Registros:       ${registros.length}`);
  if (LOTE_A_REVISAR) console.log(`Revisar lote:    ${LOTE_A_REVISAR}`);
  if (FORCAR) console.log('Forçar:          SIM — edições feitas no painel serão sobrescritas');
  console.log('');

  const db = conectar();
  const existentes = new Map();
  const snap = await db.collection(COLECAO).get();
  snap.forEach((doc) => {
    const d = doc.data();
    if (d?.origem?.idOrigem) existentes.set(d.origem.idOrigem, { id: doc.id, dados: d });
  });
  console.log(`Já na coleção:   ${snap.size} documento(s), ${existentes.size} com idOrigem.\n`);

  const agora = admin.firestore.FieldValue.serverTimestamp();
  const relatorio = { criados: [], atualizados: [], inalterados: 0, revisados: [], conflitos: [], preservados: [] };
  let lote = db.batch();
  let pendentes = 0;

  async function descarregar() {
    if (!COMMIT || pendentes === 0) { lote = db.batch(); pendentes = 0; return; }
    await lote.commit();
    lote = db.batch();
    pendentes = 0;
  }

  for (const item of registros) {
    const novo = documentoDe(item, agora);
    const existente = existentes.get(item.idOrigem);

    if (!existente) {
      const id = randomUUID();
      if (COMMIT) { lote.set(db.collection(COLECAO).doc(id), novo); pendentes++; }
      relatorio.criados.push(`${item.nome_pt} (${id.slice(0, 8)}…)`);
    } else {
      const { atualizar, conflitos, preservados } = FORCAR
        ? { atualizar: CAMPOS_ATUALIZAVEIS.filter((c) => !igual(existente.dados[c], novo[c])), conflitos: [], preservados: [] }
        : classificar(existente.dados, novo);

      if (conflitos.length) {
        relatorio.conflitos.push(`${item.nome_pt} → ${conflitos.join(', ')}`);
      }
      if (preservados.length) {
        relatorio.preservados.push(`${item.nome_pt} → ${preservados.join(', ')}`);
      }
      if (atualizar.length) {
        const patch = {
          atualizadoEm: agora,
          atualizadoPor: AUTOR_SISTEMA,
          'origem.snapshotCarga': novo.origem.snapshotCarga,
        };
        for (const c of atualizar) patch[c] = novo[c];
        if (COMMIT) { lote.update(db.collection(COLECAO).doc(existente.id), patch); pendentes++; }
        relatorio.atualizados.push(`${item.nome_pt} → ${atualizar.join(', ')}`);
      } else if (!conflitos.length && !preservados.length) {
        relatorio.inalterados++;
      }
    }

    // Registro da revisão do Coach. Enquanto não existir tela de catálogo no
    // painel (item de backlog próprio), a aprovação chega por mensagem e é
    // carimbada aqui, em bloco, com valor sentinela que deixa claro que não
    // partiu de uma sessão autenticada dele.
    if (LOTE_A_REVISAR && item._lote === LOTE_A_REVISAR && existente) {
      if (COMMIT) {
        lote.update(db.collection(COLECAO).doc(existente.id), {
          revisadoPor: `coach:aprovacao-lote-${LOTE_A_REVISAR}`,
          revisadoEm: agora,
          atualizadoEm: agora,
        });
        pendentes++;
      }
      relatorio.revisados.push(item.nome_pt);
    }
    if (pendentes >= 400) await descarregar();
  }
  await descarregar();

  console.log('── RELATÓRIO ──');
  console.log(`Criados:      ${relatorio.criados.length}`);
  console.log(`Atualizados:  ${relatorio.atualizados.length}`);
  console.log(`Inalterados:  ${relatorio.inalterados}`);
  console.log(`Preservados:  ${relatorio.preservados.length} (editados no painel, não sobrescritos)`);
  console.log(`Conflitos:    ${relatorio.conflitos.length}`);
  if (LOTE_A_REVISAR) console.log(`Revisados:    ${relatorio.revisados.length} (lote ${LOTE_A_REVISAR})`);
  if (relatorio.criados.length) {
    console.log('\nCriados:');
    relatorio.criados.forEach((l) => console.log('  + ' + l));
  }
  if (relatorio.atualizados.length) {
    console.log('\nAtualizados:');
    relatorio.atualizados.forEach((l) => console.log('  ~ ' + l));
  }
  if (relatorio.preservados.length) {
    console.log('\nPreservados (o banco foi editado; o arquivo de lote não mudou):');
    relatorio.preservados.forEach((l) => console.log('  = ' + l));
  }
  if (relatorio.conflitos.length) {
    console.log('\nCONFLITOS — banco e arquivo mudaram no mesmo campo. Nada foi feito nestes.');
    console.log('Decida caso a caso: ou o arquivo de lote está velho, ou a edição do painel');
    console.log('precisa ser refeita. --forcar sobrescreve tudo, inclusive o que o Coach editou.');
    relatorio.conflitos.forEach((l) => console.log('  ! ' + l));
  }
  if (FORCAR) console.log('\nATENÇÃO: --forcar ativo. Edições feitas no painel foram sobrescritas.');
  if (!COMMIT) console.log('\nEnsaio em seco. Nada foi gravado. Repita com --commit para aplicar.');
  console.log('');
}

principal().catch((e) => abortar(e?.stack ?? String(e)));
