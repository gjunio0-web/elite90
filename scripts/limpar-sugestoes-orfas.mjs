// ELITE90 PRO · limpar-sugestoes-orfas
// -----------------------------------------------------------------------------
// Apaga sugestões cujo athleteUid ou professionalId não correspondem mais a
// nenhum documento real — resíduo de contas de teste removidas por fora da
// aplicação (nenhuma função do projeto apaga professionals/ ou athletes/; ver
// diagnosticar-sugestao-orfa.mjs, que encontrou o problema pela primeira vez,
// e _diagnostico-sugestoes.mjs, de onde os dois roteiros leem o mesmo
// critério de "órfã").
//
//   • ENSAIO EM SECO POR PADRÃO. Nada é apagado sem --commit — mesma regra
//     de limpar-homologacao.mjs.
//   • RECUSA-SE A RODAR CONTRA PRODUÇÃO. A credencial é lida antes de
//     qualquer acesso e o project_id é comparado com a lista de projetos
//     proibidos — mesma trava de limpar-homologacao.mjs.
//   • NUNCA APAGA SUGESTÃO "pending" SEM --incluir-pendentes EXPLÍCITO. Uma
//     órfã pending ainda é algo que o profissional está esperando resposta;
//     apagá-la sem rastro é resolução mais drástica que recusar (o único
//     caminho que já tira uma sugestão da fila sem exigir que o cadastro do
//     profissional exista — ver recusar-sugestao.ts). Os dois flags
//     (--incluir-pendentes e --commit) são independentes de propósito: nenhum
//     é efeito colateral do outro.
//
// Uso:
//   node scripts/limpar-sugestoes-orfas.mjs                              # ensaio, sem tocar pending
//   node scripts/limpar-sugestoes-orfas.mjs --commit                     # apaga de verdade, sem tocar pending
//   node scripts/limpar-sugestoes-orfas.mjs --incluir-pendentes --commit # apaga também as pending órfãs
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listarSugestoesComDiagnostico, COLECAO_SUGESTOES } from './_diagnostico-sugestoes.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const INCLUIR_PENDENTES = args.includes('--incluir-pendentes');

// Mesma lista de limpar-homologacao.mjs — este roteiro também apaga
// documentos, então recebe a mesma trava.
const PROJETOS_PROIBIDOS = ['elite90-c716b'];

// ── Credenciais (mesmo mecanismo de limpar-homologacao.mjs) ──
const envPath = resolve(AQUI, '../.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
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
if (!saEnv) {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON ausente. Sem credencial declarada, o roteiro não executa.');
  process.exit(1);
}

let sa;
try {
  let raw = saEnv.trim();
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  if (raw.startsWith("'") && raw.endsWith("'")) raw = raw.slice(1, -1);
  try { sa = JSON.parse(raw); } catch { sa = JSON.parse(raw.replace(/\\"/g, '"')); }
  if (sa?.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
} catch (e) {
  console.error('Erro nas credenciais:', e.message);
  process.exit(1);
}

// ── TRAVA DE AMBIENTE — antes de initializeApp, mesma ordem de
// limpar-homologacao.mjs: um roteiro de exclusão não deve sequer abrir
// conexão com o projeto errado. ──
const projeto = sa?.project_id ?? '(desconhecido)';
if (PROJETOS_PROIBIDOS.includes(projeto)) {
  console.error(
    `RECUSADO: a credencial aponta para "${projeto}", que está na lista de projetos de produção.\n` +
    'Este roteiro apaga documentos e não roda contra produção em hipótese alguma.'
  );
  process.exit(1);
}

const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');

initializeApp({ credential: cert(sa) });
const db = getFirestore();

console.log(`Projeto: ${projeto}`);
console.log(COMMIT ? 'Modo: COMMIT — isto vai apagar documentos de verdade.' : 'Modo: ENSAIO — nada será apagado (rode de novo com --commit para gravar).');
console.log(INCLUIR_PENDENTES ? 'Escopo: inclui sugestões pending órfãs.' : 'Escopo: exclui sugestões pending órfãs (use --incluir-pendentes para alcançá-las).');
console.log('');

const todas = await listarSugestoesComDiagnostico(db, { todas: true });
const orfas = todas.filter((s) => s.orfa);

if (!orfas.length) {
  console.log('Nenhuma sugestão órfã encontrada. Nada a fazer.');
  process.exit(0);
}

const alvo = [];
const adiadas = [];
for (const s of orfas) {
  if (s.status === 'pending' && !INCLUIR_PENDENTES) adiadas.push(s);
  else alvo.push(s);
}

for (const s of orfas) {
  const motivo = !s.athleteOk
    ? `athleteUid ${s.athleteUid} sem documento em athletes/`
    : `professionalId ${s.professionalId} sem documento em professionals/`;
  const adiada = s.status === 'pending' && !INCLUIR_PENDENTES;
  const acao = adiada ? 'ADIADA (pending — use --incluir-pendentes)' : (COMMIT ? 'APAGADA' : 'seria apagada');
  console.log(`[${s.id}] status=${s.status} planType=${s.planType} — ${motivo} — ${acao}`);
}
console.log('');

if (adiadas.length) {
  console.log(`${adiadas.length} sugestão(ões) pending órfã(s) NÃO tocada(s) — "Recusar" na tela de Aprovações continua sendo o caminho para tirá-las da fila sem apagar nada.\n`);
}

if (!alvo.length) {
  console.log('Nenhuma sugestão elegível para apagar neste modo.');
  process.exit(0);
}

if (!COMMIT) {
  console.log(`[ENSAIO] ${alvo.length} sugestão(ões) seriam apagadas. Rode de novo com --commit para gravar.`);
  process.exit(0);
}

for (const s of alvo) {
  await db.collection(COLECAO_SUGESTOES).doc(s.id).delete();
}
console.log(`${alvo.length} sugestão(ões) apagada(s).`);
