// @elite90/editor-plano — núcleo compartilhado do editor de plano.
//
// ÚNICA FONTE para a gaveta do Coach (atletas.astro) e, a partir do passo 2 da
// AC-16, para a rota restrita do profissional. Alterar o corpo do editor toca
// ESTE arquivo, nunca uma cópia (CA-42).
//
// Este arquivo NÃO pode conter import/export: é injetado como script clássico em
// <script is:inline set:html={...}>, onde o navegador rejeita sintaxe de módulo.
// Mesmo arranjo de @elite90/busca e @elite90/situacao (F-16 do Adendo 07).
//
// POR QUE `var`, E NÃO `const`/`let`
//
// `const` e `let` no topo de um script clássico são de escopo de SCRIPT, e não
// globais. Enquanto todo o editor vivia num único <script is:inline>, isso não
// aparecia. Ao partir o editor em dois scripts, seis destas ligações passam a
// ser lidas dos DOIS lados da fronteira — `wkeState`, `nteState`, `wkePlanCache`,
// `ntePlanCache`, `nteFormulaConfig` e `NTE_FORMULA_DEFAULTS` são usadas tanto
// aqui quanto pelo cabeçalho de publicação e pela configuração da fórmula, que
// ficam em atletas.astro (AC-15).
//
// Com `const`/`let`, o outro lado passaria a ler identificador indefinido EM
// TEMPO DE EXECUÇÃO, sem que `astro check`, `tsc` ou `astro build` acusassem
// nada. `var` no topo de script clássico é global, e preserva exatamente a
// semântica anterior à extração — nenhuma linha do lado retido precisou mudar.
//
// As 26 declarações migraram todas para `var` pelo mesmo motivo: no passo 1a as
// demais funções do editor ainda estão em atletas.astro e as leem de lá.
//
// ESCOPO DESTE ARQUIVO (AC-15)
// Entra: corpo do editor, contexto de cálculo, sobreposições de busca,
// quantidade e pré-visualização, e os controles de remoção de conteúdo do plano
// (CA-50). Fica fora: publicação, compartilhamento e a configuração da fórmula
// de macros — esta última porque `config/nutritionFormula` é configuração global
// do programa, e não conteúdo do plano de um atleta (CA-51).
//
// Este arquivo não chama doPublish, wkePublish, ntePublish, compartilharPlano
// nem shrAbrir (CA-49).
//
// ESTADO: passo 1a da AC-16 — estado de topo e funções puras. As funções de
// renderização e edição migram no passo 1b, com o contrato de gancho.


// ---------- estado de topo do editor ----------

var WKE_EXERCISE_DB = [];

var wkeCatalogoEstado = 'nao-carregado'; // nao-carregado | carregando | pronto | erro

var wkeCatalogoMotivo = '';

var wkeCatalogoSemente = false;

var WKE_DEMO_PLAN = null;

var wkeState = { athlete: null, plan: null, activeDay: 'A' };

var wkePlanCache = {}; // por id de atleta — preserva edições na sessão

var wkeSearchSelIdx = -1;

var WKE_SETUP_TIME = 60; // s de montagem por exercício (C-04)

var wkeDayMenuFor = null;

var wkeDragState = null;

var wkeSearchResults = [];

var wkeSearchTimer = null;

var wkeToastWrap = null;

var wkeSaveTimer = null;

var NTE_FOOD_DB = [];

var nteCatalogoEstado = 'nao-carregado'; // nao-carregado | carregando | pronto | erro

var nteCatalogoMotivo = '';

var nteCatalogoSemente = false;

var NTE_FORMULA_DEFAULTS = {
  'Bulking':     { p: 2.0, c: 5.0, g: 1.1 },
  'Cutting':     { p: 2.4, c: 3.0, g: 0.8 },
  'Manutenção':  { p: 2.0, c: 4.0, g: 1.0 },
  'Diet Break':  { p: 2.2, c: 3.5, g: 0.9 }
};

var nteFormulaConfig;

var nteState = { athlete: null, plan: null };

var ntePlanCache = {};

var nteSearchResults = [], nteSearchSelIdx = -1, ntePendingFood = null, ntePendingMeal = null;

var nteSearchTimer = null;

var nteSaveTimer = null;


// ---------- funções puras do editor ----------

function wkeBuildBasePlan() {
  return WKE_DEMO_PLAN ? JSON.parse(JSON.stringify(WKE_DEMO_PLAN)) : null;
}

function wkeEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wkeRound(v) { return Math.round(v / 2.5) * 2.5; }

function wkeRepsMid(reps) {
  if (!reps) return 10;
  const m = String(reps).match(/(\d+)\s*-\s*(\d+)/);
  if (m) return (parseInt(m[1]) + parseInt(m[2])) / 2;
  const n = String(reps).match(/\d+/);
  return n ? parseInt(n[0]) : 10;
}

function wkeComputeStats(day) {
  let exCount = day.exercises.length;
  let groups = new Set();
  let volume = 0, restTotal = 0;
  // P-04: exercícios com carga "a definir" (load null em todas as séries) não
  // entram no Volume — evitam que o número caia/zere só porque um exercício
  // novo ainda não teve a carga preenchida pelo Coach.
  let pendingCount = 0;
  day.exercises.forEach(function(ex) {
    groups.add(ex.group);
    var exHasAnyLoad = false;
    ex.sets.forEach(function(s) {
      if (s.load != null && s.load !== '') {
        volume += wkeRepsMid(s.reps) * (parseFloat(s.load) || 0);
        exHasAnyLoad = true;
      }
    });
    if (!exHasAnyLoad) pendingCount++;
    // C-04: descanso a nível de exercício
    restTotal += ex.sets.length * (parseInt(ex.rest_default) || 60);
  });
  // Duração = Σ(séries × descanso do exercício) + (nº exercícios × setup)
  const durMin = Math.round((restTotal + exCount * WKE_SETUP_TIME) / 60);
  return { exCount: exCount, groups: groups.size, volume: volume, durMin: durMin, pendingCount: pendingCount };
}

function wkeFmtVolume(v) {
  if (v >= 1000) return { val: (v / 1000).toFixed(1).replace('.', ','), unit: 't' };
  return { val: Math.round(v), unit: 'kg' };
}

function wkeStatCard(val, unit, label, sublabel) {
  return '<div class="wke-stat"><div class="wke-stat-value">' + val +
    (unit ? '<span class="wke-stat-unit">' + unit + '</span>' : '') +
    '</div><div class="wke-stat-label">' + label + '</div>' +
    (sublabel ? '<div class="wke-stat-sublabel">' + sublabel + '</div>' : '') +
    '</div>';
}

function wkeCurrentDay() { return wkeState.plan.days[wkeState.activeDay]; }

function wkeDayName(d) {
  const l = (wkeState.plan.days[d] && wkeState.plan.days[d].label) || ('Dia ' + d);
  return l.split('—')[0].trim();
}

function nteCongelarItem(f) {
  const b = f.base || {};
  return {
    foodId: f.foodId || (b.id || null),
    quantidadeG: f.qty,
    nomeSnapshot: f.name,
    medidaCaseiraSnapshot: b.medidaCaseira || null,
    // Macros por 100 g no instante da publicação.
    macrosSnapshot: { kcal: b.kcal || 0, p: b.p || 0, c: b.c || 0, g: b.g || 0 },
    fonteSnapshot: b.categoria ? { base: 'foods', categoria: b.categoria } : { base: 'foods' },
    // Marca de tempo do servidor quando a persistência existir. Enquanto o
    // plano vive em memória, o relógio do cliente é o que há — e o campo
    // fica explicitamente marcado como provisório, para não passar por
    // registro confiável.
    congeladoEm: null,
    _congeladoNoCliente: new Date().toISOString()
  };
}

function nteCongelarPlano(plan) {
  if (!plan || !plan.days) return;
  Object.keys(plan.days).forEach(function(dk) {
    const dia = plan.days[dk];
    (dia.meals || []).forEach(function(meal) {
      (meal.foods || []).forEach(function(f) {
        f.snapshot = nteCongelarItem(f);
      });
    });
  });
}

function nteGetFormulaForPhase(phase) {
  const p = (phase || '').toLowerCase();
  if (p.includes('cut')) return nteFormulaConfig['Cutting'] || NTE_FORMULA_DEFAULTS['Cutting'];
  if (p.includes('diet break')) return nteFormulaConfig['Diet Break'] || NTE_FORMULA_DEFAULTS['Diet Break'];
  if (p.includes('manu')) return nteFormulaConfig['Manutenção'] || NTE_FORMULA_DEFAULTS['Manutenção'];
  return nteFormulaConfig['Bulking'] || NTE_FORMULA_DEFAULTS['Bulking'];
}

function nteBuildBasePlan(athlete) {
  // Metas de macro via fórmula parametrizável (nteFormulaConfig)
  const w = athlete.weightCurrentKg || 80;
  const f = nteGetFormulaForPhase(athlete.phase);
  const target = {
    p: Math.round(w * f.p), c: Math.round(w * f.c), g: Math.round(w * f.g)
  };
  target.kcal = Math.round(target.p * 4 + target.c * 4 + target.g * 9);
  // MOCK AGUARDANDO REFAÇÃO — resolve por NOME num catálogo que já não é
  // fixo. Com o vetor literal removido, esta busca não encontra nada até o
  // carregamento assíncrono terminar, e os itens saem sem `base`. As guardas
  // de renderização absorvem isso exibindo zeros (ver `food.base ||` abaixo),
  // então a tela não quebra — mas os macros do plano de demonstração
  // aparecem zerados, e isso é esperado, não defeito.
  //
  // Refazer este construtor com foodId reais do catálogo carregado é item
  // próprio, já combinado, junto com o mock de exercícios. Enquanto isso não
  // acontece, o plano-base serve para exercitar a interface, não os números.
  const F = function(name, qty) {
    const f = NTE_FOOD_DB.find(function(x){ return x.name === name; });
    return { foodId: f ? f.id : null, name: name, qty: qty, base: f };
  };
  return {
    target: target,
    dayType: 'treino',
    days: {
      treino: { meals: [
        { name: 'Café da manhã', foods: [ F('Ovo inteiro', 150), F('Aveia em flocos', 60), F('Banana', 120) ] },
        { name: 'Almoço', foods: [ F('Peito de frango grelhado', 200), F('Arroz branco cozido', 200), F('Feijão preto cozido', 100), F('Brócolis cozido', 80) ] },
        { name: 'Pré-treino', foods: [ F('Batata doce cozida', 150), F('Whey protein (pó)', 30) ] },
        { name: 'Pós-treino', foods: [ F('Whey protein (pó)', 30), F('Banana', 120), F('Dextrose (pó)', 30) ] },
        { name: 'Jantar', foods: [ F('Patinho moído (95%)', 180), F('Arroz integral cozido', 150), F('Espinafre cru', 60) ] }
      ] },
      descanso: { meals: [
        { name: 'Café da manhã', foods: [ F('Ovo inteiro', 150), F('Pão integral', 60) ] },
        { name: 'Almoço', foods: [ F('Peito de frango grelhado', 180), F('Arroz integral cozido', 150), F('Feijão preto cozido', 100) ] },
        { name: 'Lanche', foods: [ F('Iogurte natural integral', 170), F('Pasta de amendoim', 20) ] },
        { name: 'Jantar', foods: [ F('Tilápia grelhada', 180), F('Batata doce cozida', 120), F('Brócolis cozido', 80) ] }
      ] }
    }
  };
}

function nteMacrosOf(food) {
  const k = (parseFloat(food.qty) || 0) / 100;
  const b = food.base || { kcal: 0, p: 0, c: 0, g: 0 };
  return { kcal: b.kcal * k, p: b.p * k, c: b.c * k, g: b.g * k };
}

function nteCurrentDay() { return nteState.plan.days[nteState.plan.dayType]; }

function nteDayTotals() {
  const t = { kcal: 0, p: 0, c: 0, g: 0 };
  nteCurrentDay().meals.forEach(function(m){ m.foods.forEach(function(f){ const x = nteMacrosOf(f); t.kcal+=x.kcal; t.p+=x.p; t.c+=x.c; t.g+=x.g; }); });
  return t;
}

function nteMealKcal(meal) { let k=0; meal.foods.forEach(function(f){ k += nteMacrosOf(f).kcal; }); return k; }

function nteBarClass(current, target) {
  if (!target) return 'on';
  const pct = Math.abs(current - target) / target * 100;
  if (pct <= 5) return 'on';
  if (pct <= 10) return 'near';
  return 'off';
}

function nteMacroCard(label, current, target, unit) {
  const pct = target ? Math.min(100, current / target * 100) : 0;
  const cls = nteBarClass(current, target);
  const rounded = Math.round(current);
  const delta = target ? Math.round(current - target) : 0;
  const deltaStr = delta === 0 ? '' : (delta > 0 ? '+' + delta : '' + delta) + unit;
  return '<div class="nte-macro">' +
    '<div class="nte-macro-top">' +
      '<span class="nte-macro-value">' + rounded + unit + '</span>' +
      '<span class="nte-macro-target">/ ' + target + unit + '</span>' +
    '</div>' +
    (deltaStr ? '<div class="nte-macro-delta">' + deltaStr + '</div>' : '') +
    '<div class="nte-macro-label">' + label + '</div>' +
    '<div class="nte-macro-bar"><div class="nte-macro-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
  '</div>';
}

function nteQtyPrevCell(val, lbl) {
  return '<div class="nte-qty-prev-cell"><div class="nte-qty-prev-val">' + val + '</div><div class="nte-qty-prev-lbl">' + lbl + '</div></div>';
}

// ---------- corpo do editor: renderização e edição (passo 1b) ----------
//
// CONTRATO DE GANCHO (AC-16). As doze funções abaixo NÃO vivem aqui: pertencem à
// página hospedeira, e o núcleo as alcança por `EditorPlanoHost`, objeto que a
// hospedeira declara e preenche.
//
//   publicação e persistência  getPlanRef · renderPubHeader · m2SalvarRascunho
//   documento do atleta        docEnvelope · docDayTotals · docMacrosBlock
//                              docMealsBlock · docNotesSection
//   utilitários da página      renderWorkout · renderNutrition · renderIcons
//                              rotuloFase
//
// É por este objeto que a ausência da publicação continua ESTRUTURAL. A gaveta do
// Coach liga as doze; a rota restrita do profissional, no passo 2, deixa de ligar
// as de publicação — e o botão que as acionaria não existe naquele arquivo
// (CA-33, CA-49). O núcleo não decide o que pode publicar: ele nem sabe publicar.

async function wkeCarregarCatalogo() {
  if (wkeCatalogoEstado === 'pronto' || wkeCatalogoEstado === 'carregando') return;
  wkeCatalogoEstado = 'carregando';
  try {
    const resp = await fetch('/dados/exercicios.json', { cache: 'no-cache' });
    if (resp.status === 404) throw new Error('ARQUIVO_AUSENTE');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const dados = await resp.json();
    // O arquivo semente versionado tem geradoEm nulo: distingue "nunca
    // gerado" de "gerado e legitimamente vazio".
    wkeCatalogoSemente = !dados.geradoEm;
    WKE_EXERCISE_DB = (dados.exercicios || []).map(function(e) {
      return {
        id: e.id,
        name: e.nome_pt,
        group: e.grupo,
        equip: e.equipamento,
        instrucao: e.instrucao_pt || '',
        musculo: e.musculoPrimario || '',
        // Em produção o gerador só emite revisados, então este campo vem
        // sempre true. Fora dela, distingue o que o Coach já validou.
        revisado: e.revisado !== false
      };
    });
    wkeCatalogoEstado = 'pronto';
  } catch (err) {
    WKE_EXERCISE_DB = [];
    wkeCatalogoEstado = 'erro';
    // A causa mais provável NÃO é conexão: é o arquivo nunca ter sido
    // gerado. Culpar a rede mandaria quem lê para o lugar errado.
    wkeCatalogoMotivo = (err && err.message === 'ARQUIVO_AUSENTE')
      ? 'O arquivo /dados/exercicios.json não existe nesta publicação — o filtro de build não chegou a rodar.'
      : 'Falha de rede ou arquivo inválido. Feche e abra a busca para tentar de novo.';
    console.error('[WKE] falha ao carregar o catálogo de exercícios:', err);
  }
}

async function wkeCarregarPlanoDemo() {
  try {
    const resp = await fetch('/dados/plano-demo.json', { cache: 'no-cache' });
    if (!resp.ok) return;
    WKE_DEMO_PLAN = await resp.json();
  } catch (err) {
    // Arquivo ausente é o caso NORMAL em produção. Nem erro nem aviso:
    // não há nada a fazer a respeito, e o estado vazio já comunica.
  }
}

function wkeCoarsePointer() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

function wkeRenderCalcContext() {
  var a = wkeState.athlete;
  var phase = (a && a.phase) ? a.phase : 'Bulking';
  var weight = (a && a.weightCurrentKg) ? a.weightCurrentKg : null;
  var chip = document.getElementById('wke-phasechip');
  var wv = document.getElementById('wke-weightval');
  if (chip) {
    var key = phase.toLowerCase();
    var cls = 'bulking';
    if (key.indexOf('cut') > -1) cls = 'cutting';
    else if (key.indexOf('diet') > -1) cls = 'dietbreak';
    else if (key.indexOf('manu') > -1) cls = 'manutencao';
    chip.className = 'nte-phasechip ' + cls;
    chip.textContent = rotuloFase(phase);
  }
  if (wv) wv.textContent = weight ? (weight + ' kg') : '—';
}

function wkeOpenPreview() {
  if (!wkeState.plan || !wkeState.plan.order.length) {
    if (typeof wkeToast === 'function') wkeToast('Nenhum treino publicado para visualizar.', { type: 'info' });
    return;
  }
  var a = wkeState.athlete;
  var plan = wkeState.plan;
  var inner = plan.order.map(function(dayKey, idx){
    var day = plan.days[dayKey];
    var num = ('0' + (idx + 1)).slice(-2);
    var exHtml;
    if (!day.exercises || !day.exercises.length) {
      exHtml = '<div class="doc-empty">Nenhum exercício neste dia.</div>';
    } else {
      exHtml = day.exercises.map(function(ex){
        var sets = (ex.sets || []).map(function(s){
          var load = (s.load !== undefined && s.load !== null && s.load !== '') ? (s.load + 'kg') : '—';
          return (s.reps || '?') + ' × ' + load;
        }).join('  ·  ');
        return '<div class="doc-ex"><div class="doc-ex-name">' + (ex.name || 'Exercício') + '</div><div class="doc-ex-sets">' + sets + '</div></div>';
      }).join('');
    }
    var sec = '<div class="doc-section">' +
      '<div class="doc-section-h"><span class="doc-section-num">' + num + '</span><span class="doc-section-title">' + wkeEsc(wkeDayName(dayKey)) + '</span></div>' +
      exHtml +
    '</div>';
    return sec + (idx < plan.order.length - 1 ? '<div class="doc-divider"></div>' : '');
  }).join('');
  inner += docNotesSection(plan.coachNotes, plan.order.length + 1);
  document.getElementById('wke-preview-body').innerHTML =
    docEnvelope('Plano de Treino', 'Plano de Treino', a && a.name, ' com base na sua fase e objetivo do ciclo', inner);
  document.getElementById('wke-preview').style.display = 'flex';
  renderIcons();
}

function wkeClosePreview() { document.getElementById('wke-preview').style.display = 'none'; }

function wkeExerciseCard(ex, exIdx) {
  const onlyOne = ex.sets.length <= 1;
  const rows = ex.sets.map(function(s, si) {
    return '<tr>' +
      '<td class="num wke-set-idx">' + (si + 1) + '</td>' +
      '<td><input class="wke-cell-input editable-hint" type="text" value="' + s.reps + '" ' +
        'onfocus="this.select()" onchange="wkeEditReps(' + exIdx + ',' + si + ',this)" /></td>' +
      '<td><input class="wke-cell-input editable-hint load" inputmode="decimal" value="' + (s.load == null ? '' : s.load) + '" placeholder="a definir" ' +
        'onfocus="this.select()" onchange="wkeEditLoad(' + exIdx + ',' + si + ',this)" /></td>' +
      '<td class="wke-cell-static">' + (ex.rest_default || 60) + 's</td>' +
      '<td class="num"><button class="wke-set-del" title="Remover série" onclick="wkeDeleteSet(' + exIdx + ',' + si + ')"' + (onlyOne ? ' disabled' : '') + '><span data-lucide="x"></span></button></td>' +
    '</tr>' +
    '<tr class="wke-err-row" id="wke-err-' + exIdx + '-' + si + '" hidden><td colspan="5" style="padding:0"><span class="wke-cell-error"></span></td></tr>';
  }).join('');
  // C-05: PR a nível de exercício (uma vez, no header)
  const maxLoad = Math.max.apply(null, ex.sets.map(function(s){ return parseFloat(s.load) || 0; }));
  const isPR = ex.last_max != null && maxLoad > ex.last_max;
  const prAnim = ex._justWonPR ? ' just-won' : '';
  if (ex._justWonPR) ex._justWonPR = false;
  const recordeTag = ex.last_max != null ? '<span class="wke-ex-tag">Recorde ' + ex.last_max + 'kg</span>' : '';
  return '<div class="wke-exercise" data-ex="' + exIdx + '" data-ex-key="' + (ex.name || ('ex-' + exIdx)).replace(/"/g, '&quot;') + '" tabindex="0">' +
    '<div class="wke-ex-header">' +
      '<span class="wke-ex-drag" title="Arraste para reordenar" data-lucide="grip-vertical" onmousedown="wkeDragAttach(' + exIdx + ',event)" ontouchstart="wkeDragAttach(' + exIdx + ',event)"></span>' +
      '<div class="wke-ex-titlewrap">' +
        '<div class="wke-ex-name">' + ex.name + (isPR ? '<span class="wke-pr-badge' + prAnim + '"><span data-lucide="trophy" style="width:9px;height:9px"></span>PR</span>' : '') + '</div>' +
        '<div class="wke-ex-tags"><span class="wke-ex-tag">' + ex.group + '</span><span class="wke-ex-tag">' + ex.equip + '</span>' + recordeTag +
          '<span class="wke-ex-rest">Descanso: <input inputmode="numeric" value="' + (ex.rest_default || 60) + '" onfocus="this.select()" onchange="wkeEditRest(' + exIdx + ',this)" />s</span>' +
        '</div>' +
        '<div class="wke-cell-error" id="wke-err-rest-' + exIdx + '" hidden></div>' +
      '</div>' +
      '<div class="wke-ex-actions">' +
        '<button class="wke-ex-actionbtn" title="Duplicar" onclick="wkeDuplicateExercise(' + exIdx + ')"><span data-lucide="copy"></span></button>' +
        '<button class="wke-ex-actionbtn danger" title="Remover" onclick="wkeDeleteExercise(' + exIdx + ')"><span data-lucide="trash-2"></span></button>' +
      '</div>' +
    '</div>' +
    '<table class="wke-sets"><thead><tr>' +
      '<th class="num">S</th><th>Reps</th><th>Carga</th><th>Descanso</th><th class="num"></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<button class="wke-add-set" onclick="wkeAddSet(' + exIdx + ')"><span data-lucide="plus"></span> Adicionar série</button>' +
    wkeRenderLoadHistory(ex) +
  '</div>';
}

function wkeRenderLoadHistory(ex) {
  // WKE-04 Bloco B: chips das 4 últimas semanas + accordion "ver histórico completo"
  // quando há mais entradas. Fallback string legada se loadHistory ausente.
  if (Array.isArray(ex.loadHistory) && ex.loadHistory.length) {
    var hist = ex.loadHistory;
    var recent = hist.slice(-4);
    var hasMore = hist.length > 4;
    var rowsId = 'wke-lh-' + (Math.random().toString(36).slice(2, 9));
    var chips = recent.map(function(h, i) {
      var isLast = i === recent.length - 1;
      return '<span class="wke-loadchip' + (isLast ? ' latest' : '') + '">' + h.semana + ': ' + h.maxLoad + 'kg × ' + h.reps + '</span>';
    }).join('');
    var more = hasMore
      ? '<button type="button" class="wke-loadhist-more" onclick="wkeToggleLoadHistFull(\'' + rowsId + '\', this)" aria-expanded="false">Ver histórico completo (+' + (hist.length - 4) + ')</button>'
      : '';
    var fullTable = '';
    if (hasMore) {
      var lastIdx = hist.length - 1;
      var rows = hist.map(function(h, i){
        var cls = i === lastIdx ? ' class="latest"' : '';
        var dateStr = h.date ? new Date(h.date).toLocaleDateString('pt-BR') : '—';
        return '<tr' + cls + '><td>' + h.semana + '</td><td class="num">' + h.maxLoad + ' kg</td><td class="num">' + h.reps + '</td><td>' + dateStr + '</td></tr>';
      }).join('');
      fullTable = '<div class="wke-loadhist-full" id="' + rowsId + '" hidden>' +
        '<table><thead><tr><th>Semana</th><th>Carga máxima</th><th>Reps</th><th>Data</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
    }
    return '<div class="wke-ex-loadhist">' + chips + more + '</div>' + fullTable;
  }
  if (ex.last) {
    return '<div class="wke-ex-history"><span data-lucide="history"></span><span class="wke-ex-history-text">Última vez: <b>' + ex.last + '</b></span></div>';
  }
  return '';
}

function wkeToggleLoadHistFull(id, btn) {
  var el = document.getElementById(id);
  if (!el) return;
  var open = el.hasAttribute('hidden');
  if (open) { el.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); btn.textContent = 'Ocultar histórico completo'; }
  else      { el.setAttribute('hidden', '');  btn.setAttribute('aria-expanded', 'false'); btn.textContent = btn.dataset.openLabel || ('Ver histórico completo (+' + (el.querySelectorAll('tbody tr').length - 4) + ')'); }
}

function wkeShowError(exIdx, si, msg) {
  const row = document.getElementById('wke-err-' + exIdx + '-' + si);
  if (row) { row.hidden = false; row.querySelector('.wke-cell-error').textContent = msg; }
}

function wkeClearError(exIdx, si) {
  const row = document.getElementById('wke-err-' + exIdx + '-' + si);
  if (row) { row.hidden = true; }
}

function wkeShowRestError(exIdx, msg) {
  const el = document.getElementById('wke-err-rest-' + exIdx);
  if (el) { el.hidden = false; el.textContent = msg; }
}

function wkeClearRestError(exIdx) {
  const el = document.getElementById('wke-err-rest-' + exIdx);
  if (el) { el.hidden = true; }
}

function wkeEditReps(exIdx, si, input) {
  const val = input.value.trim();
  const valid = /^\d+(\s*-\s*\d+)?$/.test(val) || /falha/i.test(val);
  if (!valid) {
    input.classList.add('invalid');
    wkeShowError(exIdx, si, 'Formato inválido. Use 8-12 ou "falha".');
    wkeToast('Formato inválido. Use 8-12 ou "falha".', {type:'error'});
    return;
  }
  input.classList.remove('invalid');
  wkeClearError(exIdx, si);
  wkeCurrentDay().exercises[exIdx].sets[si].reps = val;
  wkeRefreshStats();
  wkeAutoSave();
}

function wkeEditLoad(exIdx, si, input) {
  const num = parseFloat(input.value.replace(',', '.'));
  if (isNaN(num) || num <= 0 || num >= 1000) {
    input.classList.add('invalid');
    wkeShowError(exIdx, si, 'Carga deve estar entre 0,5kg e 1.000kg.');
    wkeToast('Carga deve estar entre 0,5kg e 1.000kg.', {type:'error'});
    return;
  }
  input.classList.remove('invalid');
  wkeClearError(exIdx, si);
  const ex = wkeCurrentDay().exercises[exIdx];
  // PR antes da edição (p/ detectar transição)
  const prevMax = Math.max.apply(null, ex.sets.map(function(s){ return parseFloat(s.load) || 0; }));
  const prevPR = ex.last_max != null && prevMax > ex.last_max;
  ex.sets[si].load = num;
  // C-05: PR a nível de exercício — last_max é o recorde histórico (baseline fixo, NÃO sobrescrever)
  const maxLoad = Math.max.apply(null, ex.sets.map(function(s){ return parseFloat(s.load) || 0; }));
  const isPR = ex.last_max != null && maxLoad > ex.last_max;
  if (isPR && !prevPR) {
    ex._justWonPR = true;
    wkeToast('Novo recorde! ' + maxLoad + 'kg em ' + ex.name, true);
  } else {
    wkeToast('Carga atualizada');
  }
  wkeRefreshStats();
  wkeRerenderCard(exIdx);
  wkeAutoSave();
}

function wkeAddSet(exIdx) {
  const ex = wkeCurrentDay().exercises[exIdx];
  const last = ex.sets[ex.sets.length - 1] || { reps: '8-12', load: null, rest: ex.rest_default || 60, obs: '' };
  ex.sets.push({ reps: last.reps, load: last.load, rest: ex.rest_default || 60, obs: '' });
  wkeRefreshStats();
  wkeRerenderCard(exIdx);
  wkeAutoSave();
}

function wkeDeleteSet(exIdx, si) {
  const ex = wkeCurrentDay().exercises[exIdx];
  if (ex.sets.length <= 1) return; // mínimo 1 série
  ex.sets.splice(si, 1);
  wkeRefreshStats();
  wkeRerenderCard(exIdx);
  wkeAutoSave();
}

function wkeEditRest(exIdx, input) {
  const num = parseInt(input.value, 10);
  if (isNaN(num) || num < 0 || num > 900) {
    input.classList.add('invalid');
    wkeShowRestError(exIdx, 'Descanso deve estar entre 0 e 900s.');
    wkeToast('Descanso deve estar entre 0 e 900s', {type:'error'});
    return;
  }
  input.classList.remove('invalid');
  wkeClearRestError(exIdx);
  const ex = wkeCurrentDay().exercises[exIdx];
  ex.rest_default = num;
  wkeRefreshStats();   // recalcula Duração
  wkeRerenderCard(exIdx); // propaga p/ todas as linhas da coluna Descanso
  wkeAutoSave();
}

function wkeRerenderCard(exIdx) {
  const card = document.querySelector('.wke-exercise[data-ex="' + exIdx + '"]');
  if (!card) { renderWorkout(); return; }
  const tmp = document.createElement('div');
  tmp.innerHTML = wkeExerciseCard(wkeCurrentDay().exercises[exIdx], exIdx);
  card.replaceWith(tmp.firstElementChild);
  renderIcons();
}

function wkeRefreshStats() {
  const day = wkeCurrentDay();
  const stats = wkeComputeStats(day);
  const vol = wkeFmtVolume(stats.volume);
  const volSub = stats.pendingCount > 0
    ? ((stats.exCount - stats.pendingCount) + ' de ' + stats.exCount + ' com carga')
    : '';
  const statsEl = document.getElementById('wke-stats');
  if (statsEl) {
    statsEl.innerHTML =
      wkeStatCard(stats.exCount, '', 'Exercícios') +
      wkeStatCard(stats.groups, '', 'Grupos') +
      wkeStatCard(vol.val, vol.unit, stats.pendingCount > 0 ? 'Volume parcial' : 'Volume', volSub) +
      wkeStatCard(stats.durMin, 'min', 'Duração');
  }
}

function wkeCloseDayMenu() {
  const open = document.querySelector('.wke-daymenu');
  if (open) open.remove();
  const btn = document.querySelector('.wke-daytab-menubtn[aria-expanded="true"]');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  wkeDayMenuFor = null;
}

function wkeToggleDayMenu(d, btn) {
  if (wkeDayMenuFor === d) { wkeCloseDayMenu(); return; }
  wkeCloseDayMenu();
  const canDelete = wkeState.plan && wkeState.plan.order.length > 1;
  const menu = document.createElement('div');
  menu.className = 'wke-daymenu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML =
    '<button class="wke-daymenu-item" role="menuitem" data-menu-action="rename"><span data-lucide="pencil"></span> Renomear dia</button>' +
    (canDelete
      ? '<button class="wke-daymenu-item danger" role="menuitem" data-menu-action="delete"><span data-lucide="trash-2"></span> Remover dia</button>'
      : '');
  // Anexado ao <body>, não ao wrap — ver o comentário de .wke-daymenu no
  // CSS. Medido escondido antes de posicionar: alinhar pela direita do
  // botão (como antes) presumia espaço à esquerda que uma aba perto da
  // borda no celular não tem — "Dia A" é sempre a primeira, e no celular
  // isso já bastava para o menu invadir a borda esquerda da tela. Por
  // isso o left final é GRUDADO ao viewport (nunca ao botão): calcula
  // onde ficaria alinhado à direita e recua se isso passar da borda.
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  const menuW = menu.offsetWidth;
  const MARGIN = 8;
  let left = r.right - menuW;
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - menuW - MARGIN));
  menu.style.top = (r.bottom + 6) + 'px';
  menu.style.left = left + 'px';
  menu.style.visibility = '';
  btn.setAttribute('aria-expanded', 'true');
  wkeDayMenuFor = d;
  renderIcons();
  if (!document.body.dataset.wkeDayMenuBound) {
    // Trata os itens do menu AQUI, não em wkeOnDayTabsClick: aquele
    // listener está preso a #wke-daytabs (delegação), e o menu agora vive
    // no <body> — fora da subárvore, o clique nunca chegaria lá.
    document.addEventListener('click', function(ev) {
      if (!wkeDayMenuFor) return;
      const menuItem = ev.target.closest('[data-menu-action]');
      if (menuItem && menuItem.closest('.wke-daymenu')) {
        const d0 = wkeDayMenuFor;
        const action = menuItem.dataset.menuAction;
        wkeCloseDayMenu();
        if (action === 'delete') { wkeDeleteDay(d0); return; }
        const tabBtn = document.querySelector('.wke-daytab[data-day="' + CSS.escape(d0) + '"]');
        if (tabBtn) wkeStartRenameDay(d0, tabBtn);
        return;
      }
      if (ev.target.closest('.wke-daymenu') || ev.target.closest('.wke-daytab-menubtn')) return;
      wkeCloseDayMenu();
    });
    document.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape') wkeCloseDayMenu();
    });
    // position:fixed é relativo à viewport, não ao contêiner com rolagem
    // — rolar a gaveta desalinharia o menu do botão que o abriu. 'scroll'
    // não borbulha em elementos comuns, por isso a fase de captura.
    document.addEventListener('scroll', function() { if (wkeDayMenuFor) wkeCloseDayMenu(); }, true);
    document.body.dataset.wkeDayMenuBound = '1';
  }
}

function wkeOnDayTabsClick(e) {
  // Cliques nos itens do menu (Renomear/Remover) são tratados no listener
  // global de document dentro de wkeToggleDayMenu — o menu vive no
  // <body>, fora desta subárvore, então nunca chegariam aqui.
  const menuBtn = e.target.closest('[data-day-menu]');
  if (menuBtn) { wkeToggleDayMenu(menuBtn.dataset.dayMenu, menuBtn); return; }
  wkeCloseDayMenu();
  const addBtn = e.target.closest('[data-day-add]');
  if (addBtn) { wkeAddDay(); return; }
  const tab = e.target.closest('.wke-daytab[data-day]');
  if (!tab) return;
  const d = tab.dataset.day;
  if (d !== wkeState.activeDay) { wkeSelectDay(d); return; }
  if (wkeCoarsePointer()) wkeStartRenameDay(d, tab);
}

function wkeOnDayTabsDblClick(e) {
  if (wkeCoarsePointer()) return; // no toque, quem renomeia é o 2º toque
  const tab = e.target.closest('.wke-daytab[data-day]');
  if (!tab) return;
  wkeStartRenameDay(tab.dataset.day, tab);
}

function wkeSelectDay(d) {
  if (d === wkeState.activeDay) return; // evita re-render inútil da aba inteira
  wkeState.activeDay = d;
  renderWorkout();
}

function wkeSetCoachNotes(v) {
  if (!wkeState.plan) return;
  wkeState.plan.coachNotes = v;
  wkeAutoSave();
}

function wkeSyncCoachNotes() {
  const el = document.getElementById('wke-coach-notes');
  if (!el) return;
  // Não sobrescrever enquanto o Coach digita: renderWorkout é chamado por
  // muitos caminhos, e wkeAutoSave marca alteração pendente a cada tecla.
  if (document.activeElement === el) return;
  el.value = (wkeState.plan && wkeState.plan.coachNotes) || '';
}

function wkeStartRenameDay(d, btn) {
  const cur = wkeDayName(d);
  const wrap = btn.closest('.wke-daytab-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<input class="wke-daytab-rename" maxlength="20" value="' + cur.replace(/"/g, '&quot;') + '" ' +
    'onblur="wkeCommitRenameDay(\'' + d + '\',this)" ' +
    'onkeydown="if(event.key===\'Enter\'){this.blur();} if(event.key===\'Escape\'){this.dataset.cancel=\'1\';this.blur();}" />';
  const inp = wrap.querySelector('input');
  inp.focus(); inp.select();
}

function wkeCommitRenameDay(d, inp) {
  if (inp.dataset.cancel) { renderWorkout(); return; }
  const name = inp.value.trim();
  if (!name) { renderWorkout(); return; } // validação: não vazio
  wkeState.plan.days[d].label = name.slice(0, 20); // máx 20 caracteres
  renderWorkout();
  wkeToast('Dia renomeado');
  wkeAutoSave();
}

function wkeDeleteDay(d) {
  if (wkeState.plan.order.length <= 1) return;
  wkeConfirm('Remover ' + wkeDayName(d) + '? Todos os exercícios serão excluídos permanentemente.', function() {
    const plan = wkeState.plan;
    const idx = plan.order.indexOf(d);
    plan.order.splice(idx, 1);
    delete plan.days[d];
    if (wkeState.activeDay === d) wkeState.activeDay = plan.order[Math.max(0, idx - 1)];
    renderWorkout();
    wkeToast('Dia removido');
    wkeAutoSave();
  });
}

function wkeCaptureFlip() {
  var map = new Map();
  document.querySelectorAll('.wke-exercise[data-ex-key]').forEach(function(el) {
    var r = el.getBoundingClientRect();
    map.set(el.getAttribute('data-ex-key'), { top: r.top, left: r.left });
  });
  return map;
}

function wkePlayFlip(before) {
  if (!before || !before.size) return;
  // Coleta cards novos e calcula delta
  var moved = [];
  document.querySelectorAll('.wke-exercise[data-ex-key]').forEach(function(el) {
    var key = el.getAttribute('data-ex-key');
    var prev = before.get(key);
    if (!prev) return; // card novo (não estava antes)
    var r = el.getBoundingClientRect();
    var dx = prev.left - r.left;
    var dy = prev.top  - r.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return; // não se moveu
    // Invert: posiciona visualmente onde estava
    el.style.transform = 'translate3d(' + dx + 'px, ' + dy + 'px, 0)';
    moved.push(el);
  });
  if (!moved.length) return;
  // Force reflow para o transform "antigo" pegar antes da transição entrar
  moved[0].offsetWidth;
  // Play: libera transição e zera o transform → desliza para o lugar
  requestAnimationFrame(function() {
    moved.forEach(function(el) {
      el.classList.add('wke-flip-playing');
      el.style.transform = '';
    });
    // Cleanup: remove classe e style após a transição terminar
    setTimeout(function() {
      moved.forEach(function(el) {
        el.classList.remove('wke-flip-playing');
        el.style.transform = '';
      });
    }, 200); // 150ms da transição + 50ms folga
  });
}

function wkeDragAttach(exIdx, e) {
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  var clientY = (e.touches ? e.touches[0] : e).clientY;
  var clientX = (e.touches ? e.touches[0] : e).clientX;
  var card = e.currentTarget.closest('.wke-exercise');
  if (!card) return;
  // Ghost
  var ghost = document.createElement('div');
  ghost.className = 'wke-drag-ghost';
  ghost.innerHTML = '<span class="wke-drag-ghost-icon">≡</span><span>' + wkeCurrentDay().exercises[exIdx].name + '</span>';
  ghost.style.cssText = 'left:' + (clientX + 16) + 'px;top:' + (clientY - 16) + 'px';
  document.body.appendChild(ghost);
  // Placeholder
  var placeholder = document.createElement('div');
  placeholder.className = 'wke-drag-placeholder';
  // Mark card
  card.classList.add('wke-drag-active', 'dragging');
  document.body.classList.add('wke-dragging');
  wkeDragState = { exIdx: exIdx, card: card, ghost: ghost, placeholder: placeholder, insertBeforeIdx: null };
  var isTouch = e.type === 'touchstart';
  if (isTouch) {
    document.addEventListener('touchmove', wkeDragOnMove, { passive: false });
    document.addEventListener('touchend', wkeDragOnEnd);
    document.addEventListener('touchcancel', wkeDragOnEnd);
  } else {
    document.addEventListener('mousemove', wkeDragOnMove);
    document.addEventListener('mouseup', wkeDragOnEnd);
  }
}

function wkeDragOnMove(e) {
  if (!wkeDragState) return;
  if (e.cancelable) e.preventDefault();
  var clientY = (e.touches ? e.touches[0] : e).clientY;
  var clientX = (e.touches ? e.touches[0] : e).clientX;
  // Move ghost
  wkeDragState.ghost.style.left = (clientX + 16) + 'px';
  wkeDragState.ghost.style.top = (clientY - 16) + 'px';
  // Find insertion point (first non-dragged card whose midpoint is below cursor)
  var container = document.getElementById('wke-exercises');
  if (!container) return;
  var allCards = Array.from(container.querySelectorAll('.wke-exercise:not(.wke-drag-active)'));
  var insertBeforeEl = null;
  var insertBeforeIdx = null;
  for (var i = 0; i < allCards.length; i++) {
    var c = allCards[i];
    var rect = c.getBoundingClientRect();
    if (clientY < rect.top + rect.height * 0.5) {
      insertBeforeEl = c;
      insertBeforeIdx = parseInt(c.getAttribute('data-ex'));
      break;
    }
  }
  wkeDragState.insertBeforeIdx = insertBeforeIdx;
  // Reposition placeholder
  if (wkeDragState.placeholder.parentNode) {
    wkeDragState.placeholder.parentNode.removeChild(wkeDragState.placeholder);
  }
  if (insertBeforeEl) {
    container.insertBefore(wkeDragState.placeholder, insertBeforeEl);
  } else {
    container.appendChild(wkeDragState.placeholder);
  }
}

function wkeDragOnEnd(e) {
  if (!wkeDragState) return;
  var state = wkeDragState;
  wkeDragState = null;
  // Cleanup
  state.ghost.remove();
  if (state.placeholder.parentNode) state.placeholder.parentNode.removeChild(state.placeholder);
  state.card.classList.remove('wke-drag-active', 'dragging');
  document.body.classList.remove('wke-dragging');
  document.removeEventListener('mousemove', wkeDragOnMove);
  document.removeEventListener('mouseup', wkeDragOnEnd);
  document.removeEventListener('touchmove', wkeDragOnMove);
  document.removeEventListener('touchend', wkeDragOnEnd);
  document.removeEventListener('touchcancel', wkeDragOnEnd);
  var exIdx = state.exIdx;
  var insertBeforeIdx = state.insertBeforeIdx;
  // No-op if dropped in same position
  var noMove = (insertBeforeIdx === exIdx) ||
               (insertBeforeIdx === exIdx + 1) ||
               (insertBeforeIdx === null && exIdx === wkeCurrentDay().exercises.length - 1);
  if (noMove) return;
  // Reorder
  var arr = wkeCurrentDay().exercises;
  var moved = arr.splice(exIdx, 1)[0];
  var insertAt;
  if (insertBeforeIdx === null) {
    insertAt = arr.length; // append at end
  } else {
    insertAt = insertBeforeIdx > exIdx ? insertBeforeIdx - 1 : insertBeforeIdx;
  }
  arr.splice(insertAt, 0, moved);
  // P-05: FLIP — captura ANTES do render, anima depois
  var flipBefore = wkeCaptureFlip();
  renderWorkout();
  wkePlayFlip(flipBefore);
  wkeToast('Ordem atualizada');
  wkeAutoSave();
}

function wkeConfirm(message, onYes) {
  let ov = document.getElementById('wke-confirm-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'wke-confirm-overlay';
    ov.className = 'wke-confirm-overlay';
    ov.hidden = true;
    ov.innerHTML = '<div class="wke-confirm-box">' +
      '<div class="wke-confirm-title">Confirmar remoção</div>' +
      '<div class="wke-confirm-msg"></div>' +
      '<div class="wke-confirm-actions">' +
        '<button class="wke-confirm-cancel">Cancelar</button>' +
        '<button class="wke-confirm-ok">Remover</button>' +
      '</div></div>';
    document.body.appendChild(ov);
  }
  ov.querySelector('.wke-confirm-msg').textContent = message;
  const close = function() { ov.hidden = true; };
  ov.querySelector('.wke-confirm-cancel').onclick = close;
  ov.onclick = function(e) { if (e.target === ov) close(); };
  ov.querySelector('.wke-confirm-ok').onclick = function() { close(); onYes(); };
  ov.hidden = false;
}

function wkeCreateFirstDay() {
  const plan = wkeState.plan;
  plan.order.push('A');
  plan.days['A'] = { label: 'Dia A — Novo treino', exercises: [] };
  plan.isNew = false;
  wkeState.activeDay = 'A';
  renderWorkout();
  wkeToast('Primeiro dia criado');
  wkeAutoSave();
}

function wkeAddDay() {
  const plan = wkeState.plan;
  const next = String.fromCharCode(65 + plan.order.length); // D, E…
  plan.order.push(next);
  plan.days[next] = { label: 'Dia ' + next + ' — Novo treino', exercises: [] };
  wkeState.activeDay = next;
  renderWorkout();
  wkeAutoSave();
}

function wkeDuplicateExercise(exIdx) {
  const day = wkeCurrentDay();
  const copy = JSON.parse(JSON.stringify(day.exercises[exIdx]));
  day.exercises.splice(exIdx + 1, 0, copy);
  renderWorkout();
  wkeToast('Exercício duplicado');
  wkeAutoSave();
}

function wkeDeleteExercise(exIdx) {
  const day = wkeCurrentDay();
  const ex = day.exercises[exIdx];
  // wkeConfirm em vez de confirm() nativo: confirm() é bloqueado silenciosamente
  // por iframes sandbox (sem allow-modals), o que tornava a exclusão inerte.
  wkeConfirm('Remover "' + ex.name + '" deste dia?', function() {
    day.exercises.splice(exIdx, 1);
    renderWorkout();
    wkeToast('Exercício removido');
    wkeAutoSave();
  });
}

function openExerciseSearch() {
  const ov = document.getElementById('wke-search-overlay');
  const inp = document.getElementById('wke-search-input');
  const res = document.getElementById('wke-search-results');
  ov.hidden = false;
  inp.value = '';
  wkeSearchSelIdx = -1;
  res.innerHTML = '<div class="wke-search-hint">Digite ao menos 3 letras para buscar.</div>';
  setTimeout(function() { inp.focus(); }, 30);
  wkeCarregarCatalogo();
}

function closeExerciseSearch() {
  document.getElementById('wke-search-overlay').hidden = true;
}

function onExerciseSearchInput() {
  clearTimeout(wkeSearchTimer);
  wkeSearchTimer = setTimeout(wkeRunExerciseSearch, 200); // debounce 200ms
}

function wkeRunExerciseSearch() {
  const q = dobraBusca(document.getElementById('wke-search-input').value.trim());
  const res = document.getElementById('wke-search-results');
  wkeSearchSelIdx = -1;
  if (q.length < 3) {
    wkeSearchResults = [];
    res.innerHTML = '<div class="wke-search-hint">Digite ao menos 3 letras para buscar.</div>';
    return;
  }
  if (wkeCatalogoEstado === 'carregando') {
    res.innerHTML = '<div class="wke-search-hint">Carregando o catálogo…</div>';
    return;
  }
  if (wkeCatalogoEstado === 'erro') {
    res.innerHTML = '<div class="wke-search-hint">Não foi possível carregar o catálogo de exercícios.<br>' + (wkeCatalogoMotivo || 'Motivo não identificado.') + '</div>';
    return;
  }
  if (!WKE_EXERCISE_DB.length) {
    res.innerHTML = wkeCatalogoSemente
      ? '<div class="wke-search-hint">O catálogo de exercícios ainda não foi gerado a partir do banco. Rode <code>npm run catalogo:exercicios</code>, faça commit do arquivo-fonte e publique o site.</div>'
      : '<div class="wke-search-hint">Nenhum exercício revisado pelo Coach chegou a esta publicação.</div>';
    return;
  }
  wkeSearchResults = WKE_EXERCISE_DB.filter(function(e) {
    return dobraBusca(e.name).includes(q) || dobraBusca(e.group).includes(q);
  }).slice(0, 10); // top 10
  if (!wkeSearchResults.length) {
    res.innerHTML = '<div class="wke-search-hint">Nenhum exercício encontrado para "' + q + '".</div>';
    return;
  }
  // A frase inteira sobre pendência é dita UMA vez, aqui, em vez de repetida
  // em cada linha: eram 29 caracteres em caixa alta por resultado, e era o
  // que estourava a largura da caixa e forçava rolagem horizontal.
  const pendentes = wkeSearchResults.filter(function(e) { return !e.revisado; }).length;
  const legenda = pendentes
    ? '<div class="wke-search-legenda">A tarja laranja marca exercício ainda não validado pelo Coach. Não aparece em produção.</div>'
    : '';
  res.innerHTML = legenda + wkeSearchResults.map(function(e, i) {
    return '<div class="wke-search-result' + (e.revisado ? '' : ' wke-search-result--pendente') + '" data-i="' + i + '" onclick="wkePickExercise(' + i + ')"' +
      ' title="' + e.equip + (e.revisado ? '' : ' · Nome e instrução ainda não validados pelo Coach. Não aparece em produção.') + '">' +
      '<span class="wke-search-result-name">' + e.name + '</span>' +
      '<span class="wke-search-result-tags"><span class="wke-ex-tag">' + e.group + '</span>' +
      (e.revisado ? '' : '<span class="wke-ex-tag wke-ex-tag--pending">pendente</span>') +
      '</span>' +
    '</div>';
  }).join('');
  renderIcons();
}

function onExerciseSearchKey(e) {
  if (e.key === 'Escape') { closeExerciseSearch(); return; }
  if (!wkeSearchResults.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); wkeSearchSelIdx = Math.min(wkeSearchSelIdx + 1, wkeSearchResults.length - 1); wkeHighlightSearch(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); wkeSearchSelIdx = Math.max(wkeSearchSelIdx - 1, 0); wkeHighlightSearch(); }
  else if (e.key === 'Enter') { e.preventDefault(); wkePickExercise(wkeSearchSelIdx >= 0 ? wkeSearchSelIdx : 0); }
}

function wkeHighlightSearch() {
  document.querySelectorAll('.wke-search-result').forEach(function(el, i) {
    el.classList.toggle('active', i === wkeSearchSelIdx);
  });
}

function wkePickExercise(i) {
  const pick = wkeSearchResults[i];
  if (!pick) return;
  const day = wkeCurrentDay();
  day.exercises.push({
    // exerciseId é o vínculo estável com a coleção exercises/ (especificação,
    // seção 7). name/group/equip ficam como cópia de exibição enquanto o
    // plano-base de demonstração ainda for dado de simulação; quando o mock
    // for refeito, a resolução passa a ser feita pelo identificador.
    exerciseId: pick.id,
    name: pick.name, group: pick.group, equip: pick.equip, pr: 0, last: '', rest_default: 60, last_max: null,
    sets: [ { reps: '8-12', load: null, rest: 60, obs: '' }, { reps: '8-12', load: null, rest: 60, obs: '' }, { reps: '8-12', load: null, rest: 60, obs: '' } ]
  });
  closeExerciseSearch();
  renderWorkout();
  wkeToast(pick.name + ' adicionado');
  wkeAutoSave();
}

function wkeToast(msg, opts) {
  // compatibilidade retroativa: opts === true → PR
  const o = (opts === true) ? { pr: true } : (opts || {});
  const type = o.pr ? 'pr' : (o.type || 'success');
  if (!wkeToastWrap) {
    wkeToastWrap = document.createElement('div');
    wkeToastWrap.className = 'wke-toast-wrap';
    document.body.appendChild(wkeToastWrap);
  }
  const icons = { success: 'check', pr: 'trophy', warning: 'alert-triangle', error: 'x-circle', info: 'info' };
  const t = document.createElement('div');
  t.className = 'wke-toast wke-toast-' + type;
  t.innerHTML = '<span data-lucide="' + (icons[type] || 'check') + '"></span><span>' + msg + '</span>';
  wkeToastWrap.appendChild(t);
  renderIcons();
  const dur = (type === 'pr' || type === 'error' || type === 'warning') ? 2600 : 1600;
  setTimeout(function() { t.style.transition = 'opacity 200ms ease'; t.style.opacity = '0'; setTimeout(function() { t.remove(); }, 220); }, dur);
}

function wkeAutoSave() {
  clearTimeout(wkeSaveTimer);
  // O represamento de 500 ms já existia e é preservado: o autossalvo é
  // chamado a cada tecla, e uma gravação por tecla seria uma gravação de
  // documento inteiro por tecla.
  wkeSaveTimer = setTimeout(function() { EditorPlanoHost.m2SalvarRascunho('training', wkeState.plan); }, 500);
  var _trp = EditorPlanoHost.getPlanRef('training');
  if (_trp && _trp.status === 'publicado' && !_trp.hasUnpublishedChanges) { _trp.hasUnpublishedChanges = true; EditorPlanoHost.renderPubHeader('training'); }
}

async function nteCarregarCatalogo() {
  if (nteCatalogoEstado === 'pronto' || nteCatalogoEstado === 'carregando') return;
  nteCatalogoEstado = 'carregando';
  try {
    const resp = await fetch('/dados/alimentos.json', { cache: 'no-cache' });
    if (resp.status === 404) throw new Error('ARQUIVO_AUSENTE');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const dados = await resp.json();
    // O arquivo emitido sem arquivo-fonte tem geradoEm nulo: distingue
    // "nunca gerado" de "gerado e legitimamente vazio".
    nteCatalogoSemente = !dados.geradoEm;
    NTE_FOOD_DB = (dados.alimentos || []).map(function(a) {
      const mac = a.macros || {};
      return {
        id: a.id,
        name: a.nomeExibicao,
        // Forma já normalizada para busca (D-03): grava sem pontuação,
        // gerada pelo servidor quando o item é criado ou renomeado. Itens
        // antigos sem este campo caem no fallback dobraBusca(f.name) em
        // nteRunFoodSearch, que já trata pontuação também.
        busca: a.nomeBusca || null,
        kcal: Number(mac.kcal) || 0,
        p: Number(mac.proteinaG) || 0,
        c: Number(mac.carboidratoG) || 0,
        g: Number(mac.lipideosG) || 0,
        // Nula em toda a TACO: a fonte não fornece medida caseira, e
        // preenchê-la é curadoria do Coach. Viaja para virar retrato na
        // publicação do plano.
        medidaCaseira: a.medidaCaseira || null,
        categoria: a.categoria || null,
        // Em produção o gerador só emite revisados, então vem sempre true.
        revisado: a.revisado !== false
      };
    });
    nteCatalogoEstado = 'pronto';
  } catch (err) {
    NTE_FOOD_DB = [];
    nteCatalogoEstado = 'erro';
    // A causa mais provável NÃO é conexão: é o arquivo nunca ter sido
    // gerado. Culpar a rede mandaria quem lê para o lugar errado.
    nteCatalogoMotivo = (err && err.message === 'ARQUIVO_AUSENTE')
      ? 'O arquivo /dados/alimentos.json não existe nesta publicação — o filtro de build não chegou a rodar.'
      : 'Falha de rede ou arquivo inválido. Feche e abra a busca para tentar de novo.';
    console.error('[NTE] falha ao carregar a base de alimentos:', err);
  }
}

function nteSetCoachNotes(v) {
  if (!nteState.plan) return;
  nteState.plan.coachNotes = v;
  nteAutoSave();
}

function nteSyncCoachNotes() {
  const el = document.getElementById('nte-coach-notes');
  if (!el) return;
  if (document.activeElement === el) return; // não sobrescrever enquanto digita
  el.value = (nteState.plan && nteState.plan.coachNotes) || '';
}

function nteRenderCalcContext() {
  var ctx = document.getElementById('nte-calcctx');
  if (!ctx) return;
  var a = nteState.athlete;
  var phase = (a && a.phase) ? a.phase : 'Bulking';
  var weight = (a && a.weightCurrentKg) ? a.weightCurrentKg : null;
  var chip = document.getElementById('nte-phasechip');
  var wv = document.getElementById('nte-weightval');
  if (chip) {
    var key = phase.toLowerCase();
    var cls = 'bulking';
    if (key.indexOf('cut') > -1) cls = 'cutting';
    else if (key.indexOf('diet') > -1) cls = 'dietbreak';
    else if (key.indexOf('manu') > -1) cls = 'manutencao';
    chip.className = 'nte-phasechip ' + cls;
    chip.textContent = rotuloFase(phase);
  }
  if (wv) wv.textContent = weight ? (weight + ' kg') : '—';
  ctx.style.display = 'flex';
}

function nteOpenPreview() {
  if (!nteState.plan || nteState.plan.isNew) {
    if (typeof wkeToast === 'function') wkeToast('Nenhum plano publicado para visualizar.', { type: 'info' });
    return;
  }
  var a = nteState.athlete;
  var days = nteState.plan.days || {};
  var dayDefs = [
    { num: '01', title: 'Dia de Treino', meals: (days.treino && days.treino.meals) || [] },
    { num: '02', title: 'Dia de Descanso', meals: (days.descanso && days.descanso.meals) || [] }
  ];
  var inner = dayDefs.map(function(d, i){
    var t = docDayTotals(d.meals);
    var sec = '<div class="doc-section">' +
      '<div class="doc-section-h"><span class="doc-section-num">' + d.num + '</span><span class="doc-section-title">' + d.title + '</span></div>' +
      docMacrosBlock(t) +
      docMealsBlock(d.meals) +
    '</div>';
    return sec + (i < dayDefs.length - 1 ? '<div class="doc-divider"></div>' : '');
  }).join('');
  inner += docNotesSection(nteState.plan.coachNotes, dayDefs.length + 1);
  document.getElementById('nte-preview-body').innerHTML =
    docEnvelope('Plano Nutricional', 'Plano Nutricional', a && a.name, ' com base na sua fase e composição corporal', inner);
  document.getElementById('nte-preview').style.display = 'flex';
  renderIcons();
}

function nteClosePreview() { document.getElementById('nte-preview').style.display = 'none'; }

function nteCreateFirstPlan() {
  const full = nteBuildBasePlan(nteState.athlete); // metas calculadas pelo peso/fase
  nteState.plan.target = full.target;
  nteState.plan.dayType = 'treino';
  nteState.plan.days = { treino: { meals: [ { name: 'Café da manhã', foods: [] } ] }, descanso: { meals: [] } };
  nteState.plan.isNew = false;
  renderNutrition();
  wkeToast('Plano nutricional criado');
  nteAutoSave();
}

function nteRenderDaySelector() {
  const el = document.getElementById('nte-dayselector');
  if (!el) return;
  const dt = nteState.plan.dayType;
  el.innerHTML =
    '<button class="nte-dayseg' + (dt === 'treino' ? ' active' : '') + '" onclick="nteSelectDayType(\'treino\')">Dia de Treino</button>' +
    '<button class="nte-dayseg' + (dt === 'descanso' ? ' active' : '') + '" onclick="nteSelectDayType(\'descanso\')">Dia de Descanso</button>';
}

function nteRenderMacros() {
  const el = document.getElementById('nte-macros');
  if (!el) return;
  const t = nteDayTotals();
  const tg = nteState.plan.target;
  el.innerHTML =
    nteMacroCard('Proteína', t.p, tg.p, 'g') +
    nteMacroCard('Carboidrato', t.c, tg.c, 'g') +
    nteMacroCard('Gordura', t.g, tg.g, 'g') +
    nteMacroCard('Calorias', t.kcal, tg.kcal, '');
}

function nteRenderMeals() {
  const el = document.getElementById('nte-meals');
  if (!el) return;
  const meals = nteCurrentDay().meals;
  if (!meals.length) {
    el.innerHTML = '<div class="wke-empty"><div class="wke-empty-icon"><span data-lucide="utensils"></span></div>' +
      '<div class="wke-empty-title">Nenhuma refeição neste dia</div>' +
      '<div class="wke-empty-sub">Adicione a primeira refeição para começar a montar o plano.</div></div>';
    return;
  }
  el.innerHTML = meals.map(function(m, i) { return nteMealCard(m, i); }).join('');
}

function nteMealCard(meal, mealIdx) {
  const rows = meal.foods.map(function(f, fi) {
    const mac = nteMacrosOf(f);
    return '<tr>' +
      '<td>' +
        '<div class="nte-food-name">' + f.name + '</div>' +
        '<div class="nte-food-macros">P ' + mac.p.toFixed(1) + ' · C ' + mac.c.toFixed(1) + ' · G ' + mac.g.toFixed(1) + '</div>' +
      '</td>' +
      '<td class="num"><span class="nte-qty-wrap"><input class="nte-qty-input" inputmode="decimal" value="' + f.qty + '" data-prev="' + f.qty + '" ' +
        'onfocus="this.select()" onchange="nteEditQty(' + mealIdx + ',' + fi + ',this)" /><span class="nte-qty-unit">g</span></span></td>' +
      '<td class="num nte-food-kcal">' + Math.round(mac.kcal) + '</td>' +
      '<td class="num"><button class="nte-food-del" title="Remover" onclick="nteDeleteFood(' + mealIdx + ',' + fi + ')"><span data-lucide="x"></span></button></td>' +
    '</tr>';
  }).join('');
  return '<div class="nte-meal" data-meal="' + mealIdx + '">' +
    '<div class="nte-meal-header">' +
      '<span class="nte-meal-name" contenteditable="true" spellcheck="false" onblur="nteRenameMeal(' + mealIdx + ',this)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}">' + meal.name + '</span>' +
      '<span class="nte-meal-kcal">' + Math.round(nteMealKcal(meal)) + ' kcal</span>' +
      '<div class="nte-meal-actions">' +
        '<button class="wke-ex-actionbtn" title="Duplicar" onclick="nteDuplicateMeal(' + mealIdx + ')"><span data-lucide="copy"></span></button>' +
        '<button class="wke-ex-actionbtn danger" title="Remover" onclick="nteDeleteMeal(' + mealIdx + ')"><span data-lucide="trash-2"></span></button>' +
      '</div>' +
    '</div>' +
    (meal.foods.length ?
      '<table class="nte-foods"><thead><tr><th>Alimento</th><th class="num">Qtd</th><th class="num">Kcal</th><th class="num"></th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '<div style="padding:6px var(--space-3) var(--space-3);font-family:var(--font-body);font-size:var(--fs-body-sm);color:var(--c-textsub)">Sem alimentos ainda.</div>') +
    '<button class="nte-meal-addfood" onclick="openFoodSearch(' + mealIdx + ')"><span data-lucide="plus"></span> Adicionar alimento</button>' +
  '</div>';
}

function nteSelectDayType(type) {
  nteState.plan.dayType = type;
  renderNutrition();
}

function nteRefreshTotals() {
  nteRenderMacros();
  document.querySelectorAll('.nte-meal').forEach(function(card) {
    const mi = parseInt(card.getAttribute('data-meal'));
    const kcalEl = card.querySelector('.nte-meal-kcal');
    if (kcalEl) kcalEl.textContent = Math.round(nteMealKcal(nteCurrentDay().meals[mi])) + ' kcal';
  });
}

function nteEditQty(mealIdx, foodIdx, input) {
  const raw = input.value.replace(',', '.').trim();
  const num = parseFloat(raw);
  if (isNaN(num) || !/^\d*\.?\d+$/.test(raw)) {
    input.classList.add('invalid');
    wkeToast('Quantidade inválida (números apenas)', {type:'error'});
    return;
  }
  if (num <= 0) { input.classList.add('invalid'); wkeToast('Quantidade deve ser > 0', {type:'error'}); return; }
  if (num >= 10000) { input.classList.add('invalid'); wkeToast('Máximo 10.000g', {type:'error'}); return; }
  input.classList.remove('invalid');
  const food = nteCurrentDay().meals[mealIdx].foods[foodIdx];
  food.qty = num;
  input.setAttribute('data-prev', num);
  // Atualiza linha (kcal + macros) + totais
  const row = input.closest('tr');
  const mac = nteMacrosOf(food);
  if (row) {
    row.querySelector('.nte-food-kcal').textContent = Math.round(mac.kcal);
    row.querySelector('.nte-food-macros').textContent = 'P ' + mac.p.toFixed(1) + ' · C ' + mac.c.toFixed(1) + ' · G ' + mac.g.toFixed(1);
  }
  nteRefreshTotals();
  nteAutoSave();
}

function nteDeleteFood(mealIdx, foodIdx) {
  nteCurrentDay().meals[mealIdx].foods.splice(foodIdx, 1);
  renderNutrition();
  wkeToast('Alimento removido');
  nteAutoSave();
}

function nteRenameMeal(mealIdx, el) {
  const name = el.textContent.trim();
  if (!name) { el.textContent = nteCurrentDay().meals[mealIdx].name; return; }
  nteCurrentDay().meals[mealIdx].name = name;
  nteAutoSave();
}

function nteDuplicateMeal(mealIdx) {
  const day = nteCurrentDay();
  const copy = JSON.parse(JSON.stringify(day.meals[mealIdx]));
  copy.name = copy.name + ' (cópia)';
  day.meals.splice(mealIdx + 1, 0, copy);
  renderNutrition();
  wkeToast('Refeição duplicada');
  nteAutoSave();
}

function nteDeleteMeal(mealIdx) {
  const day = nteCurrentDay();
  const name = day.meals[mealIdx].name;
  // wkeConfirm em vez de confirm() nativo (iframes sandbox bloqueiam confirm)
  wkeConfirm('Remover "' + name + '"?', function() {
    day.meals.splice(mealIdx, 1);
    renderNutrition();
    wkeToast('Refeição removida');
    nteAutoSave();
  });
}

function nteAddMeal() {
  nteCurrentDay().meals.push({ name: 'Nova refeição', foods: [] });
  renderNutrition();
  wkeToast('Refeição adicionada');
  nteAutoSave();
}

function openFoodSearch(mealIdx) {
  ntePendingMeal = mealIdx;
  const ov = document.getElementById('nte-search-overlay');
  const inp = document.getElementById('nte-search-input');
  const res = document.getElementById('nte-search-results');
  ov.hidden = false;
  inp.value = '';
  nteSearchSelIdx = -1;
  nteSearchResults = [];
  res.innerHTML = '<div class="wke-search-hint">Digite ao menos 3 letras para buscar.</div>';
  setTimeout(function() { inp.focus(); }, 30);
  nteCarregarCatalogo();
}

function closeFoodSearch() {
  document.getElementById('nte-search-overlay').hidden = true;
}

function onFoodSearchInput() {
  clearTimeout(nteSearchTimer);
  nteSearchTimer = setTimeout(nteRunFoodSearch, 200); // debounce 200ms
}

function nteRunFoodSearch() {
  const bruto = document.getElementById('nte-search-input').value.trim();
  const termos = termosBusca(bruto);
  const consultaNormalizada = termos.join(' ');
  const res = document.getElementById('nte-search-results');
  nteSearchSelIdx = -1;
  // D-06: mínimo de 3 letras somadas entre os termos, sem contar espaços
  // — "ab" não busca, "ab c" busca.
  if (termos.join('').length < 3) {
    nteSearchResults = [];
    res.innerHTML = '<div class="wke-search-hint">Digite ao menos 3 letras para buscar.</div>';
    return;
  }
  if (nteCatalogoEstado === 'carregando') {
    res.innerHTML = '<div class="wke-search-hint">Carregando a base de alimentos…</div>';
    return;
  }
  if (nteCatalogoEstado === 'erro') {
    res.innerHTML = '<div class="wke-search-hint">Não foi possível carregar a base de alimentos.<br>' + (nteCatalogoMotivo || 'Motivo não identificado.') + '</div>';
    return;
  }
  if (!NTE_FOOD_DB.length) {
    res.innerHTML = nteCatalogoSemente
      ? '<div class="wke-search-hint">A base de alimentos ainda não foi gerada a partir do banco. Rode <code>npm run catalogo:alimentos</code>, faça commit do arquivo-fonte e publique o site.</div>'
      : '<div class="wke-search-hint">Nenhum alimento revisado pelo Coach chegou a esta publicação.</div>';
    return;
  }
  nteSearchResults = NTE_FOOD_DB
    .map(function(f) {
      const nomeNormalizado = dobraBusca(f.busca || f.name);
      return { f: f, nomeNormalizado: nomeNormalizado };
    })
    .filter(function(x) {
      return casaTodosTermos(x.nomeNormalizado, termos);
    })
    .sort(function(a, b) {
      const pa = pontuaAlimento(a.nomeNormalizado, termos, consultaNormalizada);
      const pb = pontuaAlimento(b.nomeNormalizado, termos, consultaNormalizada);
      if (pb !== pa) return pb - pa;
      if (a.f.name.length !== b.f.name.length) return a.f.name.length - b.f.name.length;
      return a.f.name.localeCompare(b.f.name, 'pt-BR');
    })
    .slice(0, 10) // top 10
    .map(function(x) { return x.f; });
  if (!nteSearchResults.length) {
    res.innerHTML = '<div class="wke-search-hint">Nenhum alimento encontrado para "' + bruto + '".</div>';
    return;
  }
  res.innerHTML = nteSearchResults.map(function(f, i) {
    return '<div class="wke-search-result" data-i="' + i + '" onclick="ntePickFood(' + i + ')">' +
      '<span class="nte-food-result"><span class="wke-search-result-name">' + f.name + '</span>' +
        '<span class="nte-food-result-macros">' + f.kcal + ' kcal · P ' + f.p + ' · C ' + f.c + ' · G ' + f.g + ' /100g</span></span>' +
    '</div>';
  }).join('');
}

function onFoodSearchKey(e) {
  if (e.key === 'Escape') { closeFoodSearch(); return; }
  if (!nteSearchResults.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); nteSearchSelIdx = Math.min(nteSearchSelIdx + 1, nteSearchResults.length - 1); nteHighlightFoodSearch(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); nteSearchSelIdx = Math.max(nteSearchSelIdx - 1, 0); nteHighlightFoodSearch(); }
  else if (e.key === 'Enter') { e.preventDefault(); ntePickFood(nteSearchSelIdx >= 0 ? nteSearchSelIdx : 0); }
}

function nteHighlightFoodSearch() {
  document.querySelectorAll('#nte-search-results .wke-search-result').forEach(function(el, i) {
    el.classList.toggle('active', i === nteSearchSelIdx);
  });
}

function ntePickFood(i) {
  const pick = nteSearchResults[i];
  if (!pick) return;
  ntePendingFood = pick;
  closeFoodSearch();
  const ov = document.getElementById('nte-qty-overlay');
  document.getElementById('nte-qty-title').textContent = pick.name;
  const inp = document.getElementById('nte-qty-input');
  inp.value = 100;
  ov.hidden = false;
  nteUpdateQtyPreview();
  setTimeout(function() { inp.focus(); inp.select(); }, 30);
}

function closeFoodQty() {
  document.getElementById('nte-qty-overlay').hidden = true;
  ntePendingFood = null;
}

function nteUpdateQtyPreview() {
  if (!ntePendingFood) return;
  const qty = parseFloat(String(document.getElementById('nte-qty-input').value).replace(',', '.')) || 0;
  const k = qty / 100;
  const b = ntePendingFood;
  const prev = document.getElementById('nte-qty-preview');
  prev.innerHTML =
    nteQtyPrevCell(Math.round(b.kcal * k), 'kcal') +
    nteQtyPrevCell((b.p * k).toFixed(1), 'PTN') +
    nteQtyPrevCell((b.c * k).toFixed(1), 'CHO') +
    nteQtyPrevCell((b.g * k).toFixed(1), 'GORD');
}

function nteConfirmFood() {
  if (!ntePendingFood || ntePendingMeal === null) return;
  const qty = parseFloat(String(document.getElementById('nte-qty-input').value).replace(',', '.'));
  if (isNaN(qty) || qty <= 0 || qty >= 10000) {
    document.getElementById('nte-qty-input').classList.add('invalid');
    wkeToast('Quantidade deve estar entre 0,1g e 10.000g', {type:'error'});
    return;
  }
  document.getElementById('nte-qty-input').classList.remove('invalid');
  nteCurrentDay().meals[ntePendingMeal].foods.push({
    // foodId é o vínculo estável com a coleção foods/. O nome é cópia de
    // exibição: corrigir a grafia na base não desliga o vínculo.
    foodId: ntePendingFood.id,
    name: ntePendingFood.name, qty: qty, base: ntePendingFood });
  const added = ntePendingFood.name;
  closeFoodQty();
  renderNutrition();
  wkeToast(added + ' adicionado');
  nteAutoSave();
}

function nteAutoSave() {
  clearTimeout(nteSaveTimer);
  nteSaveTimer = setTimeout(function() { EditorPlanoHost.m2SalvarRascunho('nutrition', nteState.plan); }, 500);
  var _nup = EditorPlanoHost.getPlanRef('nutrition');
  if (_nup && _nup.status === 'publicado' && !_nup.hasUnpublishedChanges) { _nup.hasUnpublishedChanges = true; EditorPlanoHost.renderPubHeader('nutrition'); }
}


// ---------- corpo do editor movido pela AC-17 (correção da fronteira) ----------
//
// O passo 1b particionou as funções do script pelo PREFIXO DO NOME — `wke`,
// `nte` —, onde a AC-15 particiona POR CONTEÚDO. As sete abaixo são corpo do
// editor e não carregam o prefixo, e por isso ficaram na hospedeira, entrando no
// contrato de gancho. Convenção de nome é pista, não critério.
//
// `renderWorkout` desenha a aba de treino e era chamada DOZE vezes daqui contra
// três da hospedeira; `renderNutrition` desenha a aba nutricional. Os cinco
// `doc*` montam o documento que o atleta recebe — o mesmo que a pré-visualização
// exibe, e a pré-visualização já estava aqui desde o passo 1b.
//
// O QUE TORNAVA A CORREÇÃO OBRIGATÓRIA, E NÃO APENAS DESEJÁVEL: o núcleo desenhava
// a prévia CHAMANDO DE VOLTA A HOSPEDEIRA para montar o conteúdo dela. A fronteira
// não estava só larga — estava invertida. Quem desenha dependia de quem hospeda
// para produzir o que desenha.
//
// A AC-15 não foi reaberta e não mudou uma vírgula: as sete são corpo do editor
// pelo critério que ela já tinha. O que se corrigiu foi a execução.
//
// `DOC_LOGO_IMG` veio junto: tinha dois usos no script de origem, a declaração e
// `docEnvelope`.

var DOC_LOGO_IMG = '<img src="/images/brand/logo-emblema.webp" srcset="/images/brand/logo-emblema.webp 1x, /images/brand/logo-emblema@2x.webp 2x" alt="" width="51" height="56" decoding="async" aria-hidden="true"/>';

function renderWorkout() {
  if (!wkeState.plan) return;
  const plan = wkeState.plan;
  const tabsEl = document.getElementById('wke-daytabs');
  const statsEl = document.getElementById('wke-stats');
  const exEl = document.getElementById('wke-exercises');
  const addBtn = document.getElementById('wke-add-ex-btn');
  const notesEl = document.getElementById('wke-coach-notes-section');
  // Estado de primeira vez: nenhum dia criado ainda
  if (!plan.order.length) {
    if (tabsEl) tabsEl.innerHTML = '';
    if (statsEl) statsEl.innerHTML = '';
    var wkeCtxEmpty = document.getElementById('wke-calcctx');
    if (wkeCtxEmpty) wkeCtxEmpty.style.display = 'none';
    if (addBtn) addBtn.style.display = 'none';
    if (notesEl) notesEl.style.display = 'none';
    const nome = (wkeState.athlete && wkeState.athlete.name.split(' ')[0]) || 'O atleta';
    if (exEl) {
      exEl.innerHTML = '<div class="wke-empty"><div class="wke-empty-icon"><span data-lucide="dumbbell"></span></div>' +
        '<div class="wke-empty-title">Nenhum plano de treino ainda</div>' +
        '<div class="wke-empty-sub">' + nome + ' ainda não tem um treino publicado. Crie o primeiro dia para começar a montar o plano.</div>' +
        '<button class="wke-firsttime-cta" onclick="wkeCreateFirstDay()"><span data-lucide="plus"></span> Criar primeiro dia</button></div>';
    }
    renderIcons();
    return;
  }
  if (addBtn) addBtn.style.display = '';
  if (notesEl) notesEl.style.display = '';
  wkeSyncCoachNotes();
  var wkeCtxEl = document.getElementById('wke-calcctx');
  if (wkeCtxEl) wkeCtxEl.style.display = 'flex';
  wkeRenderCalcContext();
  // DayTabs
  if (tabsEl) {
    wkeCloseDayMenu();
    // O clique é tratado por delegação em #wke-daytabs (wkeOnDayTabsClick),
    // não por onclick embutido: renderWorkout reconstrói esta lista inteira,
    // e o nó que recebeu o primeiro clique deixa de existir antes do
    // segundo — o que tornava o ondblclick dependente de como cada
    // navegador reconcilia alvos destruídos.
    const coarse = wkeCoarsePointer();
    tabsEl.innerHTML = plan.order.map(function(d) {
      const active = d === wkeState.activeDay;
      const hint = active
        ? (coarse ? 'Toque de novo para renomear' : 'Duplo-clique para renomear')
        : 'Selecionar dia';
      return '<span class="wke-daytab-wrap">' +
        '<button class="wke-daytab' + (active ? ' active' : '') + '" data-day="' + wkeEsc(d) + '" title="' + hint + '">' +
          wkeEsc(wkeDayName(d)) +
          (active && coarse ? '<span class="wke-daytab-pencil"><span data-lucide="pencil"></span></span>' : '') +
        '</button>' +
        '<button class="wke-daytab-menubtn' + (active && coarse ? ' always' : '') + '" title="Ações do dia" aria-label="Ações do dia" aria-haspopup="true" aria-expanded="false" data-day-menu="' + wkeEsc(d) + '"><span data-lucide="more-horizontal"></span></button>' +
      '</span>';
    }).join('') + '<button class="wke-daytab add" data-day-add="1">+ Adicionar dia</button>';
    if (!tabsEl.dataset.bound) {
      tabsEl.addEventListener('click', wkeOnDayTabsClick);
      tabsEl.addEventListener('dblclick', wkeOnDayTabsDblClick);
      tabsEl.dataset.bound = '1';
    }
  }
  const day = plan.days[wkeState.activeDay];
  // Stats
  const stats = wkeComputeStats(day);
  const vol = wkeFmtVolume(stats.volume);
  const volSub = stats.pendingCount > 0
    ? ((stats.exCount - stats.pendingCount) + ' de ' + stats.exCount + ' com carga')
    : '';
  if (statsEl) {
    statsEl.innerHTML =
      wkeStatCard(stats.exCount, '', 'Exercícios') +
      wkeStatCard(stats.groups, '', 'Grupos') +
      wkeStatCard(vol.val, vol.unit, stats.pendingCount > 0 ? 'Volume parcial' : 'Volume', volSub) +
      wkeStatCard(stats.durMin, 'min', 'Duração');
  }
  // Exercises
  if (exEl) {
    if (!day.exercises.length) {
      exEl.innerHTML = '<div class="wke-empty"><div class="wke-empty-icon"><span data-lucide="dumbbell"></span></div>' +
        '<div class="wke-empty-title">Nenhum exercício neste dia</div>' +
        '<div class="wke-empty-sub">Adicione o primeiro exercício para começar a montar o treino.</div></div>';
    } else {
      exEl.innerHTML = day.exercises.map(function(ex, i) { return wkeExerciseCard(ex, i); }).join('');
    }
  }
  renderIcons();
}

function renderNutrition() {
  if (!nteState.plan) return;
  const dayselEl = document.getElementById('nte-dayselector');
  const macrosEl = document.getElementById('nte-macros');
  const mealsEl = document.getElementById('nte-meals');
  const addBtn = document.getElementById('nte-add-meal-btn');
  const notesEl = document.getElementById('nte-coach-notes-section');
  // Estado de primeira vez: nenhum plano definido ainda
  if (nteState.plan.isNew || !nteState.plan.target) {
    if (dayselEl) dayselEl.innerHTML = '';
    if (macrosEl) macrosEl.innerHTML = '';
    var ctxEl = document.getElementById('nte-calcctx');
    if (ctxEl) ctxEl.style.display = 'none';
    if (addBtn) addBtn.style.display = 'none';
    if (notesEl) notesEl.style.display = 'none';
    const nome = (nteState.athlete && nteState.athlete.name.split(' ')[0]) || 'O atleta';
    if (mealsEl) {
      mealsEl.innerHTML = '<div class="wke-empty"><div class="wke-empty-icon"><span data-lucide="utensils"></span></div>' +
        '<div class="wke-empty-title">Nenhum plano nutricional ainda</div>' +
        '<div class="wke-empty-sub">' + nome + ' ainda não tem um plano publicado. Crie o plano para definir as metas de macros e a primeira refeição.</div>' +
        '<button class="wke-firsttime-cta" onclick="nteCreateFirstPlan()"><span data-lucide="plus"></span> Criar plano</button></div>';
    }
    renderIcons();
    return;
  }
  if (addBtn) addBtn.style.display = '';
  if (notesEl) notesEl.style.display = '';
  nteSyncCoachNotes();
  nteRenderCalcContext();
  nteRenderDaySelector();
  nteRenderMacros();
  nteRenderMeals();
  renderIcons();
}

function docEnvelope(badgeText, title, athleteName, summaryExtra, innerHtml) {
  return '<div class="doc-sheet">' +
    '<div class="doc-header">' +
      '<div class="doc-logo">' + DOC_LOGO_IMG +
        '<div><div class="doc-logo-h"><span>Coach Ruiz</span><span class="doc-logo-sep">·</span><span>ELITE90 PRO</span></div><div class="doc-logo-p">Estratégia de Alta Performance</div></div>' +
      '</div>' +
      '<span class="doc-badge">' + badgeText + '</span>' +
    '</div>' +
    '<div class="doc-card">' +
      '<div class="doc-title">' + title + '</div>' +
      '<div class="doc-summary">Documento preparado pelo Coach Ruiz para <strong>' + (athleteName || 'o atleta') + '</strong>' + (summaryExtra || '') + '. Confidencial, elaborado exclusivamente para este atleta.</div>' +
      innerHtml +
    '</div>' +
    '<div class="doc-footer"><div class="doc-footer-div"></div>' +
      '<div class="doc-footer-copy">Coach Ruiz 2026 © Todos os direitos reservados</div>' +
      '<div class="doc-footer-credit">Criado por GM Digital Bunker ©, 2026</div>' +
    '</div>' +
  '</div>';
}

function docDayTotals(meals) {
  var t = { kcal:0, p:0, c:0, g:0 };
  (meals || []).forEach(function(m){ (m.foods||[]).forEach(function(f){ var x = nteMacrosOf(f); t.kcal+=x.kcal; t.p+=x.p; t.c+=x.c; t.g+=x.g; }); });
  return t;
}

function docMacrosBlock(t) {
  return '<div class="doc-macros">' +
    '<div class="doc-macro"><div class="doc-macro-v">' + Math.round(t.p) + 'g</div><div class="doc-macro-l">Proteína</div></div>' +
    '<div class="doc-macro"><div class="doc-macro-v">' + Math.round(t.c) + 'g</div><div class="doc-macro-l">Carboidrato</div></div>' +
    '<div class="doc-macro"><div class="doc-macro-v">' + Math.round(t.g) + 'g</div><div class="doc-macro-l">Gordura</div></div>' +
    '<div class="doc-macro"><div class="doc-macro-v">' + Math.round(t.kcal) + '</div><div class="doc-macro-l">Calorias</div></div>' +
  '</div>';
}

function docMealsBlock(meals) {
  if (!meals || !meals.length) return '<div class="doc-empty">Nenhuma refeição definida para este dia.</div>';
  return meals.map(function(m){
    var foods;
    if (!m.foods || !m.foods.length) {
      foods = '<div class="doc-empty">Sem alimentos nesta refeição.</div>';
    } else {
      foods = m.foods.map(function(f){
        var qty = f.qty ? (f.qty + (f.base && f.base.unit ? f.base.unit : 'g')) : '';
        return '<div class="doc-food"><span class="doc-food-name">' + (f.name || '') + '</span><span class="doc-food-qty">' + qty + '</span></div>';
      }).join('');
    }
    return '<div class="doc-meal"><div class="doc-meal-h"><span class="doc-meal-name">' + (m.name || 'Refeição') + '</span><span class="doc-meal-kcal">' + Math.round(nteMealKcal(m)) + ' kcal</span></div>' + foods + '</div>';
  }).join('');
}

function docNotesSection(notes, sectionNum) {
  var txt = (notes == null ? '' : String(notes)).trim();
  if (!txt) return '';
  var num = ('0' + sectionNum).slice(-2);
  return '<div class="doc-divider"></div>' +
    '<div class="doc-section">' +
      '<div class="doc-section-h"><span class="doc-section-num">' + num + '</span><span class="doc-section-title">Orientações do Coach</span></div>' +
      '<div class="doc-section-body doc-notes">' + wkeEsc(txt) + '</div>' +
    '</div>';
}


// ---------- abertura de plano: a parte comum aos dois consumidores ----------
//
// AC-18 do Adendo 07 — a origem do plano é a SEGUNDA COSTURA DECLARADA do editor,
// ao lado da publicação. As duas existem pela mesma razão: são coisas que a
// hospedeira faz POR SER QUEM É, e que o núcleo não pode presumir.
//
// O QUE FICA POR HOSPEDEIRA, E POR QUÊ
//
// A ORIGEM do plano. O Coach abre por rascunho persistido, cache de sessão e
// plano-base, nessa precedência. O profissional abre por sugestão própria não
// resolvida, senão pela última versão publicada, senão vazio.
//
// A rotina do Coach lê o campo `draft` de `athletes/{uid}/plans/{planType}` —
// EXATAMENTE o lugar onde a RN-14 proíbe que o trabalho do delegado viva. Um
// núcleo que abrisse por ali faria o profissional ler o rascunho do Coach. É
// falha de confidencialidade, não de arquitetura. E o plano-base de demonstração
// é artefato de homologação da gaveta, não conteúdo de atleta.
//
// O QUE VEM PARA CÁ
//
// Calibrar e aplicar. Servem aos dois consumidores igualmente, e é isso que as
// torna do núcleo.
//
// POR QUE DUAS FUNÇÕES, E NÃO UMA
//
// A calibração roda APENAS sobre plano que precise dela — hoje, o plano-base.
// Fundi-la com a aplicação faria o Coach escalar também o rascunho persistido,
// que já vem com as cargas do atleta: um plano gravado seria reescalado a cada
// abertura, e as cargas subiriam a cada vez. Comportamento diferente do de hoje,
// e silencioso.
//
// A nutrição não tem par de `wkeCalibrarPlano`: `nteBuildBasePlan` já recebe o
// atleta e resolve as metas pelo peso e pela fase, e já vive aqui desde o passo
// 1a. Uma função de calibração vazia, só por simetria, seria pior que a
// assimetria.

/**
 * Calibra um plano de treino DE MODELO para um atleta: escala cargas e PR pelo
 * peso, e preenche os dois campos derivados.
 *
 * NÃO chamar sobre plano já gravado — ver a razão acima. Devolve o mesmo objeto,
 * alterado no lugar, como a rotina de origem fazia.
 */
function wkeCalibrarPlano(plano, athlete) {
  if (!plano || !plano.order) return plano;
  const scale = (athlete.weightCurrentKg || 85) / 85;
  plano.order.forEach(function(d) {
    plano.days[d].exercises.forEach(function(ex) {
      ex.pr = wkeRound(ex.pr * scale);
      ex.sets.forEach(function(s) { s.load = wkeRound(s.load * scale); });
      // C-04: descanso a nível de exercício (default = descanso da 1ª série)
      ex.rest_default = (ex.sets[0] && ex.sets[0].rest) || 60;
      // C-05: máximo histórico registrado = PR calibrado (nunca null p/ exercícios do plano-base)
      ex.last_max = ex.pr;
    });
  });
  return plano;
}

/** Aplica ao estado do editor de treino e desenha. Comum aos dois consumidores. */
function wkeAplicarPlano(athlete, plano) {
  wkeState.athlete = athlete;
  wkeState.plan = plano;
  if (wkeState.plan.order.length && !wkeState.plan.days[wkeState.activeDay]) wkeState.activeDay = wkeState.plan.order[0];
  renderWorkout();
}

/** Aplica ao estado do editor nutricional e desenha. Comum aos dois consumidores. */
function nteAplicarPlano(athlete, plano) {
  nteState.athlete = athlete;
  nteState.plan = plano;
  renderNutrition();
}
