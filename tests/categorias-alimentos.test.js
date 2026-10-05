// tests/categorias-alimentos.test.js
// The food categories are written in three places: the server vocabulary
// (_vocabulario-alimentos.ts, which validates), the admin screen
// (alimentos.astro) and the professional's proposal form
// (packages/editor-plano/nucleo.js). The copies are manual, so this test fails
// when they stop agreeing — an extra category in one place and not in another is
// either rejected by the server or invisible on the screen.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/** Quoted strings of the array literal that follows `marcador`, up to its `]`. */
function lista(fonte, marcador) {
  const i = fonte.indexOf(marcador);
  assert.ok(i >= 0, `marcador não encontrado: ${marcador}`);
  const fim = fonte.indexOf(']', i);
  return [...fonte.slice(i, fim).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const SERVIDOR = lista(ler('netlify/functions/_vocabulario-alimentos.ts'), 'export const CATEGORIAS = [');
const TELA = lista(ler('apps/site/src/pages/admin/alimentos.astro'), 'const CATEGORIAS = [');
const EDITOR = lista(ler('packages/editor-plano/nucleo.js'), 'var PI_CATEGORIAS = [');

test('as três listas de categorias são iguais, na mesma ordem', () => {
  assert.deepEqual(TELA, SERVIDOR, 'alimentos.astro difere do vocabulário do servidor');
  assert.deepEqual(EDITOR, SERVIDOR, 'nucleo.js (PI_CATEGORIAS) difere do vocabulário do servidor');
});

test('são 16 categorias: as 15 da TACO e Suplementos', () => {
  assert.equal(SERVIDOR.length, 16);
  assert.equal(new Set(SERVIDOR).size, 16, 'sem repetição');
  assert.ok(SERVIDOR.includes('Suplementos'));
});

test('a lista segue a ordem alfabética (é a ordem em que a tela a mostra)', () => {
  const ordenada = [...SERVIDOR].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  assert.deepEqual(SERVIDOR, ordenada);
});

test('categoriaValida aceita Suplementos e recusa o que não está na lista', async () => {
  const { carregarTs } = require('./_carregar-ts.js');
  const { categoriaValida } = await carregarTs('netlify/functions/_vocabulario-alimentos.ts');
  assert.equal(categoriaValida('Suplementos'), true);
  assert.equal(categoriaValida('suplementos'), false);
  assert.equal(categoriaValida('Suplemento'), false);
  assert.equal(categoriaValida('Ovos e derivados'), true);
});
