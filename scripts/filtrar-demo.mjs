// ELITE90 PRO · filtrar-demo
// -----------------------------------------------------------------------------
// Decide se o plano-base de DEMONSTRAÇÃO entra na publicação.
//
//   ENTRADA  scripts/dados-demo/plano-base.json          (versionado no Git)
//   SAÍDA    apps/site/public/dados/plano-demo.json      (artefato de build)
//
//   CONTEXT === 'production'  → NÃO emite. Remove o arquivo se ele existir.
//   qualquer outro contexto   → emite, e o painel abre a maquete preenchida.
//   variável ausente          → assume produção, que é o lado seguro do erro.
//
// POR QUE ISTO EXISTE
// O plano-base é dado inventado: 15 exercícios, 48 séries e 78 pontos de
// histórico de carga que nunca aconteceram. Ele vivia dentro de atletas.astro,
// e portanto ia no pacote publicado — inclusive em produção, onde ninguém
// deveria vê-lo. Pior: o editor entrega esse plano a QUALQUER atleta cujo
// planStatus não seja 'none', escalado pelo peso dele. No dia em que existir
// atleta real com plano publicado, ele veria números inventados com cara de
// legítimos, sem erro nem aviso.
//
// Tirar o dado do código e condicioná-lo ao contexto fecha as duas pontas: em
// produção o arquivo não existe, o painel não acha nada para carregar, e todo
// atleta cai no estado vazio — que é o comportamento correto enquanto o editor
// não lê plano de verdade do banco.
//
// POR QUE REMOVER O ARQUIVO, E NÃO SÓ DEIXAR DE ESCREVER
// A saída é ignorada pelo Git, então no Netlify cada build começa limpo e não
// haveria o que remover. Mas na máquina de quem desenvolve o arquivo sobra de
// uma execução anterior fora de produção, e um build de produção local
// publicaria a maquete sem que nada acusasse. Remover é barato e fecha isso.
//
// ARTEFATO DURÁVEL enquanto a maquete existir — e some junto com ela, no dia em
// que o editor passar a ler plano real. Ver o comentário em initWorkout.
//
// Uso (normalmente automático, via npm run build):
//   node scripts/filtrar-demo.mjs
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Ancorado na localização deste arquivo: o Netlify chama o build a partir de
// apps/site e o desenvolvedor costuma chamar da raiz.
const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const ENTRADA = resolve(RAIZ, 'scripts/dados-demo/plano-base.json');
const SAIDA = resolve(RAIZ, 'apps/site/public/dados/plano-demo.json');

const CONTEXTO = process.env.CONTEXT ?? 'production';

if (CONTEXTO === 'production') {
  if (existsSync(SAIDA)) {
    rmSync(SAIDA);
    console.log('[demo] contexto "production" — maquete removida da publicação');
  } else {
    console.log('[demo] contexto "production" — maquete não publicada');
  }
  process.exit(0);
}

// Fora de produção. Fonte ausente não derruba o build: sem o arquivo, o painel
// abre no estado vazio, que é degradação aceitável para dado de demonstração.
if (!existsSync(ENTRADA)) {
  console.warn(`\n[demo] arquivo-fonte ausente: ${ENTRADA}`);
  console.warn('[demo] a maquete não será publicada; o painel abrirá vazio.\n');
  process.exit(0);
}

let plano;
try {
  plano = JSON.parse(readFileSync(ENTRADA, 'utf8'));
} catch (e) {
  // JSON inválido é erro de quem commitou, não condição de ambiente.
  console.error(`\n[demo] arquivo-fonte inválido: ${e.message}\n`);
  process.exit(1);
}

mkdirSync(dirname(SAIDA), { recursive: true });
writeFileSync(SAIDA, JSON.stringify(plano), 'utf8');

const exercicios = (plano.order ?? []).reduce(
  (n, d) => n + ((plano.days?.[d]?.exercises ?? []).length), 0);
console.log(`[demo] contexto "${CONTEXTO}" — maquete publicada: ${exercicios} exercício(s) em ${(plano.order ?? []).length} dia(s)`);
