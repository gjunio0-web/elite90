// ELITE90 PRO · conferir-exercicios
// -----------------------------------------------------------------------------
// Confere a coleção exercises/ do Firestore contra os arquivos de redação em
// scripts/dados-exercicios/. Somente leitura: NUNCA escreve nada.
//
// POR QUE ESTE SCRIPT EXISTE
// A carga relata "Criados: 519" e cabe a uma pessoa ler esse número e confiar.
// Conferência visual de centenas de registros falha — e falhou nesta própria
// rodada, quando defeitos passaram porque eu verifiquei sintaxe achando que
// verificava comportamento. Aqui a verificação é mecânica.
//
// O SCRIPT NÃO SABE QUANTOS EXERCÍCIOS EXISTEM. Ele compara o que está no banco
// com o que está nos arquivos de redação, sejam quantos forem. Serve para os
// 519 de hoje e continua servindo se o catálogo crescer ou encolher. Número
// congelado dentro de script de conferência é conferência que passa a mentir.
//
// O QUE ELE CONFERE
//   1. Correspondência   cada redação existe no banco, cada documento do banco
//                        corresponde a uma redação (órfãos são relatados).
//   2. Campo a campo     os valores gravados batem com os redigidos.
//   3. Vocabulário       grupo, músculo, equipamento, mecânica e nível dentro
//                        das listas fechadas da especificação (seção 5).
//   4. Preenchimento     nome_pt e instrucao_pt não vazios.
//   5. Unicidade         nenhum nome_pt repetido em toda a coleção.
//   6. Estado            publicado, ativo, e a contagem de revisados por lote.
//   7. Autoria           criadoPor/atualizadoPor com o valor sentinela, salvo
//                        onde houve edição legítima no painel.
//   8. Arquivo-fonte     se catalogo-fonte.json existir, confere se reflete o
//                        banco — pega o caso de publicar sem regerar.
//
// O QUE ELE NÃO CONFERE, e é importante não confundir: ACERTO. Se um nome
// estiver escrito errado, o script não acusa — está preenchido, é único e o
// vocabulário dos outros campos está certo. Julgar se o nome é o que um coach
// brasileiro usa continua sendo trabalho do Coach na revisão. Isto aqui garante
// que o que foi redigido chegou inteiro ao banco, não que o que foi redigido
// está bom.
//
// Código de saída 0 quando conforme, 1 quando há divergência — assim serve
// tanto para leitura humana quanto para uso automatizado depois.
//
// ARTEFATO DURÁVEL. Vale para esta carga e para qualquer alteração futura do
// catálogo, inclusive para o dia em que alguém rodar --forcar por engano.
//
// Uso:
//   npm run conferir:exercicios
// -----------------------------------------------------------------------------

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const RAIZ_PROJETO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_LOTES = resolve(RAIZ_PROJETO, 'scripts/dados-exercicios');
const ARQ_FONTE = resolve(DIR_LOTES, 'catalogo-fonte.json');
const COLECAO = 'exercises';
const AUTOR_SISTEMA = 'sistema:carga-inicial';

const GRUPOS = ['Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps', 'Antebraço', 'Pernas', 'Abdômen'];
const MUSCULOS = ['Peitoral', 'Dorsal', 'Trapézio', 'Lombar', 'Deltoide', 'Bíceps', 'Tríceps',
  'Antebraço', 'Quadríceps', 'Posterior de Coxa', 'Glúteo', 'Panturrilha', 'Adutor', 'Abdutor',
  'Abdômen', 'Oblíquo'];
const EQUIPAMENTOS = ['Barra', 'Halteres', 'Polia', 'Máquina', 'Peso Corporal', 'Barra W', 'Kettlebell'];
const MECANICAS = ['composto', 'isolado'];
const NIVEIS = ['iniciante', 'intermediario', 'avancado'];

// Campos comparados entre redação e banco. Fora daqui, de propósito: publicado,
// ativo, revisadoPor, revisadoEm e os carimbos — são estado, não conteúdo.
const CAMPOS = ['nome_pt', 'nome_en', 'instrucao_pt', 'grupo', 'musculoPrimario',
  'musculosSecundarios', 'equipamento', 'mecanica', 'nivel', 'revisarMusculo'];

const achados = [];
function apontar(categoria, detalhe) { achados.push({ categoria, detalhe }); }

function abortar(msg) {
  console.error(`\n  ERRO: ${msg}\n`);
  process.exit(1);
}

function carregarEnvLocal() {
  const caminho = resolve(RAIZ_PROJETO, '.env.local');
  if (!existsSync(caminho)) return;
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    const eq = linha.indexOf('=');
    if (eq === -1) continue;
    const chave = linha.slice(0, eq).trim();
    if (!chave || chave.startsWith('#') || process.env[chave] !== undefined) continue;
    let valor = linha.slice(eq + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    process.env[chave] = valor;
  }
}

function conectar() {
  carregarEnvLocal();
  const bruto = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim();
  if (!bruto) abortar('FIREBASE_SERVICE_ACCOUNT_JSON não encontrada.\n  Confira se existe .env.local na raiz do repositório com essa variável.');
  let credencial;
  try {
    credencial = JSON.parse(bruto.startsWith('"') && bruto.endsWith('"') ? bruto.slice(1, -1) : bruto);
  } catch {
    abortar('FIREBASE_SERVICE_ACCOUNT_JSON não é um JSON válido.');
  }
  if (typeof credencial.private_key === 'string') {
    credencial.private_key = credencial.private_key.replace(/\\n/g, '\n');
  }
  try {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(credencial) });
  } catch (e) {
    abortar(`a credencial foi lida, mas o Firebase a recusou.\n  Motivo: ${e?.message ?? e}`);
  }
  if (credencial.project_id && credencial.project_id !== 'elite90-c716b') {
    console.warn(`\n  AVISO: o projeto da credencial é "${credencial.project_id}", não "elite90-c716b".\n`);
  }
  return admin.firestore();
}

function lerRedacoes() {
  if (!existsSync(DIR_LOTES)) abortar(`diretório não encontrado: ${DIR_LOTES}`);
  const arquivos = readdirSync(DIR_LOTES).filter((f) => /^lote-\d{2}\.json$/.test(f)).sort();
  if (!arquivos.length) abortar(`nenhum arquivo lote-NN.json em ${DIR_LOTES}`);
  const porIdOrigem = new Map();
  for (const arquivo of arquivos) {
    const lote = arquivo.slice(5, 7);
    for (const item of JSON.parse(readFileSync(join(DIR_LOTES, arquivo), 'utf8'))) {
      porIdOrigem.set(item.idOrigem, { ...item, _lote: lote, _arquivo: arquivo });
    }
  }
  return { arquivos, porIdOrigem };
}

function igual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : [];
    const y = Array.isArray(b) ? b : [];
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  return (a ?? null) === (b ?? null);
}

async function principal() {
  const { arquivos, porIdOrigem } = lerRedacoes();
  const db = conectar();

  console.log('\n══ CONFERÊNCIA DA COLEÇÃO exercises/ ══');
  console.log(`Arquivos de redação: ${arquivos.length} (${arquivos.join(', ')})`);
  console.log(`Exercícios redigidos: ${porIdOrigem.size}`);

  const snap = await db.collection(COLECAO).get();
  console.log(`Documentos no banco:  ${snap.size}\n`);

  const noBanco = new Map();
  const nomesVistos = new Map();
  let publicados = 0, ativos = 0;
  const revisadosPorLote = new Map();
  const totalPorLote = new Map();

  snap.forEach((doc) => {
    const d = doc.data();
    const idOrigem = d?.origem?.idOrigem ?? null;

    // 5 · unicidade de nome_pt em toda a coleção
    const chave = (d.nome_pt ?? '').trim().toLowerCase();
    if (chave) {
      if (nomesVistos.has(chave)) apontar('nome repetido', `"${d.nome_pt}" em ${doc.id.slice(0, 8)}… e ${nomesVistos.get(chave).slice(0, 8)}…`);
      else nomesVistos.set(chave, doc.id);
    }

    // 6 · estado
    if (d.publicado === true) publicados++;
    if (d.ativo !== false) ativos++;
    const lote = d._lote ?? '??';
    totalPorLote.set(lote, (totalPorLote.get(lote) ?? 0) + 1);
    if (d.revisadoPor) revisadosPorLote.set(lote, (revisadosPorLote.get(lote) ?? 0) + 1);

    // 3 · vocabulário
    const nome = d.nome_pt || doc.id.slice(0, 8) + '…';
    if (!GRUPOS.includes(d.grupo)) apontar('vocabulário', `${nome}: grupo "${d.grupo}"`);
    if (!MUSCULOS.includes(d.musculoPrimario)) apontar('vocabulário', `${nome}: músculo "${d.musculoPrimario}"`);
    if (!EQUIPAMENTOS.includes(d.equipamento)) apontar('vocabulário', `${nome}: equipamento "${d.equipamento}"`);
    if (d.mecanica != null && !MECANICAS.includes(d.mecanica)) apontar('vocabulário', `${nome}: mecânica "${d.mecanica}"`);
    if (!NIVEIS.includes(d.nivel)) apontar('vocabulário', `${nome}: nível "${d.nivel}"`);
    for (const m of d.musculosSecundarios ?? []) {
      if (!MUSCULOS.includes(m)) apontar('vocabulário', `${nome}: músculo secundário "${m}"`);
    }

    // 4 · preenchimento
    if (!(d.nome_pt ?? '').trim()) apontar('campo vazio', `${doc.id.slice(0, 8)}…: nome_pt`);
    if (!(d.instrucao_pt ?? '').trim()) apontar('campo vazio', `${nome}: instrucao_pt`);

    // 7 · autoria
    if (d.criadoPor !== AUTOR_SISTEMA) apontar('autoria', `${nome}: criadoPor "${d.criadoPor}" (esperado "${AUTOR_SISTEMA}")`);

    // 1 · órfãos
    if (!idOrigem) apontar('órfão', `${nome} (${doc.id.slice(0, 8)}…): sem origem.idOrigem`);
    else if (!porIdOrigem.has(idOrigem)) apontar('órfão', `${nome}: idOrigem "${idOrigem}" não existe em nenhum arquivo de redação`);
    else noBanco.set(idOrigem, { id: doc.id, dados: d });
  });

  // 1 · redações ausentes do banco
  for (const [idOrigem, item] of porIdOrigem) {
    if (!noBanco.has(idOrigem)) apontar('ausente', `${item.nome_pt} (${item._arquivo}) não está no banco`);
  }

  // 2 · campo a campo
  for (const [idOrigem, item] of porIdOrigem) {
    const alvo = noBanco.get(idOrigem);
    if (!alvo) continue;
    for (const campo of CAMPOS) {
      if (!igual(item[campo], alvo.dados[campo])) {
        const editado = Boolean(alvo.dados.revisadoPor) || alvo.dados.atualizadoPor !== AUTOR_SISTEMA;
        apontar(editado ? 'divergência esperada' : 'divergência',
          `${item.nome_pt}: ${campo} — redação "${item[campo]}" / banco "${alvo.dados[campo]}"${editado ? ' (documento editado no painel)' : ''}`);
      }
    }
  }

  // 8 · arquivo-fonte
  if (existsSync(ARQ_FONTE)) {
    try {
      const fonte = JSON.parse(readFileSync(ARQ_FONTE, 'utf8'));
      const naFonte = new Set((fonte.exercicios ?? []).map((e) => e.id));
      let esperados = 0;
      snap.forEach((doc) => { if (doc.data().publicado === true && doc.data().ativo !== false) esperados++; });
      if (naFonte.size !== esperados) {
        apontar('arquivo-fonte', `tem ${naFonte.size} exercício(s), mas o banco tem ${esperados} publicado(s) e ativo(s). Rode "npm run catalogo:exercicios".`);
      }
    } catch (e) {
      apontar('arquivo-fonte', `não pôde ser lido: ${e.message}`);
    }
  } else {
    console.log('Arquivo-fonte ainda não gerado — conferência do item 8 pulada.\n');
  }

  // ── relatório ──
  console.log('── ESTADO ──');
  console.log(`Publicados:  ${publicados} de ${snap.size}`);
  console.log(`Ativos:      ${ativos} de ${snap.size}`);
  const lotes = [...totalPorLote.keys()].sort();
  if (lotes.length) {
    console.log('Revisão do Coach, por lote:');
    for (const l of lotes) {
      const r = revisadosPorLote.get(l) ?? 0;
      const t = totalPorLote.get(l);
      console.log(`  lote ${l}: ${r} de ${t} revisado(s)${r === t ? ' — completo' : ''}`);
    }
  }

  const graves = achados.filter((a) => a.categoria !== 'divergência esperada');
  console.log('\n── RESULTADO ──');
  if (!graves.length) {
    console.log('CONFORME. Nenhuma divergência entre os arquivos de redação e o banco.');
    const brandas = achados.length - graves.length;
    if (brandas) console.log(`(${brandas} divergência(s) em documentos editados no painel — esperado, ver detalhe abaixo.)`);
  } else {
    console.log(`${graves.length} divergência(s) encontrada(s).`);
  }

  if (achados.length) {
    const porCategoria = new Map();
    for (const a of achados) {
      if (!porCategoria.has(a.categoria)) porCategoria.set(a.categoria, []);
      porCategoria.get(a.categoria).push(a.detalhe);
    }
    for (const [cat, itens] of porCategoria) {
      console.log(`\n${cat.toUpperCase()} (${itens.length}):`);
      itens.slice(0, 40).forEach((d) => console.log('  • ' + d));
      if (itens.length > 40) console.log(`  … e mais ${itens.length - 40}`);
    }
  }

  console.log('\nEste script confere consistência, não acerto: um nome mal escrito');
  console.log('passa por ele. Julgar a nomenclatura é trabalho do Coach.\n');

  process.exit(graves.length ? 1 : 0);
}

principal().catch((e) => abortar(e?.stack ?? String(e)));
