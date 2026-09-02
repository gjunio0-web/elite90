// ELITE90 PRO · _firestore-cli
// -----------------------------------------------------------------------------
// Conexão ao Firestore para scripts de linha de comando. Módulo compartilhado
// pelos geradores de base de domínio.
//
// POR QUE ESTE MÓDULO EXISTE
// A leitura de credencial, o carregamento do .env.local e o tratamento de erro
// eram idênticos em carregar-exercicios.mjs e gerar-catalogo-exercicios.mjs, e
// seriam copiados de novo a cada base nova. As mensagens de erro daqui não são
// decorativas: cada uma nomeia a causa provável, e foram escritas depois de a
// primeira versão devolver rastreamento de pilha cru na falha mais comum.
// Copiá-las seria garantir que a próxima correção fosse aplicada num lugar só.
//
// SOBRE O PARÂMETRO `sePossivel`
// gerar-catalogo-exercicios.mjs introduziu a opção C (25/08/2026): dentro do
// build do Netlify, falha de credencial não pode derrubar a publicação do site
// inteiro — o build segue com o arquivo-fonte versionado como reserva. Fora do
// build, a mesma falha é erro de quem digitou o comando, e abortar é a resposta
// certa. Centralizar conectar()/abortar() aqui só é seguro se os DOIS lados desse
// comportamento vierem junto — um abortar() que sempre derruba o processo
// reintroduziria em silêncio o acoplamento do build ao Firestore que a opção C
// existe para evitar. Por isso o parâmetro viaja explícito por toda a cadeia,
// em vez de ser lido de novo de process.argv aqui dentro.
//
// ARTEFATO DURÁVEL.
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

export const RAIZ_PROJETO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// O projeto esperado vem do ambiente, não do código. Com projetos separados
// (produção e homologação), um valor embutido faria a guarda avisar em toda
// execução legítima de homologação — e aviso que aparece sempre é aviso que
// ninguém lê no dia em que significa alguma coisa.
//
// CORREÇÃO (02/09/2026): esta constante costumava ser lida aqui, no topo do
// módulo — ou seja, na importação, antes de carregarEnvLocal() rodar dentro
// de conectar(). Em ESM o topo do módulo executa inteiro antes de qualquer
// função exportada ser chamada, então o valor ficava congelado como
// `undefined` sempre que a variável só existisse em .env.local (e não já no
// ambiente do processo). O sintoma era "PUBLIC_FIREBASE_PROJECT_ID ausente
// no ambiente" mesmo com o arquivo preenchido corretamente — reproduzido
// isoladamente fora deste arquivo antes da correção. Por isso a leitura desce
// para dentro de conectar(), depois de carregarEnvLocal(). gerar-base.mjs não
// exibia o sintoma porque roda dentro do build do Netlify, onde a variável já
// está no ambiente antes do processo começar — nunca dependeu de .env.local.

/**
 * `sePossivel: true` troca "derrubar o processo" por "avisar e devolver null" —
 * quem chama decide o que fazer com um retorno nulo. Sem a bandeira, o
 * comportamento é o de sempre: mensagem e process.exit(1).
 */
export function abortar(msg, { sePossivel = false } = {}) {
  if (sePossivel) {
    console.warn(`\n  AVISO: ${msg}`);
    console.warn('  Seguindo sem esta base — o build usa o arquivo-fonte versionado como reserva.\n');
    return null;
  }
  console.error(`\n  ERRO: ${msg}\n`);
  process.exit(1);
}

// Carrega .env.local da raiz do projeto, sem dependência de dotenv.
// Mesmo mecanismo de scripts/set-admin-claim.js — dois comportamentos
// diferentes para a mesma coisa seria pior que qualquer um dos dois: quem roda
// um script espera que o outro funcione igual. Variável já presente no
// ambiente tem precedência sobre o arquivo.
export function carregarEnvLocal() {
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

/**
 * Devolve a instância do Firestore, ou `null` se `sePossivel` estiver ativo e
 * a credencial faltar/for recusada — nunca lança nesse caso, para que quem
 * chama decida como seguir sem banco.
 */
export function conectar({ sePossivel = false } = {}) {
  carregarEnvLocal();
  const PROJETO_ESPERADO = process.env.PUBLIC_FIREBASE_PROJECT_ID;
  const bruto = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '').trim();
  if (!bruto) {
    return abortar('FIREBASE_SERVICE_ACCOUNT_JSON não encontrada.\n'
      + '  Confira se existe .env.local na raiz do repositório com essa variável.\n'
      + '  Ela já deve existir: os scripts set-admin-claim.js e emulate-fn08.js usam a mesma.\n'
      + '  NÃO gere uma chave nova sem antes verificar — chave a mais é segredo a mais para controlar.',
      { sePossivel });
  }
  let credencial;
  try {
    credencial = JSON.parse(bruto.startsWith('"') && bruto.endsWith('"') ? bruto.slice(1, -1) : bruto);
  } catch {
    return abortar('FIREBASE_SERVICE_ACCOUNT_JSON não é um JSON válido.', { sePossivel });
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
    return abortar('a credencial foi lida, mas o Firebase a recusou.\n'
      + `  Motivo: ${e?.message ?? e}\n`
      + '  Causa provável: a chave privada perdeu as quebras de linha na colagem.\n'
      + `  Confira também se project_id é "${PROJETO_ESPERADO}".`,
      { sePossivel });
  }
  if (!PROJETO_ESPERADO) {
    return abortar('PUBLIC_FIREBASE_PROJECT_ID ausente no ambiente.\n'
      + '  Sem ela não há como conferir se a credencial aponta para o banco certo.',
      { sePossivel });
  }
  if (credencial.project_id && credencial.project_id !== PROJETO_ESPERADO) {
    return abortar(`a credencial é do projeto "${credencial.project_id}", mas o ambiente declara "${PROJETO_ESPERADO}".\n`
      + '  Divergência entre credencial e ambiente INTERROMPE a execução — antes\n'
      + '  isto era apenas um aviso, e um aviso não impede gravar no banco errado.',
      { sePossivel });
  }
  return admin.firestore();
}
