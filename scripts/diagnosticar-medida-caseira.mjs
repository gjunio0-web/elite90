// ELITE90 PRO · diagnosticar-medida-caseira
// -----------------------------------------------------------------------------
// SOMENTE LEITURA. Não apaga, não grava, não corrige nada — só relata.
//
// Conta quantos alimentos (foods/) têm o campo medidaCaseira preenchido vs
// vazio, no total e dentro de cada estado que a tela de Base de Alimentos usa
// (aguardando/revisados/arquivados/sem-macros — mesma partição de
// filtrarEPaginar em listar-alimentos.ts).
//
// POR QUE ESTE ROTEIRO EXISTE
// O Coach reportou que marcar "Sem medida caseira" na tela não muda a lista
// exibida. O mecanismo (checkbox, JS, filtro no servidor) foi conferido e
// está correto isoladamente — a hipótese que falta testar é sobre o DADO, não
// o código: se nenhum (ou quase nenhum) alimento no filtro ativo já tem
// medidaCaseira preenchida, o filtro "sem medida caseira" é um recorte que
// praticamente não recorta nada — a lista visível já é quase idêntica, com ou
// sem o filtro. Este roteiro mede exatamente isso.
//
// Uso:
//   node scripts/diagnosticar-medida-caseira.mjs
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

// ── Credenciais (mesmo mecanismo de diagnosticar-sugestao-orfa.mjs) ──
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
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON ausente (nem em .env.local, nem no ambiente). Sem credencial, o roteiro não executa.');
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

const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');

initializeApp({ credential: cert(sa) });
const db = getFirestore();

console.log(`Projeto: ${sa?.project_id ?? '(desconhecido)'}`);
console.log('');

const snap = await db.collection('foods').get();
const todos = snap.docs.map((d) => {
  const x = d.data();
  return {
    id: d.id,
    nome: x.nomeExibicao ?? x.nome ?? '(sem nome)',
    medidaCaseira: x.medidaCaseira ?? null,
    ativo: x.ativo !== false,
    publicado: x.publicado === true,
    revisado: Boolean(x.revisadoPor),
  };
});

const preenchida = (a) => a.medidaCaseira != null && String(a.medidaCaseira).trim() !== '';

const grupos = {
  'todos os documentos': todos,
  'ativos': todos.filter((a) => a.ativo),
  'aguardando (ativo + publicado + não revisado — aba padrão da tela)': todos.filter((a) => a.ativo && a.publicado && !a.revisado),
  'revisados (ativo + revisado)': todos.filter((a) => a.ativo && a.revisado),
  'arquivados (não ativo)': todos.filter((a) => !a.ativo),
  'sem macros completos (ativo + não publicado)': todos.filter((a) => a.ativo && !a.publicado),
};

for (const [rotulo, itens] of Object.entries(grupos)) {
  const comMedida = itens.filter(preenchida).length;
  console.log(`${rotulo}: ${itens.length} item(ns), ${comMedida} com medida caseira preenchida, ${itens.length - comMedida} sem.`);
}

console.log('');
const exemplosPreenchidos = todos.filter(preenchida).slice(0, 5);
if (exemplosPreenchidos.length) {
  console.log('Exemplos com medida caseira preenchida:');
  for (const a of exemplosPreenchidos) console.log(`  [${a.id}] ${a.nome} — "${a.medidaCaseira}"`);
} else {
  console.log('NENHUM alimento na coleção inteira tem medidaCaseira preenchida — o filtro "sem medida caseira" hoje não pode mudar a lista visível em NENHUM estado, porque todo item já qualifica.');
}
