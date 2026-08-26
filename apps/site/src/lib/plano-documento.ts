// ELITE90 PRO · plano-documento
// Renderiza o protocolo (treino ou nutricional) do atleta como o documento
// visual que ele recebe — "envelope" de marca + seções — para a rota pública
// /plano/[token].astro.
//
// ESPELHA, NÃO IMPORTA: apps/site/src/pages/admin/atletas.astro
// As funções docEnvelope/docMealsBlock/docDayTotals/docMacrosBlock e o bloco
// de dias de treino que aparecem lá (dentro de wkeOpenPreview/nteOpenPreview,
// usadas por "Ver como o atleta recebe") são a ORIGEM desta lógica — portada
// aqui, não importada de lá, porque o script de atletas.astro é
// `<script type="module" is:inline>`: Astro não processa esse bloco, então
// ele não pode importar um módulo do bundler. Mesma restrição, mesma solução,
// que já vale para o vocabulário de exercícios/alimentos (ver o cabeçalho de
// _vocabulario-exercicios.ts) — duplicação registrada, não acidental.
//
// SE ALTERAR A APARÊNCIA DO DOCUMENTO AQUI, ALTERE TAMBÉM em atletas.astro
// (docEnvelope e vizinhas, e o CSS .doc-* no <style> do arquivo) — as duas
// cópias existem para que o preview que o Coach vê ("Ver como o atleta
// recebe") e o link que o atleta de fato recebe mostrem o MESMO documento.
//
// A DIFERENÇA REAL EM RELAÇÃO AO PREVIEW DO PAINEL
// O preview em atletas.astro lê valor AO VIVO (nteMacrosOf calcula a partir de
// food.base, o estado atual da base de alimentos). Esta página pública NUNCA
// deveria fazer isso: o que está aqui é sempre uma versão PUBLICADA, e
// publicação é imutável (ver o comentário de nteCongelarPlano em
// atletas.astro) — precisamente para que uma correção posterior na base de
// alimentos não reescreva, em silêncio, o que o atleta já recebeu. Por isso as
// funções de nutrição abaixo leem `foods[].snapshot` (macrosSnapshot,
// quantidadeG, nomeSnapshot, medidaCaseiraSnapshot) e não `foods[].base` — o
// retrato congelado no instante da publicação, nunca o valor corrente.
//
// Treino não tem o mesmo problema: o nome do exercício já é copiado para o
// item do plano no momento em que é adicionado (não é buscado ao vivo do
// catálogo), e reps/carga são dados do próprio plano, não derivados de uma
// base externa que possa mudar depois. Por isso o bloco de treino abaixo é
// portado tal como está no preview, sem uma segunda versão "congelada".
//
// PREMISSA DE FORMATO — A CONFIRMAR COM QUEM PERSISTIR trainingPlan/nutritionPlan
// Hoje esses campos só existem em memória no navegador (ver o comentário de
// doPublish em atletas.astro: "AGUARDA A PERSISTÊNCIA DO M2"). Este módulo
// assume que a persistência real vai gravar o MESMO formato que já existe em
// memória hoje:
//   trainingPlan.plan   = { order: string[], days: { [chave]: { label?, exercises: [{ name, sets: [{ reps, load }] }] } } }
//   nutritionPlan.plan  = { days: { treino: { meals }, descanso: { meals } } },
//                         meals = [{ name, foods: [{ snapshot?: {...}, name, qty, base? }] }]
// Se o formato final divergir, ajustar aqui — não redesenhar o documento.

export type TrainingSet = { reps?: string | number; load?: number | string | null };
export type TrainingExercise = { name?: string; sets?: TrainingSet[] };
export type TrainingDay = { label?: string; exercises?: TrainingExercise[] };
export type TrainingPlan = { order: string[]; days: Record<string, TrainingDay> };

export type FoodSnapshot = {
  quantidadeG?: number;
  nomeSnapshot?: string;
  medidaCaseiraSnapshot?: string | null;
  macrosSnapshot?: { kcal?: number; p?: number; c?: number; g?: number };
};
export type PlanFood = { snapshot?: FoodSnapshot; name?: string; qty?: number; base?: { unit?: string } };
export type Meal = { name?: string; foods?: PlanFood[] };
export type NutritionPlan = { days: { treino?: { meals?: Meal[] }; descanso?: { meals?: Meal[] } } };

const DOC_LOGO_IMG =
  '<img src="/images/brand/logo-emblema.webp" srcset="/images/brand/logo-emblema.webp 1x, /images/brand/logo-emblema@2x.webp 2x" alt="" width="51" height="56" decoding="async" aria-hidden="true"/>';

/** Envelope de marca em volta do conteúdo — igual ao de atletas.astro. */
function docEnvelope(badgeText: string, title: string, athleteName: string | null, summaryExtra: string, innerHtml: string): string {
  return (
    '<div class="doc-sheet">' +
      '<div class="doc-header">' +
        '<div class="doc-logo">' + DOC_LOGO_IMG +
          '<div><div class="doc-logo-h"><span>Coach Ruiz</span><span class="doc-logo-sep">·</span><span>ELITE90 PRO</span></div><div class="doc-logo-p">Estratégia de Alta Performance</div></div>' +
        '</div>' +
        '<span class="doc-badge">' + badgeText + '</span>' +
      '</div>' +
      '<div class="doc-card">' +
        '<div class="doc-title">' + title + '</div>' +
        '<div class="doc-summary">Documento preparado pelo Coach Ruiz para <strong>' + (athleteName || 'o atleta') + '</strong>' + summaryExtra + '. Confidencial, elaborado exclusivamente para este atleta.</div>' +
        innerHtml +
      '</div>' +
      '<div class="doc-footer"><div class="doc-footer-div"></div>' +
        '<div class="doc-footer-copy">Coach Ruiz 2026 © Todos os direitos reservados</div>' +
        '<div class="doc-footer-credit">Criado por GM Digital Bunker ©, 2026</div>' +
      '</div>' +
    '</div>'
  );
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c as string] as string));

function dayName(d: TrainingDay | undefined, chave: string): string {
  const l = (d && d.label) || ('Dia ' + chave);
  return l.split('—')[0].trim();
}

/** Bloco de treino — porta wkeOpenPreview() tal como está, sem congelamento
 *  (ver o cabeçalho: reps/carga são do próprio plano, nome já vem fixado). */
export function renderTreino(athleteName: string | null, plan: TrainingPlan): string {
  const order = Array.isArray(plan?.order) ? plan.order : [];
  const inner = order.map((chave, idx) => {
    const dia = plan.days?.[chave];
    const num = String(idx + 1).padStart(2, '0');
    const exercicios = dia?.exercises ?? [];
    const exHtml = !exercicios.length
      ? '<div class="doc-empty">Nenhum exercício neste dia.</div>'
      : exercicios.map((ex) => {
          const sets = (ex.sets ?? []).map((s) => {
            const load = (s.load !== undefined && s.load !== null && s.load !== '') ? `${s.load}kg` : '—';
            return `${s.reps ?? '?'} × ${load}`;
          }).join('  ·  ');
          return `<div class="doc-ex"><div class="doc-ex-name">${esc(ex.name || 'Exercício')}</div><div class="doc-ex-sets">${esc(sets)}</div></div>`;
        }).join('');
    const sec = `<div class="doc-section">` +
      `<div class="doc-section-h"><span class="doc-section-num">${num}</span><span class="doc-section-title">${esc(dayName(dia, chave))}</span></div>` +
      exHtml +
    `</div>`;
    return sec + (idx < order.length - 1 ? '<div class="doc-divider"></div>' : '');
  }).join('');

  return docEnvelope('Plano de Treino', 'Plano de Treino', athleteName, ' com base na sua fase e objetivo do ciclo', inner);
}

/** Macros de um item, a partir do retrato congelado na publicação — nunca do
 *  valor corrente da base. Sem `.snapshot` (não deveria acontecer num plano
 *  publicado; ver o cabeçalho), cai para o valor ao vivo como reserva segura,
 *  em vez de mostrar zero. */
function macrosDoItem(f: PlanFood): { kcal: number; p: number; c: number; g: number } {
  const snap = f.snapshot;
  if (snap?.macrosSnapshot) {
    const k = (snap.quantidadeG || 0) / 100;
    const m = snap.macrosSnapshot;
    return { kcal: (m.kcal || 0) * k, p: (m.p || 0) * k, c: (m.c || 0) * k, g: (m.g || 0) * k };
  }
  const b = (f as any).base || { kcal: 0, p: 0, c: 0, g: 0 };
  const k = (f.qty || 0) / 100;
  return { kcal: b.kcal * k, p: b.p * k, c: b.c * k, g: b.g * k };
}

function docMealsBlock(meals: Meal[] | undefined): string {
  if (!meals || !meals.length) return '<div class="doc-empty">Nenhuma refeição definida para este dia.</div>';
  return meals.map((m) => {
    const alimentos = m.foods ?? [];
    const foodsHtml = !alimentos.length
      ? '<div class="doc-empty">Sem alimentos nesta refeição.</div>'
      : alimentos.map((f) => {
          const snap = f.snapshot;
          const nome = snap?.nomeSnapshot ?? f.name ?? '';
          const qtd = snap?.quantidadeG ?? f.qty;
          const qty = qtd ? `${qtd}g` : '';
          return `<div class="doc-food"><span class="doc-food-name">${esc(nome)}</span><span class="doc-food-qty">${esc(qty)}</span></div>`;
        }).join('');
    const kcalRefeicao = alimentos.reduce((soma, f) => soma + macrosDoItem(f).kcal, 0);
    return `<div class="doc-meal"><div class="doc-meal-h"><span class="doc-meal-name">${esc(m.name || 'Refeição')}</span><span class="doc-meal-kcal">${Math.round(kcalRefeicao)} kcal</span></div>${foodsHtml}</div>`;
  }).join('');
}

function docDayTotals(meals: Meal[] | undefined): { kcal: number; p: number; c: number; g: number } {
  const t = { kcal: 0, p: 0, c: 0, g: 0 };
  (meals ?? []).forEach((m) => (m.foods ?? []).forEach((f) => {
    const x = macrosDoItem(f);
    t.kcal += x.kcal; t.p += x.p; t.c += x.c; t.g += x.g;
  }));
  return t;
}

function docMacrosBlock(t: { kcal: number; p: number; c: number; g: number }): string {
  return (
    '<div class="doc-macros">' +
      `<div class="doc-macro"><div class="doc-macro-v">${Math.round(t.p)}g</div><div class="doc-macro-l">Proteína</div></div>` +
      `<div class="doc-macro"><div class="doc-macro-v">${Math.round(t.c)}g</div><div class="doc-macro-l">Carboidrato</div></div>` +
      `<div class="doc-macro"><div class="doc-macro-v">${Math.round(t.g)}g</div><div class="doc-macro-l">Gordura</div></div>` +
      `<div class="doc-macro"><div class="doc-macro-v">${Math.round(t.kcal)}</div><div class="doc-macro-l">Calorias</div></div>` +
    '</div>'
  );
}

/** Bloco nutricional — mesma estrutura de dois dias (treino/descanso) do
 *  preview em atletas.astro, com macros lidos do retrato congelado. */
export function renderNutricional(athleteName: string | null, plan: NutritionPlan): string {
  const dias = plan?.days ?? {};
  const defs = [
    { num: '01', title: 'Dia de Treino', meals: dias.treino?.meals ?? [] },
    { num: '02', title: 'Dia de Descanso', meals: dias.descanso?.meals ?? [] },
  ];
  const inner = defs.map((d, i) => {
    const t = docDayTotals(d.meals);
    const sec = `<div class="doc-section">` +
      `<div class="doc-section-h"><span class="doc-section-num">${d.num}</span><span class="doc-section-title">${esc(d.title)}</span></div>` +
      docMacrosBlock(t) +
      docMealsBlock(d.meals) +
    `</div>`;
    return sec + (i < defs.length - 1 ? '<div class="doc-divider"></div>' : '');
  }).join('');

  return docEnvelope('Plano Nutricional', 'Plano Nutricional', athleteName, ' com base na sua fase e composição corporal', inner);
}

/**
 * Renderiza o documento do protocolo publicado. `kind` decide qual dos dois
 * — o chamador (a página pública) é quem sabe qual token combinou.
 */
export function renderPlanDocument(kind: 'training' | 'nutrition', athleteName: string | null, plan: TrainingPlan | NutritionPlan): string {
  return kind === 'training'
    ? renderTreino(athleteName, plan as TrainingPlan)
    : renderNutricional(athleteName, plan as NutritionPlan);
}

/** CSS do documento — cópia exata do bloco .doc-* de atletas.astro (linhas
 *  666-717 na conferência de 26/08/2026). Ver o aviso de duplicação no topo
 *  deste arquivo: alterar os dois juntos. */
export const DOC_CSS = `
  .doc-sheet { max-width: 760px; margin: 0 auto; }
  .doc-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 20px; margin-bottom: 28px; border-bottom: 1px solid rgba(166,195,0,0.2); }
  .doc-logo { display: flex; align-items: center; gap: 12px; }
  .doc-logo img { width: 51px; height: 56px; flex-shrink: 0; display: block; }
  .doc-logo-h { font-family: var(--font-display); font-size: 1.35rem; letter-spacing: 0.1em; color: var(--c-lime); line-height: 1; display: flex; align-items: baseline; gap: 0.3em; white-space: nowrap; }
  @media (max-width: 480px) {
    .doc-logo-h { flex-direction: column; align-items: flex-start; gap: 2px; font-size: 1.15rem; }
    .doc-logo-sep { display: none; }
    .doc-logo-p { font-size: 0.5rem; letter-spacing: 0.1em; }
    .doc-badge { font-size: 0.52rem; padding: 5px 10px; letter-spacing: 0.08em; }
  }
  .doc-logo-p { font-family: var(--font-body); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--c-textsub); margin-top: 3px; }
  .doc-badge { padding: 6px 14px; border-radius: var(--radius-pill); font-family: var(--font-label); font-size: 0.6rem; font-weight: var(--fw-label); letter-spacing: 0.12em; text-transform: uppercase; background: rgba(85,102,0,0.3); color: var(--c-lime); border: 1px solid rgba(166, 195, 0, 0.50); white-space: nowrap; }
  .doc-card { position: relative; background: #121212; border-radius: 18px; padding: 32px; border: 1px solid rgba(255,255,255,0.05); }
  .doc-card::after { content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; background: linear-gradient(to bottom right, rgba(166,195,0,0.35), rgba(85,102,0,0.05)); -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
  .doc-title { font-family: var(--font-display); font-size: clamp(1.6rem, 4vw, 2.4rem); letter-spacing: 0.04em; color: var(--c-white); line-height: 1.1; margin-bottom: 24px; }
  .doc-summary { padding: 18px 20px; background: rgba(0,0,0,0.4); border-left: 3px solid var(--c-lime); border-radius: 0 10px 10px 0; font-family: var(--font-body); font-size: 0.8rem; color: var(--c-textbody); line-height: 1.8; margin-bottom: 36px; }
  .doc-summary strong { color: var(--c-white); }
  .doc-section { margin-bottom: 32px; }
  .doc-section:last-child { margin-bottom: 0; }
  .doc-section-h { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .doc-section-num { font-family: var(--font-display); font-size: 1.7rem; color: var(--c-lime); line-height: 1; }
  .doc-section-title { font-family: var(--font-display); font-size: clamp(1.1rem, 3vw, 1.5rem); letter-spacing: 0.06em; color: var(--c-white); text-transform: uppercase; }
  .doc-section-body { font-family: var(--font-body); font-size: 0.82rem; line-height: 1.85; color: var(--c-textbody); }
  .doc-divider { height: 1px; background: rgba(255,255,255,0.06); margin: 28px 0; }
  .doc-macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 4px 0 6px; }
  .doc-macro { background: var(--c-black); border-radius: var(--radius-card); padding: 10px; text-align: center; }
  .doc-macro-v { font-family: var(--font-display); font-size: 1.2rem; color: var(--c-lime); line-height: 1; }
  .doc-macro-l { font-family: var(--font-label); font-size: 0.5rem; color: var(--c-textsub); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }
  .doc-meal { border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px; margin-top: 12px; }
  .doc-meal:first-of-type { border-top: none; margin-top: 8px; padding-top: 0; }
  .doc-meal-h { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
  .doc-meal-name { font-family: var(--font-label); font-size: 0.68rem; font-weight: var(--fw-label); color: var(--c-white); text-transform: uppercase; letter-spacing: 0.06em; }
  .doc-meal-kcal { font-family: var(--font-display); font-size: 0.9rem; color: var(--c-lime); }
  .doc-food { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 3px 0; }
  .doc-food-name { font-family: var(--font-body); font-size: 0.76rem; color: var(--c-textbody); }
  .doc-food-qty { font-family: var(--font-body); font-size: 0.7rem; color: var(--c-textsub); white-space: nowrap; }
  .doc-empty { font-family: var(--font-body); font-size: 0.74rem; color: var(--c-textsub); font-style: italic; padding: 4px 0; }
  .doc-ex { border-top: 1px solid rgba(255,255,255,0.06); padding: 10px 0; }
  .doc-ex:first-of-type { border-top: none; padding-top: 4px; }
  .doc-ex-name { font-family: var(--font-label); font-size: 0.72rem; font-weight: var(--fw-label); color: var(--c-white); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
  .doc-ex-sets { font-family: var(--font-body); font-size: 0.76rem; color: var(--c-textbody); }
  .doc-footer { text-align: center; padding: 24px 0 8px; margin-top: 28px; }
  .doc-footer-div { width: 100%; height: 1px; background: linear-gradient(to right, transparent, var(--c-lime) 20%, var(--c-lime) 80%, transparent); opacity: 0.25; margin-bottom: 18px; }
  .doc-footer-copy { font-family: var(--font-label); font-size: 0.55rem; font-weight: var(--fw-label); text-transform: uppercase; letter-spacing: 0.1em; color: var(--c-textsub); }
  .doc-footer-credit { font-family: var(--font-label); font-size: 0.5rem; font-weight: var(--fw-label); text-transform: uppercase; letter-spacing: 0.08em; color: rgba(153,153,153,0.5); margin-top: 6px; }
`;
