// tests/llm-comandos.test.js
// Prompt versions — T-17 (persistence plan v5.29, Phase 8, delivery 1).
//
// Each prompt is rendered with a fixed input and compared with the snapshot
// file named after its CURRENT version:
//   tests/fotografias/comando-<task>.v<n>.txt
// · Text changed, version unchanged → the comparison fails.
// · Version bumped → the file for the new version does not exist yet, and the
//   test fails until it is recorded (E90_GRAVAR_FOTOGRAFIAS=1). Old snapshots
//   stay: they document what each version said.
// The characterization snapshots (requisicao-*.json) carry the same prompt
// inside the full request and must be re-recorded in the same change.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { carregarTs, RAIZ } = require('./_carregar-ts.js');
const { versaoDeComandoValida } = require('../netlify/functions/_llm-nucleo.js');

const GRAVAR = process.env.E90_GRAVAR_FOTOGRAFIAS === '1';

function conferir(versao, texto) {
  const arquivo = path.join(RAIZ, 'tests', 'fotografias', `comando-${versao.replace('/', '.')}.txt`);
  if (GRAVAR) {
    fs.writeFileSync(arquivo, texto);
    return;
  }
  assert.ok(fs.existsSync(arquivo),
    `no snapshot for ${versao}: if the version was bumped on purpose, record it with E90_GRAVAR_FOTOGRAFIAS=1`);
  assert.equal(texto, fs.readFileSync(arquivo, 'utf8'),
    `the prompt text changed but ${versao} did not: bump the version in the same change`);
}

test('triagem-ajuste: versão declarada e texto fotografado', async () => {
  const { VERSAO_COMANDO_TRIAGEM_AJUSTE, comandoAjusteIA } = await carregarTs('netlify/functions/_scoring.ts');
  assert.ok(versaoDeComandoValida('triagem-ajuste', VERSAO_COMANDO_TRIAGEM_AJUSTE));
  assert.equal(comandoAjusteIA({}), null);
  const texto = comandoAjusteIA({
    objetivo_outro: '«objetivo_outro»',
    trt_detalhe: '«trt_detalhe»',
    competicao_detalhe: '«competicao_detalhe»',
    lesao_detalhe: '«lesao_detalhe»',
    suplementos_detalhe: '«suplementos_detalhe»',
  });
  conferir(VERSAO_COMANDO_TRIAGEM_AJUSTE, texto);
});

test('avaliacao-rascunho: versão declarada e texto fotografado (pt e en, com e sem fotos)', async () => {
  const { VERSAO_COMANDO_AVALIACAO_RASCUNHO, buildPrompt } = await carregarTs('netlify/functions/generate-evaluation.ts');
  assert.ok(versaoDeComandoValida('avaliacao-rascunho', VERSAO_COMANDO_AVALIACAO_RASCUNHO));
  // Every field the prompt reads, with a marker value; no birth date, so the
  // rendered age does not depend on today's date.
  const campos = ['nome', 'altura', 'peso', 'objetivo', 'atividade_fisica', 'frequencia_semanal',
    'disponibilidade_diaria', 'personal_trainer', 'competicao', 'competicao_detalhe', 'conhece_coach',
    'medico_esporte', 'trt', 'trt_detalhe', 'condicao_cardiaca', 'diabetes', 'doenca_cronica', 'lesao',
    'lesao_detalhe', 'dieta', 'refeicoes_dia', 'suplementos', 'suplementos_detalhe', 'agua_litros'];
  const lead = Object.fromEntries(campos.map((c) => [c, `«${c}»`]));
  const variantes = [
    ['pt, com fotos, com calibração', buildPrompt(lead, ['«calibracao-1»', '«calibracao-2»'], true)],
    ['en, sem fotos, sem calibração', buildPrompt({ ...lead, idioma: 'en' }, [], false)],
  ];
  const texto = variantes.map(([nome, t]) => `===== ${nome} =====\n${t}`).join('\n');
  conferir(VERSAO_COMANDO_AVALIACAO_RASCUNHO, texto);
});
