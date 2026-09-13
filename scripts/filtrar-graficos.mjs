// ELITE90 PRO · filtrar-graficos
// -----------------------------------------------------------------------------
// Decide QUAL versão do módulo de "Progressão Física" entra na publicação.
//
//   ENTRADA  scripts/graficos/com-dados.js   (curvas simuladas — homologação)
//            scripts/graficos/sem-dados.js   (esqueleto + aviso — produção)
//   SAÍDA    apps/site/src/scripts/graficos.generated.js   (artefato de build)
//
//   CONTEXT === 'production'  → emite sem-dados.js
//   qualquer outro contexto   → emite com-dados.js
//   variável ausente          → assume produção, que é o lado seguro do erro.
//
// POR QUE ISTO EXISTE
// Mesma razão do filtrar-demo.mjs, que decidiu a questão primeiro para o
// plano-base: dado inventado vive em homologação e não vai a produção. Os três
// geradores de gráfico escaparam daquela decisão — rodavam igual em qualquer
// ambiente, sem distinção de contexto, marca de provisório ou aviso na tela.
// Em produção, o Coach via curvas de peso dia a dia que nunca aconteceram, sob
// um subtítulo afirmando ser evolução ao longo do ciclo. A Fase 4-D agravou ao
// replicar a mesma seção para a rota do profissional.
//
// POR QUE TROCAR O ARQUIVO INTEIRO, E NÃO RAMIFICAR DENTRO DELE
// Ramificar em tempo de execução deixaria `generateMock*` no pacote enviado ao
// navegador, mesmo sem ser chamado — e a CA-103 exige ausência, não silêncio.
// Trocando o arquivo na origem, o código simulado não chega nem ao servidor.
//
// POR QUE ESCREVER SEMPRE, E NUNCA APAGAR
// Diferente do plano-demo, cuja ausência é tratada no cliente com um `fetch`
// que falha em silêncio, aqui a página IMPORTA o arquivo gerado: se ele não
// existisse, o build quebraria. Então sempre há saída — o que muda é o
// conteúdo dela.
//
// ARTEFATO DURÁVEL enquanto a maquete existir. Some junto com ela, no dia em
// que a Progressão Física passar a ler weights/checkins/evaluations de verdade.
//
// Uso (normalmente automático, via npm run build):
//   node scripts/filtrar-graficos.mjs
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Ancorado na localização deste arquivo: o Netlify chama o build a partir de
// apps/site e o desenvolvedor costuma chamar da raiz.
const AQUI = dirname(fileURLToPath(import.meta.url));

const ORIGEM_COM = resolve(AQUI, 'graficos/com-dados.js');
const ORIGEM_SEM = resolve(AQUI, 'graficos/sem-dados.js');
const SAIDA = resolve(AQUI, '../apps/site/src/scripts/graficos.generated.js');

// Variável ausente é tratada como produção — o erro seguro é publicar de menos.
const contexto = process.env.CONTEXT ?? 'production';
const emProducao = contexto === 'production';

const origem = emProducao ? ORIGEM_SEM : ORIGEM_COM;

if (!existsSync(origem)) {
  console.error(`[filtrar-graficos] Origem ausente: ${origem}`);
  process.exit(1);
}

const conteudo = readFileSync(origem, 'utf8');

// Cabeçalho de artefato: quem abrir o arquivo gerado precisa saber que editá-lo
// não adianta — a próxima execução do build sobrescreve.
const aviso =
  `// GERADO POR scripts/filtrar-graficos.mjs — NÃO EDITE.\n` +
  `// Origem: scripts/graficos/${emProducao ? 'sem-dados' : 'com-dados'}.js\n` +
  `// CONTEXT=${contexto}${process.env.CONTEXT ? '' : ' (ausente — tratado como produção)'}\n\n`;

mkdirSync(dirname(SAIDA), { recursive: true });
writeFileSync(SAIDA, aviso + conteudo, 'utf8');

console.log(
  `[filtrar-graficos] CONTEXT=${contexto} → ` +
  `${emProducao ? 'SEM dados (esqueleto + aviso)' : 'COM dados (maquete)'} → ${SAIDA}`,
);
