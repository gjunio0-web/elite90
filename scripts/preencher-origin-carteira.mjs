// ELITE90 PRO · preencher-origin-carteira
// -----------------------------------------------------------------------------
// Rotina ÚNICA de preenchimento da origem (`origin`) dos vínculos de carteira
// criados antes de a atribuição passar a gravá-la.
//
// Fundamento: Adendo 09 — Titularidade e Superfície Administrativa, decisão
// AT-03. "Vínculos anteriores recebem `explicit` por rotina única — nunca
// `null`." Critério de aceite CT-13: depois da rotina, nenhum vínculo tem
// `origin` nulo.
//
// POR QUE TODOS RECEBEM `explicit`. Até a Fase 4-D não existia titularidade:
// todo vínculo em `assignments` nasceu de atribuir-carteira.ts, que é o ato
// individual do Coach sobre um atleta. `default` é a origem dos vínculos que a
// definição de titular materializa, e nenhum deles pode ser anterior a este
// script — a função que os cria ainda não existe.
//
//   • ENSAIO EM SECO POR PADRÃO. Nada é gravado sem --commit.
//   • TOCA UM CAMPO POR DOCUMENTO. Grava apenas `origin`, com `update()`,
//     nunca `set()` — nenhum outro campo é lido de volta ou reescrito.
//   • NUNCA SOBRESCREVE. Vínculo que já tem origem válida é listado e ignorado.
//     `origin` é IMUTÁVEL depois de gravado (AT-03, CT-12), e esta rotina não é
//     exceção: ela preenche o que está vazio, não corrige o que está escrito.
//   • ORIGEM FORA DO VOCABULÁRIO É ERRO, NÃO CONSERTO. Se um documento tiver
//     `origin` preenchido com valor que não seja `default` nem `explicit`, a
//     rotina interrompe e aponta: corrigir à mão é decisão de quem opera, não
//     deste script.
//   • VÍNCULOS ENCERRADOS TAMBÉM SÃO PREENCHIDOS. A CT-13 fala de vínculo, não
//     de vínculo ativo, e a auditoria lê os encerrados. Deixá-los nulos criaria
//     exatamente o vazio que a AT-03 recusa, só que fora de vista.
//   • NÃO REGISTRA RASTREABILIDADE. Mesmo fundamento de
//     preencher-external-label.mjs, de 02/09/2026: o adendo não pede, o
//     vocabulário fechado de ações não tem entrada para isso, e migração de
//     dados não é ato de um ator sobre um alvo. O que fez fica impresso no
//     terminal.
//
// Uso (a partir da raiz do repositório, com .env.local presente):
//   node scripts/preencher-origin-carteira.mjs             # ensaio: mostra o que faria
//   node scripts/preencher-origin-carteira.mjs --commit    # grava
//
// EXECUÇÃO ÚNICA POR AMBIENTE, E SÓ DEPOIS DO DEPLOY. A rotina roda em cada
// ambiente DEPOIS que o código de carteira estiver implantado nele. Antes disso
// ela é inútil e enganosa: um vínculo criado naquele ambiente nasceria sem
// `origin` — a função que o grava não está lá —, e a rotina teria de rodar de
// novo. Em 08/09/2026 a produção (branch `main`) não tem sequer
// `netlify/functions/atribuir-carteira.ts`.
//
// Rodada num ambiente já implantado, e uma vez preenchidos os vínculos que
// existirem, este arquivo pode ser removido — atribuir-carteira já grava
// `origin` daqui em diante, e a definição de titular nascerá gravando. Rodar de
// novo não causa dano (não sobrescreve), apenas não encontra o que fazer, que é
// também como se confere a CT-13.
// -----------------------------------------------------------------------------

import { conectar } from './_firestore-cli.mjs';

// O vocabulário fechado vive em netlify/functions/_m2-validacao.ts
// (ASSIGNMENT_ORIGINS). Este script é .mjs e não alcança um módulo TypeScript;
// os dois valores estão repetidos aqui de propósito, e a rotina RECUSA qualquer
// valor fora desta lista em vez de assumir que a lista está atualizada. Se o
// vocabulário mudar antes de este arquivo ser removido, a divergência aparece
// como erro na primeira execução, e não como gravação silenciosa.
const ORIGENS_CONHECIDAS = ['default', 'explicit'];
const ORIGEM_A_GRAVAR = 'explicit';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

const db = conectar();

async function main() {
  console.log('== Preencher origin dos vínculos de carteira (rotina única) ==');
  console.log(COMMIT ? 'Modo:     GRAVAÇÃO (--commit)' : 'Modo:     ENSAIO EM SECO (nada é gravado; use --commit)');
  console.log(`Projeto:  ${process.env.PUBLIC_FIREBASE_PROJECT_ID}\n`);

  const snap = await db.collection('assignments').get();
  console.log(`assignments/: ${snap.size} documento(s).\n`);

  const semOrigem = [];
  const invalidos = [];
  let jaPreenchidos = 0;

  for (const doc of snap.docs) {
    const dados = doc.data() || {};
    const atual = dados.origin;
    if (atual === undefined || atual === null || atual === '') {
      semOrigem.push(doc);
    } else if (ORIGENS_CONHECIDAS.includes(atual)) {
      jaPreenchidos++;
      console.log(`  = ${doc.id}  já tem ${atual} — ignorado`);
    } else {
      invalidos.push({ id: doc.id, valor: atual });
    }
  }

  if (invalidos.length) {
    console.error('\n  ERRO: origem fora do vocabulário em documento(s) já preenchido(s). Corrija à mão antes de rodar:');
    for (const { id, valor } of invalidos) console.error(`    ${id}: ${JSON.stringify(valor)}`);
    process.exit(1);
  }

  if (!semOrigem.length) {
    console.log(`\n  Nenhum vínculo sem origem (${jaPreenchidos} já preenchido(s)). Nada a fazer.`);
    return;
  }

  console.log(`\n${semOrigem.length} vínculo(s) sem origem:\n`);

  let gravados = 0;
  for (const doc of semOrigem) {
    const dados = doc.data() || {};
    const marcador = COMMIT ? '+' : '~';
    const situacao = dados.endedAt ? 'encerrado' : 'ativo';
    console.log(
      `  ${marcador} ${doc.id}  ${ORIGEM_A_GRAVAR}  (${dados.specialty ?? '(sem especialidade)'}, ${situacao}, _test=${dados._test === true})`,
    );
    if (COMMIT) {
      await doc.ref.update({ origin: ORIGEM_A_GRAVAR });
      gravados++;
    }
  }

  console.log(COMMIT
    ? `\n${gravados} origem(ns) gravada(s).`
    : `\n${semOrigem.length} origem(ns) seriam gravadas. Rode com --commit para gravar.`);
}

main().catch((e) => {
  console.error('\n  ERRO:', e?.message ?? e);
  process.exit(1);
});
