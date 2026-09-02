// ELITE90 PRO · preencher-external-label
// -----------------------------------------------------------------------------
// Rotina ÚNICA de preenchimento do rótulo externo (`externalLabel`) para os
// atletas promovidos antes de a promoção passar a sorteá-lo.
//
// Fundamento: Adendo 02 — Delegação, seção 5.1 e decisão AD-12. "Atletas
// promovidos antes deste adendo recebem `externalLabel` por rotina de
// preenchimento única, não `null`. Um atleta sem rótulo é invisível ao
// delegado externo, o que é falha silenciosa." Critério de aceite CA-17: após
// a rotina, nenhum atleta tem `externalLabel` nulo.
//
//   • ENSAIO EM SECO POR PADRÃO. Nada é gravado sem --commit.
//   • TOCA UM CAMPO POR DOCUMENTO. Grava apenas `externalLabel`, com
//     `update()`, nunca `set()` — nenhum outro campo é lido de volta ou
//     reescrito.
//   • NUNCA SOBRESCREVE. Documento que já tem rótulo válido é listado e
//     ignorado. O rótulo é imutável (AD-03, CA-16) e esta rotina não é exceção.
//   • RÓTULO FORA DA FORMA É ERRO, NÃO CONSERTO. Se um documento tiver
//     `externalLabel` preenchido com valor que não casa com o padrão, a rotina
//     interrompe e aponta: corrigir à mão é decisão de quem opera, não deste
//     script.
//   • MESMO MÓDULO DA PROMOÇÃO. O sorteio vem de _external-label.js, o mesmo
//     que promote-lead.ts usa. Não há segunda definição da forma.
//   • COLISÃO CONFERIDA CONTRA O BANCO E CONTRA A PRÓPRIA EXECUÇÃO. Os rótulos
//     já existentes são carregados antes; cada sorteio é verificado contra esse
//     conjunto, que cresce a cada atribuição feita nesta execução.
//   • NÃO REGISTRA RASTREABILIDADE. Decisão de 02/09/2026: o adendo não pede,
//     o vocabulário fechado de ações não tem entrada para isso, e a rotina roda
//     uma vez sobre dois documentos. O que fez fica impresso no terminal.
//
// Uso (a partir da raiz do repositório, com .env.local presente):
//   node scripts/preencher-external-label.mjs             # ensaio: mostra o que faria
//   node scripts/preencher-external-label.mjs --commit    # grava
//
// EXECUÇÃO ÚNICA, NÃO RECORRENTE. Depois de rodar com --commit nos dois
// projetos que tiverem atletas sem rótulo, este arquivo pode ser removido —
// a promoção já garante o rótulo daqui em diante (CA-15). Rodar de novo não
// causa dano (não sobrescreve), apenas não encontra o que fazer.
// -----------------------------------------------------------------------------

import { createRequire } from 'node:module';
import { conectar } from './_firestore-cli.mjs';

// _external-label.js é CommonJS por decisão (compartilhado com o contrato e
// com o runner de emulação, ambos CJS). Daqui, importa-se via createRequire.
const require = createRequire(import.meta.url);
const { gerarExternalLabel, isExternalLabel } = require('../netlify/functions/_external-label.js');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const MAX_TENTATIVAS = 10;

const db = conectar();

async function main() {
  console.log('== Preencher externalLabel (rotina única) ==');
  console.log(COMMIT ? 'Modo:     GRAVAÇÃO (--commit)' : 'Modo:     ENSAIO EM SECO (nada é gravado; use --commit)');
  console.log(`Projeto:  ${process.env.PUBLIC_FIREBASE_PROJECT_ID}\n`);

  const snap = await db.collection('athletes').get();
  console.log(`athletes/: ${snap.size} documento(s).\n`);

  const semRotulo = [];
  const emUso = new Set();
  const invalidos = [];

  for (const doc of snap.docs) {
    const dados = doc.data() || {};
    const atual = dados.externalLabel;
    if (atual === undefined || atual === null || atual === '') {
      semRotulo.push(doc);
    } else if (isExternalLabel(atual)) {
      emUso.add(atual);
      console.log(`  = ${doc.id}  já tem ${atual}  (${dados.name || '(sem nome)'}) — ignorado`);
    } else {
      invalidos.push({ id: doc.id, valor: atual });
    }
  }

  if (invalidos.length) {
    console.error('\n  ERRO: rótulo fora da forma em documento(s) já preenchido(s). Corrija à mão antes de rodar:');
    for (const { id, valor } of invalidos) console.error(`    ${id}: ${JSON.stringify(valor)}`);
    process.exit(1);
  }

  if (!semRotulo.length) {
    console.log('\n  Nenhum atleta sem rótulo. Nada a fazer.');
    return;
  }

  console.log(`\n${semRotulo.length} atleta(s) sem rótulo:\n`);

  let gravados = 0;
  for (const doc of semRotulo) {
    const dados = doc.data() || {};
    let rotulo = null;
    for (let i = 0; i < MAX_TENTATIVAS && !rotulo; i++) {
      const codigo = gerarExternalLabel();
      if (emUso.has(codigo)) continue;
      // O conjunto em memória cobre o que foi lido no início e o que esta
      // execução atribuiu; a consulta abaixo cobre o que outro processo
      // possa ter gravado no intervalo. Redundante de propósito.
      const ocupado = await db.collection('athletes').where('externalLabel', '==', codigo).limit(1).get();
      if (ocupado.empty) rotulo = codigo;
    }
    if (!rotulo) {
      console.error(`\n  ERRO: sem rótulo livre em ${MAX_TENTATIVAS} tentativas para ${doc.id}. Interrompido.`);
      process.exit(1);
    }
    emUso.add(rotulo);

    const marcador = COMMIT ? '+' : '~';
    console.log(`  ${marcador} ${doc.id}  ${rotulo}  (${dados.name || '(sem nome)'}, _test=${dados._test === true})`);
    if (COMMIT) {
      await doc.ref.update({ externalLabel: rotulo });
      gravados++;
    }
  }

  console.log(COMMIT
    ? `\n${gravados} rótulo(s) gravado(s).`
    : `\n${semRotulo.length} rótulo(s) seriam gravados. Rode com --commit para gravar.`);
}

main().catch((e) => {
  console.error('\n  ERRO:', e?.message ?? e);
  process.exit(1);
});
