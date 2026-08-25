// ELITE90 PRO · gerar-catalogo-exercicios
// -----------------------------------------------------------------------------
// Lê a coleção exercises/ do Firestore e publica um arquivo estático em
// apps/site/public/dados/exercicios.json.
//
// Por que um arquivo estático em vez de leitura direta do Firestore
// (Especificação "Coleção exercises/", Drive, seção 10): o portal é usado
// dentro da academia, com conexão instável. Um catálogo de algumas centenas de
// documentos não pode ser consultado no banco a cada abertura de tela. O
// arquivo inteiro cabe em memória e em cache do navegador.
//
// Divisão de papéis:
//   • Firestore  → fonte de verdade para EDIÇÃO (o Coach renomeia, publica).
//   • Este JSON  → fonte de LEITURA para o painel e para o portal.
// Publicar um lote é: rodar carregar-exercicios.mjs --revisar-lote=NN --commit,
// rodar este gerador (npm run catalogo:exercicios), e publicar o site.
//
// Só entram exercícios com publicado = true E ativo = true. Um exercício
// arquivado continua no Firestore para resolver o nome em planos antigos, mas
// não deve aparecer no seletor de novos planos.
//
// ESTE SCRIPT NÃO FILTRA POR CONTEXTO — e a razão importa.
//
// A primeira versão lia a variável CONTEXT, que o Netlify define por contexto
// de publicação, e emitia só os revisados quando o valor era 'production'. O
// desenho estava errado: este script roda na MÁQUINA de quem publica um lote,
// nunca dentro do Netlify. O CONTEXT que ficaria congelado no arquivo seria o
// de quem digitou o comando, e o mesmo arquivo seria servido em homologação e
// em produção. O portão que eu descrevi como mecânico era, na prática, a
// disciplina de quem rodava o comando.
//
// Correção: duas operações de naturezas diferentes foram separadas.
//
//   ESTE script          → lê o Firestore (precisa de credencial e de rede),
//                          emite TUDO que está publicado, cada item com a
//                          marca `revisado`. Ato ocasional, feito à mão.
//   filtrar-catalogo.mjs → transformação local pura, sem rede e sem
//                          credencial. Lê CONTEXT e recorta. Roda em TODA
//                          publicação, dentro do Netlify, porque está no
//                          script de build do apps/site.
//
// Com isso, vazar nome não revisado passa a exigir que o filtro falhe, não que
// alguém esqueça um comando. E o build não fica acoplado ao Firestore: uma
// instabilidade do banco não derruba a publicação do site.
//
// ARTEFATO DURÁVEL: ao contrário de carregar-exercicios.mjs, este script
// permanece no projeto — roda a cada publicação de lote.
//
// Uso:
//   npm run catalogo:exercicios
// -----------------------------------------------------------------------------

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const RAIZ_PROJETO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Arquivo-fonte VERSIONADO no Git. Não é o que o painel consome: é a entrada
// do filtro. Versioná-lo torna cada publicação de catálogo auditável no
// histórico do repositório.
const SAIDA = resolve(RAIZ_PROJETO, 'scripts/dados-exercicios/catalogo-fonte.json');
const COLECAO = 'exercises';

// MODO DE BUILD (--se-possivel) — a opção C, decidida em 25/08/2026.
//
// Sem a bandeira, este script é ferramenta de linha de comando: falta de
// credencial é erro de quem digitou, e abortar é a resposta certa.
//
// COM a bandeira, ele roda dentro do build do Netlify, e a régua muda: o
// catálogo é uma base de domínio, não o site inteiro. Derrubar a publicação
// porque o Firestore piscou seria desproporcional. Então toda falha vira aviso
// e saída zero, e o arquivo-fonte COMMITADO permanece como estava — que é a
// reserva. O build segue com o último catálogo bom conhecido.
//
// É isso que dissolve o impasse da seção 7 da especificação: a frescura vem do
// banco quando ele responde, e a resiliência vem do arquivo versionado quando
// ele não responde. Nenhuma das duas opções originais dava as duas coisas.
const SE_POSSIVEL = process.argv.includes('--se-possivel');

function abortar(msg) {
  if (SE_POSSIVEL) {
    console.warn(`\n[catálogo-fonte] ${msg}`);
    console.warn('[catálogo-fonte] seguindo com o arquivo-fonte versionado.\n');
    process.exit(0);
  }
  console.error(`\n  ERRO: ${msg}\n`);
  process.exit(1);
}

// Carrega .env.local da raiz do projeto, sem dependência de dotenv.
// Mesmo mecanismo de scripts/set-admin-claim.js — dois comportamentos
// diferentes para a mesma coisa seria pior que qualquer um dos dois: quem roda
// um script espera que o outro funcione igual. Variável já presente no
// ambiente tem precedência sobre o arquivo.
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
  if (!bruto) {
    abortar('FIREBASE_SERVICE_ACCOUNT_JSON não encontrada.\n'
      + '  Confira se existe .env.local na raiz do repositório com essa variável.');
  }
  let credencial;
  try {
    credencial = JSON.parse(bruto.startsWith('"') && bruto.endsWith('"') ? bruto.slice(1, -1) : bruto);
  } catch {
    abortar('FIREBASE_SERVICE_ACCOUNT_JSON não é um JSON válido.');
  }
  if (typeof credencial.private_key === 'string') {
    credencial.private_key = credencial.private_key.replace(/\\n/g, '\n');
  }
  // Credencial malformada é a falha mais provável na primeira execução. Deixar
  // o erro subir cru devolve um rastreamento de pilha do firebase-admin, que
  // não diz a quem lê o que fazer a respeito.
  try {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(credencial) });
  } catch (e) {
    abortar('a credencial foi lida, mas o Firebase a recusou.\n'
      + `  Motivo: ${e?.message ?? e}\n`
      + '  Causa provável: a chave privada perdeu as quebras de linha na colagem.\n'
      + '  Confira também se project_id é "elite90-c716b".');
  }
  if (credencial.project_id && credencial.project_id !== 'elite90-c716b') {
    console.warn(`\n  AVISO: o projeto da credencial é "${credencial.project_id}", não "elite90-c716b".`);
    console.warn('  Confirme que é o banco certo antes de usar --commit.\n');
  }
  return admin.firestore();
}

async function principal() {
  const db = conectar();
  const snap = await db.collection(COLECAO).where('publicado', '==', true).get();

  const itens = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d.ativo === false) return;
    itens.push({
      // A marca vem do Firestore junto do dado. É o que permite ao filtro
      // recortar depois, sem precisar consultar o banco de novo.
      revisado: Boolean(d.revisadoPor),
      // exerciseId é o vínculo estável gravado nos planos de treino
      // (especificação, seção 7). O nome NUNCA é a chave.
      id: doc.id,
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
      // Sinaliza classificação de músculo herdada da origem, que o Coach deve
      // conferir ao revisar. Viaja até o painel para virar o aviso na lista.
      revisarMusculo: d.revisarMusculo === true,
    });
  });

  itens.sort((a, b) => a.nome_pt.localeCompare(b.nome_pt, 'pt-BR'));

  const saida = {
    geradoEm: new Date().toISOString(),
    total: itens.length,
    exercicios: itens,
  };

  // GUARDA CONTRA APAGAR O CATÁLOGO EM SILÊNCIO
  // Consulta que volta vazia não é sinônimo de catálogo vazio: pode ser coleção
  // errada, regra nova, credencial de outro projeto. Sobrescrever 519 registros
  // bons por zero deixaria o site sem catálogo sem nada acusar, e o arquivo
  // versionado — a reserva — teria sido destruído junto.
  if (itens.length === 0 && existsSync(SAIDA)) {
    let anterior = 0;
    try { anterior = (JSON.parse(readFileSync(SAIDA, 'utf8')).exercicios ?? []).length; } catch { /* ilegível conta como vazio */ }
    if (anterior > 0) {
      const recado = `consulta devolveu 0 exercícios, mas o arquivo-fonte tem ${anterior}. NÃO sobrescrito.`;
      if (SE_POSSIVEL) { console.warn(`\n[catálogo-fonte] ${recado}\n`); process.exit(0); }
      abortar(`${recado}\n  Confira a coleção e o projeto da credencial antes de repetir.`);
    }
  }

  mkdirSync(dirname(SAIDA), { recursive: true });
  writeFileSync(SAIDA, JSON.stringify(saida), 'utf8');

  const kb = (Buffer.byteLength(JSON.stringify(saida), 'utf8') / 1024).toFixed(1);
  const revisados = itens.filter((i) => i.revisado).length;
  console.log(`\nArquivo-fonte gerado: ${itens.length} exercício(s), ${kb} KB`);
  console.log(`  revisados pelo Coach (chegam a produção): ${revisados}`);
  console.log(`  sem revisão (só homologação, com selo):   ${itens.length - revisados}`);
  console.log(`Arquivo: ${SAIDA}`);
  if (!itens.length) console.log('\nATENÇÃO: nenhum exercício publicado — a carga ainda não rodou.');
  console.log('\nPróximos passos: revise o diff do arquivo-fonte, faça commit e publique.');
  console.log('O recorte por contexto acontece no build, em filtrar-catalogo.mjs.\n');
}

principal().catch((e) => abortar(e?.stack ?? String(e)));
