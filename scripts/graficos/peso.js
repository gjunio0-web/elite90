// ELITE90 PRO · graficos/peso.js
// -----------------------------------------------------------------------------
// "Evolução do Peso" block of Progressão Física — REAL data, the same file in
// every environment (M2 Phase 3, persistence plan).
//
// scripts/filtrar-graficos.mjs prepends this file to com-dados.js (outside
// production) or sem-dados.js (production). Those two still decide the other
// two blocks — V-Taper and Symmetry — whose data arrive in Phases 4 and 6.
// Weight no longer has a simulated version anywhere: the mock weight generator
// was removed from com-dados.js, so nothing invented reaches the weight chart,
// in production or in homologation (CA-103 still holds for the other blocks).
//
// WHERE THE DATA COME FROM
// The page provides `window.E90_CARREGAR_SERIE_PESO(athleteUid)`, a function
// returning the response of ler-serie-peso. /admin/atletas provides it (through
// its single reader, m2Ler). /profissional does not — reading by delegated
// professionals is a separate item (owner decision, 25/09/2026) — so there the
// block shows the static skeleton with the same notice as before.
//
// HONEST EMPTY STATE (plan, common rule 7)
// No loader, no points, a load error or Chart.js missing: the block shows a
// static skeleton and says which of these it is. The skeleton is fixed markup
// and never derives from athlete data (CA-108).
//
// DESIGN SYSTEM
// Colours come from tokens.css — inline styles use var(--c-…), and the canvas,
// which cannot read CSS variables, receives the token values read with
// getComputedStyle. The weight change is shown in a NEUTRAL colour: whether a
// gain is good depends on the phase, and that reading belongs to the Coach
// (owner decision, 25/09/2026). The dashed skeleton lines use a translucent
// overlay in SVG attributes — Design System §1.5 exceptions.
//
// Public names are prefixed `e90Peso` because this file shares one global
// scope with com-dados.js / sem-dados.js in the generated bundle.
// -----------------------------------------------------------------------------

var E90_PESO_EIXO = 'rgba(255, 255, 255, 0.10)';
var E90_PESO_PERIODOS = [30, 60, 90];
var E90_PESO_FUSO = 'America/Sao_Paulo';

var e90PesoEstado = { el: null, dados: null, dias: 30, grafico: null, seq: 0 };

function e90PesoToken(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
}

function e90PesoKg(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' kg';
}

/** Civil date today in the programme's time zone, AAAA-MM-DD. */
function e90PesoHoje() {
  var p = new Intl.DateTimeFormat('en-CA', {
    timeZone: E90_PESO_FUSO, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  function v(t) { for (var i = 0; i < p.length; i++) if (p[i].type === t) return p[i].value; return ''; }
  return v('year') + '-' + v('month') + '-' + v('day');
}

/** AAAA-MM-DD shifted by `n` days, computed in UTC to stay clear of DST. */
function e90PesoSomarDias(dataCivil, n) {
  var a = dataCivil.split('-');
  var t = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + n));
  return t.toISOString().slice(0, 10);
}

function e90PesoTitulo() {
  return (
    '<h3 style="font-family:var(--font-display,\'Bebas Neue\'),sans-serif;color:var(--c-lime);' +
      'margin:0 0 4px 0;font-size:16px;font-weight:400;letter-spacing:0.05em;">Evolução do Peso</h3>' +
    '<p style="font-family:var(--font-body,Montserrat),sans-serif;color:var(--c-textsub);font-size:11px;margin:0 0 16px 0;">' +
      'Peso diário e média móvel de 7 dias</p>'
  );
}

/** Static skeleton — fixed coordinates for every athlete (CA-108). */
function e90PesoEsqueleto(frase) {
  return (
    '<div style="border:1px solid var(--c-border);border-radius:4px;padding:16px;background:var(--c-darkbg);">' +
      '<svg viewBox="0 0 300 80" width="100%" height="80" preserveAspectRatio="none" aria-hidden="true">' +
        '<line x1="0" y1="79" x2="300" y2="79" stroke="' + E90_PESO_EIXO + '" stroke-width="1"/>' +
        '<line x1="0.5" y1="0" x2="0.5" y2="80" stroke="' + E90_PESO_EIXO + '" stroke-width="1"/>' +
        '<line x1="0" y1="20" x2="300" y2="20" stroke="' + E90_PESO_EIXO + '" stroke-width="1" stroke-dasharray="3 6"/>' +
        '<line x1="0" y1="45" x2="300" y2="45" stroke="' + E90_PESO_EIXO + '" stroke-width="1" stroke-dasharray="3 6"/>' +
      '</svg>' +
      '<p style="font-family:var(--font-body,Montserrat),sans-serif;font-size:11px;color:var(--c-textsub);' +
        'margin:12px 0 0 0;text-align:center;">' + frase + '</p>' +
    '</div>'
  );
}

function e90PesoMetrica(rotulo, id) {
  return (
    '<div><div style="font-family:var(--font-label,Raleway),sans-serif;font-size:10px;font-weight:700;' +
      'color:var(--c-textsub);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">' + rotulo + '</div>' +
    '<div id="' + id + '" style="font-family:var(--font-body,Montserrat),sans-serif;font-size:15px;' +
      'font-weight:600;color:var(--c-light);">—</div></div>'
  );
}

function e90PesoBotoes() {
  var html = '<div role="group" aria-label="Período" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">';
  for (var i = 0; i < E90_PESO_PERIODOS.length; i++) {
    var d = E90_PESO_PERIODOS[i];
    html +=
      '<button type="button" data-e90-peso-dias="' + d + '" aria-pressed="false" onclick="e90PesoPeriodo(' + d + ')" ' +
        'style="font-family:var(--font-label,Raleway),sans-serif;font-size:12px;font-weight:700;letter-spacing:.03em;' +
        'padding:6px 14px;border-radius:999px;border:1px solid var(--c-border-strong);' +
        'background:var(--c-darkbg);color:var(--c-textsub);cursor:pointer;transition:.15s;">' + d + 'd</button>';
  }
  return html + '</div>';
}

function e90PesoMarcarBotoes(dias) {
  var bs = e90PesoEstado.el ? e90PesoEstado.el.querySelectorAll('[data-e90-peso-dias]') : [];
  for (var i = 0; i < bs.length; i++) {
    var ativo = +bs[i].getAttribute('data-e90-peso-dias') === dias;
    bs[i].setAttribute('aria-pressed', ativo ? 'true' : 'false');
    bs[i].style.background = ativo ? 'var(--c-lime)' : 'var(--c-darkbg)';
    bs[i].style.color = ativo ? 'var(--c-black)' : 'var(--c-textsub)';
    bs[i].style.borderColor = ativo ? 'var(--c-lime)' : 'var(--c-border-strong)';
  }
}

function e90PesoDestruir() {
  if (e90PesoEstado.grafico) { try { e90PesoEstado.grafico.destroy(); } catch (e) {} }
  e90PesoEstado.grafico = null;
}

function e90PesoVazio(el, frase) {
  e90PesoDestruir();
  el.innerHTML = e90PesoTitulo() + e90PesoEsqueleto(frase);
}

/**
 * Entry point, called by initCharts in com-dados.js / sem-dados.js with the
 * block's element and the athlete of the open drawer.
 */
function e90PesoIniciar(el, athlete) {
  if (!el) return;
  var seq = ++e90PesoEstado.seq;
  e90PesoEstado.el = el;
  e90PesoEstado.dados = null;
  e90PesoEstado.dias = 30;

  var carregar = window.E90_CARREGAR_SERIE_PESO;
  var uid = athlete && (athlete.id || athlete.uid);
  if (typeof carregar !== 'function' || !uid) {
    e90PesoVazio(el, 'Histórico de progressão ainda não disponível.');
    return;
  }

  e90PesoVazio(el, 'Carregando a série de peso…');
  Promise.resolve()
    .then(function () { return carregar(uid); })
    .then(function (r) {
      if (seq !== e90PesoEstado.seq) return; // another drawer opened meanwhile
      var pontos = (r && Array.isArray(r.pontos)) ? r.pontos : [];
      if (!pontos.length) { e90PesoVazio(el, 'Nenhum peso registrado ainda.'); return; }
      e90PesoEstado.dados = r;
      e90PesoMontar();
    })
    .catch(function (e) {
      if (seq !== e90PesoEstado.seq) return;
      console.error('Erro ao carregar a série de peso:', e);
      e90PesoVazio(el, 'Não foi possível carregar a série de peso.');
    });
}

function e90PesoMontar() {
  var el = e90PesoEstado.el;
  el.innerHTML =
    e90PesoTitulo() +
    e90PesoBotoes() +
    '<div id="e90-peso-area"></div>' +
    '<div style="display:flex;column-gap:24px;row-gap:8px;margin-top:8px;flex-wrap:wrap;">' +
      e90PesoMetrica('Peso inicial', 'e90-peso-inicial') +
      e90PesoMetrica('Peso atual', 'e90-peso-atual') +
      e90PesoMetrica('Variação', 'e90-peso-variacao') +
      e90PesoMetrica('Menor no período', 'e90-peso-menor') +
      e90PesoMetrica('Maior no período', 'e90-peso-maior') +
    '</div>' +
    (e90PesoEstado.dados.truncado
      ? '<p style="font-size:11px;color:var(--c-textsub);margin:8px 0 0 0;">Série longa: os registros mais antigos não foram carregados.</p>'
      : '');
  e90PesoPeriodo(e90PesoEstado.dias);
}

/** Period switch (30/60/90 days, ending today in the programme's time zone). */
function e90PesoPeriodo(dias) {
  var r = e90PesoEstado.dados;
  if (!r || !e90PesoEstado.el) return;
  e90PesoEstado.dias = dias;
  e90PesoMarcarBotoes(dias);

  var todos = r.pontos;
  var ultimo = todos[todos.length - 1];
  var inicial = typeof r.weightInitialKg === 'number' ? r.weightInitialKg : null;
  function put(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
  put('e90-peso-inicial', e90PesoKg(inicial));
  put('e90-peso-atual', e90PesoKg(ultimo.weightKg));
  if (inicial !== null) {
    var va = ultimo.weightKg - inicial;
    put('e90-peso-variacao', (va > 0 ? '+' : '') + e90PesoKg(va));
  } else {
    put('e90-peso-variacao', '—');
  }

  var fim = e90PesoHoje();
  var inicio = e90PesoSomarDias(fim, -(dias - 1));
  var porDia = {};
  var noPeriodo = [];
  for (var i = 0; i < todos.length; i++) {
    if (todos[i].measuredOn >= inicio && todos[i].measuredOn <= fim) {
      porDia[todos[i].measuredOn] = todos[i];
      noPeriodo.push(todos[i].weightKg);
    }
  }
  put('e90-peso-menor', noPeriodo.length ? e90PesoKg(Math.min.apply(null, noPeriodo)) : '—');
  put('e90-peso-maior', noPeriodo.length ? e90PesoKg(Math.max.apply(null, noPeriodo)) : '—');

  var area = document.getElementById('e90-peso-area');
  if (!area) return;
  e90PesoDestruir();

  if (!noPeriodo.length) {
    area.innerHTML = e90PesoEsqueleto('Sem registros nos últimos ' + dias + ' dias.');
    return;
  }
  if (typeof Chart === 'undefined') {
    area.innerHTML = e90PesoEsqueleto('O gráfico não pôde ser carregado. Os números abaixo continuam válidos.');
    return;
  }

  // One slot per civil day, so missing days show as gaps in time instead of
  // being squeezed out of the axis.
  var rotulos = [], bruto = [], media = [];
  for (var d = inicio; d <= fim; d = e90PesoSomarDias(d, 1)) {
    var p = porDia[d];
    rotulos.push(d.slice(8, 10) + '/' + d.slice(5, 7));
    bruto.push(p ? p.weightKg : null);
    media.push(p ? p.mma7 : null);
  }

  area.innerHTML = '<canvas id="e90-peso-canvas" height="140" style="width:100% !important;max-width:100%;"></canvas>';
  var lima = e90PesoToken('--c-lime');
  var corpo = e90PesoToken('--c-textbody');
  var sub = e90PesoToken('--c-textsub');
  var borda = e90PesoToken('--c-border');

  e90PesoEstado.grafico = new Chart(document.getElementById('e90-peso-canvas'), {
    type: 'line',
    data: {
      labels: rotulos,
      datasets: [
        { label: 'Peso do dia', data: bruto, borderColor: lima, backgroundColor: lima,
          pointRadius: 3, pointBackgroundColor: lima, tension: 0.3, spanGaps: true, fill: false },
        { label: 'Média móvel de 7 dias', data: media, borderColor: corpo, borderWidth: 2,
          pointRadius: 0, tension: 0.3, spanGaps: true, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { labels: { color: sub, font: { size: 11 } }, position: 'bottom' },
        tooltip: { callbacks: { label: function (c) {
          return c.parsed.y == null ? null : c.dataset.label + ': ' + e90PesoKg(c.parsed.y);
        } } }
      },
      scales: {
        x: { grid: { color: borda }, ticks: { color: sub, font: { size: 10 }, maxTicksLimit: 10 } },
        y: { grid: { color: borda }, ticks: { color: sub, font: { size: 10 }, callback: function (v) {
          return v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        } } }
      }
    }
  });
}
