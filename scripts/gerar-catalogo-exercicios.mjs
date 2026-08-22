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

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import admin from 'firebase-admin';

// Arquivo-fonte VERSIONADO no Git. Não é o que o painel consome: é a entrada
// do filtro. Versioná-lo torna cada publicação de catálogo auditável no
// histórico do repositório.
const SAIDA = resolve(process.cwd(), 'scripts/dados-exercicios/catalogo-fonte.json');
const COLECAO = 'exercises';

function abortar(msg) {
  console.error(`\n  ERRO: ${msg}\n`);
  process.exit(1);
}

function conectar() {
  const bruto = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim();
  if (!bruto) abortar('FIREBASE_SERVICE_ACCOUNT_JSON não definida.');
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
    });
  });

  itens.sort((a, b) => a.nome_pt.localeCompare(b.nome_pt, 'pt-BR'));

  const saida = {
    geradoEm: new Date().toISOString(),
    total: itens.length,
    exercicios: itens,
  };

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
