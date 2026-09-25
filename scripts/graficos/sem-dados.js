// ELITE90 PRO · graficos/sem-dados.js
// -----------------------------------------------------------------------------
// Módulo de "Progressão Física" — versão de PRODUÇÃO (Adendo 07, AC-33 · v1.27).
// Publicada quando CONTEXT === 'production', e também quando a variável está
// ausente: o lado seguro do erro é esconder de mais, nunca inventar número.
// Quem escolhe entre este arquivo e com-dados.js é scripts/filtrar-graficos.mjs.
//
// EXPÕE A MESMA INTERFACE de com-dados.js — `initCharts(athlete)` e
// `updateCharts(days)` —, porque quem chama (openAthleteDrawer na gaveta do
// Coach, popularVisaoGeral na do profissional) não deve saber em qual ambiente
// está. Trocar o arquivo basta; nenhuma página muda.
//
// ┌── CA-108 · O ESQUELETO É MARCAÇÃO ESTÁTICA, E ISSO NÃO PODE SER RELAXADO ──┐
// │ Nenhuma posição, largura, altura ou quantidade abaixo deriva de dado do   │
// │ atleta. Não há `athlete.id`, não há semente, não há cálculo: as mesmas    │
// │ coordenadas são emitidas para todo mundo. Um esqueleto que variasse com   │
// │ o atleta seria o mesmo defeito da AC-33 original, só que com opacidade    │
// │ menor em vez de maior — dado inventado continua inventado quando fica     │
// │ pálido. O parâmetro `athlete` é recebido para manter a assinatura, e é    │
// │ DELIBERADAMENTE IGNORADO.                                                 │
// └───────────────────────────────────────────────────────────────────────────┘
//
// CA-105 · TRÊS BLOCOS INDEPENDENTES, não um aviso cobrindo a seção. Cada
// gráfico tem título, subtítulo e público próprios; um único "indisponível"
// para os três esconderia que são três coisas distintas, e o usuário não
// saberia o que virá quando houver dado real.
//
// SEM OS NÚMEROS DE RESUMO. metric-peso-inicial, metric-ombros, metric-cintura,
// metric-vtaper, metric-sim-braco, metric-sim-coxa, metric-evolucao e o crachá
// de simetria derivavam todos das curvas inventadas — saem junto com elas.
//
// PHASE 3 (persistence plan): the weight block is no longer a skeleton here. It
// comes from scripts/graficos/peso.js, reads the real series and shows its own
// empty state when there is none; `athlete` is passed to IT only. The two
// blocks below stay static until Phases 4 and 6.
//
// SEM OS BOTÕES DE PERÍODO (30d/60d/90d). Sem série temporal, não há período a
// escolher; deixá-los seria oferecer um controle que não controla nada.
// -----------------------------------------------------------------------------

var E90_PLACEHOLDER_COR = 'rgba(166, 195, 0, 0.16)';
var E90_PLACEHOLDER_EIXO = 'rgba(255, 255, 255, 0.10)';

/** Moldura comum aos três: título, subtítulo, esqueleto e a mesma frase. */
function e90BlocoVazio(titulo, subtitulo, esqueleto) {
  return (
    '<div style="margin-bottom:32px;min-width:0;">' +
      '<h3 style="font-family:Bebas Neue;color:#A6C300;text-transform:uppercase;' +
        'margin:0 0 4px 0;font-size:16px;letter-spacing:0.05em;">' + titulo + '</h3>' +
      '<p style="color:#999;font-size:11px;margin:0 0 16px 0;">' + subtitulo + '</p>' +
      '<div style="position:relative;border:1px solid rgba(255,255,255,0.06);' +
        'border-radius:4px;padding:16px;background:rgba(255,255,255,0.01);">' +
        esqueleto +
        '<p style="font-family:Montserrat,sans-serif;font-size:11px;color:#777;' +
          'margin:12px 0 0 0;text-align:center;">' +
          'Histórico de progressão ainda não disponível.' +
        '</p>' +
      '</div>' +
    '</div>'
  );
}

// Barras pareadas — o formato de "V-Taper Profile" (ombros vs cintura).
function e90EsqueletoBarrasPareadas() {
  var barras = '';
  var xs = [30, 90, 150, 210];
  for (var i = 0; i < xs.length; i++) {
    barras +=
      '<rect x="' + xs[i] + '" y="20" width="18" height="59" fill="' + E90_PLACEHOLDER_COR + '"/>' +
      '<rect x="' + (xs[i] + 22) + '" y="40" width="18" height="39" fill="' + E90_PLACEHOLDER_COR + '"/>';
  }
  return (
    '<svg viewBox="0 0 300 80" width="100%" height="80" preserveAspectRatio="none" aria-hidden="true">' +
      '<line x1="0" y1="79" x2="300" y2="79" stroke="' + E90_PLACEHOLDER_EIXO + '" stroke-width="1"/>' +
      barras +
    '</svg>'
  );
}

// Barras agrupadas esquerda/direita — o formato de "Simetria e Densidade".
function e90EsqueletoBarrasAgrupadas() {
  var barras = '';
  var xs = [40, 130, 220];
  for (var i = 0; i < xs.length; i++) {
    barras +=
      '<rect x="' + xs[i] + '" y="30" width="14" height="49" fill="' + E90_PLACEHOLDER_COR + '"/>' +
      '<rect x="' + (xs[i] + 17) + '" y="34" width="14" height="45" fill="' + E90_PLACEHOLDER_COR + '"/>';
  }
  return (
    '<svg viewBox="0 0 300 80" width="100%" height="80" preserveAspectRatio="none" aria-hidden="true">' +
      '<line x1="0" y1="79" x2="300" y2="79" stroke="' + E90_PLACEHOLDER_EIXO + '" stroke-width="1"/>' +
      barras +
    '</svg>'
  );
}

/**
 * Mesma assinatura de com-dados.js. `athlete` é ignorado de propósito (CA-108)
 * pelos esqueletos; only the real weight block (peso.js) receives it.
 */
function initCharts(athlete) {
  var container = document.getElementById(window.E90_CHARTS_CONTAINER || 'elite-m2-charts');
  if (!container) return;

  container.innerHTML =
    '<div id="e90-peso-bloco" style="margin-bottom:32px;min-width:0;"></div>' +
    '<div class="charts-grid" style="display:grid;gap:32px;">' +
      e90BlocoVazio('V-Taper Profile', 'Ombros vs Cintura', e90EsqueletoBarrasPareadas()) +
      e90BlocoVazio('Simetria e Densidade', 'Braços e Coxas (esq/dir)', e90EsqueletoBarrasAgrupadas()) +
    '</div>';

  // Weight is real data in every environment (scripts/graficos/peso.js); its
  // block receives the athlete. The two skeletons above still ignore it.
  e90PesoIniciar(document.getElementById('e90-peso-bloco'), athlete);
}

/**
 * Existe só para preservar a interface: os botões de período não são
 * renderizados nesta versão, mas `updateCharts` é chamada de fora em algumas
 * rotas, e um erro de função ausente derrubaria o resto do script.
 */
function updateCharts(days) { /* sem série temporal, nada a atualizar */ }
