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
