// ativar-planos-mock.js
// Liga (ou desliga) a exibicao dos planos de treino e nutricao FICTICIOS para os
// dois atletas de homologacao, em /admin/atletas.
//
// Uso:
//   node scripts/ativar-planos-mock.js              -> simulacao, nao grava nada
//   node scripts/ativar-planos-mock.js --commit     -> grava a alteracao
//   node scripts/ativar-planos-mock.js --revert --commit  -> desfaz
//
// ─────────────────────────────────────────────────────────────────────────────
// O QUE ESTE SCRIPT FAZ, E O QUE ELE NAO FAZ
// ─────────────────────────────────────────────────────────────────────────────
// Ele NAO cria plano nenhum. Nenhum plano de treino ou de nutricao e gravado no
// Firestore por este script — nem por qualquer outra parte do sistema, hoje.
//
// A pagina /admin/atletas (apps/site/src/pages/admin/atletas.astro) monta os
// planos em memoria, no navegador, a cada abertura do drawer, a partir de duas
// funcoes de dados ficticios:
//
//   - wkeBuildBasePlan()  (linha ~2582) -> 3 dias, 15 exercicios, series, cargas
//                                          e o historico de progressao de carga
//   - nteBuildBasePlan()  (linha ~4124) -> 5 refeicoes em dia de treino,
//                                          4 em dia de descanso, com macros
//
// Essas funcoes so sao chamadas quando o campo planStatus do atleta e diferente
// da palavra exata 'none' (linhas 2730 e 4164). Atleta com planStatus 'none'
// cai no estado vazio de "primeira vez".
//
// Este script, portanto, mexe em UM campo por documento: planStatus. Ele e um
// interruptor de exibicao, nada mais. Nada do que aparece na tela depois disso
// e dado clinico, dado de atleta real, ou dado persistido — e conteudo de
// demonstracao gerado no navegador, calibrado para um atleta de ~85kg e
// reescalado pelo peso do documento.
//
// ─────────────────────────────────────────────────────────────────────────────
// MARCACAO EXPLICITA NO PROPRIO DOCUMENTO
// ─────────────────────────────────────────────────────────────────────────────
// Alem de trocar planStatus, o script grava tres campos de anotacao, para que
// qualquer pessoa que abra o documento no console do Firebase — hoje ou daqui a
// seis meses, sem esta conversa como contexto — entenda de imediato por que
// aquele atleta exibe um plano completo:
//
//   _mockPlan       true
//   _mockPlanNote   texto explicando a origem e a finalidade
//   _mockPlanSince  data-hora ISO em que o interruptor foi ligado
//
// O --revert remove os tres e devolve planStatus para 'none'.
//
// ─────────────────────────────────────────────────────────────────────────────
// ALVOS
// ─────────────────────────────────────────────────────────────────────────────
// Os dois atletas de homologacao, identificados pelo lead sintetico de origem
// (campo originLeadId), gerados por scripts/seed-triagem-bulk.ts com o sufixo
// "(MOCK #NN)" no nome e endereco de e-mail no TLD .test (RFC 2606, nunca
// roteado) atribuido por scripts/patch-lead-email.js.
//
// O script recusa-se a alterar qualquer documento que nao esteja nesta lista, e
// recusa-se a alterar documento cujo e-mail nao termine em "@homologacao.test".
// Essa segunda verificacao e uma trava de seguranca: impede que um erro de
// identificador atinja a ficha de uma pessoa real.
//
// ─────────────────────────────────────────────────────────────────────────────
// ATENCAO — ARTEFATO DE HOMOLOGACAO
// ─────────────────────────────────────────────────────────────────────────────
// Uso exclusivo para avaliacao interna do time, em ambiente de nao-producao.
// Este arquivo deve ser REMOVIDO no encerramento do projeto, junto com os
// demais artefatos de homologacao (seed-triagem-bulk.ts, score-mocks.ts,
// clean-mock-leads.ts, emulate-fn08.js, patch-lead-email.js,
// _athlete-from-lead.js). Antes de remover, rodar com --revert --commit, para
// que nenhum documento fique com os campos de marcacao orfaos.

'use strict';

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// -- Carrega .env.local da raiz (mesmo mecanismo de patch-lead-email.js) --
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key.startsWith('#') || process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!saEnv) { console.error('FIREBASE_SERVICE_ACCOUNT_JSON nao encontrada.'); process.exit(1); }

let sa;
try {
  let raw = saEnv.trim();
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  if (raw.startsWith("'") && raw.endsWith("'")) raw = raw.slice(1, -1);
  try { sa = JSON.parse(raw); } catch { sa = JSON.parse(raw.replace(/\\"/g, '"')); }
  if (sa?.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
} catch (e) { console.error('Erro nas credenciais:', e.message); process.exit(1); }

initializeApp({ credential: cert(sa) });
const db = getFirestore();

// -- Argumentos --
const args = process.argv.slice(2);
const commit = args.includes('--commit');
const revert = args.includes('--revert');

// -- Alvos permitidos --
const ALVOS = [
  { originLeadId: '8CGYpulZvKbMtnKU9npu', email: 'ladislau.franco@homologacao.test' },
  { originLeadId: 'C1pWQE5QAiQ7fj4xGukV', email: 'vitor.xavier@homologacao.test' },
];

const DOMINIO_PERMITIDO = '@homologacao.test';

const NOTA_MOCK =
  'DADO DE DEMONSTRACAO. Este atleta e sintetico (seed-triagem-bulk.ts) e existe ' +
  'apenas para avaliacao interna em homologacao. O plano de treino, o historico de ' +
  'progressao de carga e o plano nutricional exibidos em /admin/atletas NAO estao ' +
  'gravados no Firestore: sao gerados em memoria pelo navegador (wkeBuildBasePlan / ' +
  'nteBuildBasePlan, em atletas.astro) sempre que planStatus e diferente de "none". ' +
  'Nada disso e prescricao, dado clinico ou informacao de pessoa real. Para desligar: ' +
  'node scripts/ativar-planos-mock.js --revert --commit';

async function main() {
  console.log(revert ? '== DESLIGAR planos ficticios ==' : '== LIGAR planos ficticios ==');
  console.log(commit ? 'Modo: GRAVACAO (--commit)\n' : 'Modo: SIMULACAO (nenhuma gravacao; use --commit para gravar)\n');

  let alterados = 0, ignorados = 0;

  for (const alvo of ALVOS) {
    const snap = await db.collection('athletes')
      .where('originLeadId', '==', alvo.originLeadId)
      .limit(1)
      .get();

    if (snap.empty) {
      console.error(`  [nao encontrado] originLeadId ${alvo.originLeadId} — nenhum documento em athletes/. Pulando.`);
      ignorados++;
      continue;
    }

    const doc = snap.docs[0];
    const dados = doc.data();
    const email = String(dados.email || '');

    // Trava de seguranca: so mexe em atleta de homologacao.
    if (!email.endsWith(DOMINIO_PERMITIDO)) {
      console.error(`  [RECUSADO] ${doc.id}: e-mail "${email}" nao termina em ${DOMINIO_PERMITIDO}. ` +
                    'Este script nao altera documento que possa ser de pessoa real. Pulando.');
      ignorados++;
      continue;
    }
    if (email !== alvo.email) {
      console.error(`  [RECUSADO] ${doc.id}: e-mail "${email}" difere do esperado "${alvo.email}". Pulando.`);
      ignorados++;
      continue;
    }

    const de = dados.planStatus;
    const para = revert ? 'none' : 'publicado';

    const patch = revert
      ? {
          planStatus: 'none',
          _mockPlan: FieldValue.delete(),
          _mockPlanNote: FieldValue.delete(),
          _mockPlanSince: FieldValue.delete(),
        }
      : {
          planStatus: 'publicado',
          _mockPlan: true,
          _mockPlanNote: NOTA_MOCK,
          _mockPlanSince: new Date().toISOString(),
        };

    console.log(`  ${dados.name || '(sem nome)'} <${email}>`);
    console.log(`    doc athletes/${doc.id}`);
    console.log(`    planStatus: "${de}" -> "${para}"`);
    console.log(`    marcacao:   ${revert ? '_mockPlan / _mockPlanNote / _mockPlanSince removidos'
                                          : '_mockPlan=true, _mockPlanNote, _mockPlanSince gravados'}`);

    if (commit) {
      await doc.ref.update(patch);
      console.log('    gravado.\n');
    } else {
      console.log('    (simulacao — nada gravado)\n');
    }
    alterados++;
  }

  console.log(`Resumo: ${alterados} documento(s) ${commit ? 'alterado(s)' : 'que seriam alterados'}, ${ignorados} ignorado(s).`);
  if (!commit) console.log('Nenhuma gravacao foi feita. Repita com --commit para aplicar.');
  if (commit && !revert) {
    console.log('\nAbra /admin/atletas em quality_env, clique no atleta e va nas abas Treino e Nutricional.');
    console.log('Lembrete: o conteudo exibido e de demonstracao, para avaliacao interna.');
  }
}

main().catch(e => { console.error('Falha:', e); process.exit(1); });
