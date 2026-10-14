// ELITE90 PRO · _formula-nutricional
// Módulo compartilhado: `config/nutritionFormula` (Adendo 03, AF-01 a AF-10).
//
// O QUE ESTE MÓDULO RESOLVE
//
// Onde vive a fórmula que calcula metas de macronutrientes, e como cada
// versão publicada de plano nutricional guarda uma cópia dos coeficientes
// que a produziu. Antes deste módulo, a configuração vivia só no navegador
// (`localStorage`, chave `elite90_nte_formula`) — perdida ao trocar de
// máquina, e sem registro de qual fórmula gerou qual plano (Adendo 03, §3).
//
// AF-01: "as duas coisas" — documento de configuração global, E cópia dos
// coeficientes dentro de cada versão publicada. Uma sem a outra resolve só
// metade do problema (§4 do adendo). As duas moram aqui porque nascem juntas:
// o retrato sempre lê a configuração vigente no instante da publicação.
//
// COPIAR, NÃO REFERENCIAR (AF-02). O retrato guarda peso usado e metas
// resultantes, não um ponteiro para a configuração — mesmo princípio já
// aplicado a `originatedBy` (Adendo 02): o documento de versão é imutável e
// precisa ser autoexplicativo, sem depender de outro documento continuar a
// dizer a mesma coisa amanhã.

import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { PLAN_PHASES, type PlanPhase } from "./_m2-validacao";

const COLECAO_CONFIG = "config";
const DOC_FORMULA = "nutritionFormula";

export type CoeficientesFase = { proteinPerKg: number; carbPerKg: number; fatPerKg: number };
/** Which table a coefficient comes from: `phases` is the training day. */
export type DiaFormula = "treino" | "descanso";

export type FormulaConfig = {
  /** Training-day coefficients. */
  phases: Record<PlanPhase, CoeficientesFase>;
  /**
   * Rest-day coefficients, same shape as `phases`. Optional: documents written
   * before the rest-day table existed lack it, and then the rest day uses
   * `phases` (no new default values — AF-06).
   */
  restDayPhases?: Record<PlanPhase, CoeficientesFase>;
  updatedAt: Timestamp | null;
  updatedBy: { uid: string; email: string | null } | null;
  _test: boolean;
};

/**
 * Valores de origem (Adendo 03, V-2). Este módulo NÃO os altera — mudar
 * coeficiente é decisão clínica (AF-06), fora deste escopo. Nascem em inglês
 * (AF-08): a chave `Maintenance` é o valor que antes só existia como
 * `'Manutenção'` no código do cliente, nunca alcançável de verdade porque a
 * transição de fase (item 5 da Fase 5) ainda não existe — mas o coeficiente
 * já tem lugar certo, por precaução, quando ela existir.
 */
export const FORMULA_DEFAULTS: Record<PlanPhase, CoeficientesFase> = {
  Bulking: { proteinPerKg: 2.0, carbPerKg: 5.0, fatPerKg: 1.1 },
  Cutting: { proteinPerKg: 2.4, carbPerKg: 3.0, fatPerKg: 0.8 },
  "Diet Break": { proteinPerKg: 2.2, carbPerKg: 3.5, fatPerKg: 0.9 },
  Maintenance: { proteinPerKg: 2.0, carbPerKg: 4.0, fatPerKg: 1.0 },
};

/**
 * Plausibility bounds per coefficient, in g/kg of body weight. They exist to
 * catch typing errors — chiefly a misplaced decimal separator ("22" for
 * "2,2") — before a bad value is saved as the house-wide formula. They are
 * NOT clinical limits: they are deliberately wide so that no legitimate
 * prescription is blocked (e.g. a strict ketogenic diet, ~0.3 g/kg of
 * carbohydrate). Clinical guidance ranges, if adopted, belong in a separate
 * non-blocking warning.
 *
 * Approved by the product owner on 09/10/2026. Mirrored on the client as
 * `NTE_FORMULA_LIMITS` in packages/editor-plano/nucleo.js — change both
 * together. The server is the authority: this check runs whatever the caller.
 */
export const FORMULA_LIMITS: Record<keyof CoeficientesFase, { min: number; max: number }> = {
  proteinPerKg: { min: 0.8, max: 5.0 },
  carbPerKg: { min: 0.2, max: 12.0 },
  fatPerKg: { min: 0.3, max: 3.5 },
};

/**
 * Devolve `config/nutritionFormula`, criando-o com os valores de origem na
 * primeira leitura (CF-07: "o documento nasce com os coeficientes de
 * origem"). Sem isto, o documento só existiria depois que alguém abrisse o
 * painel de configuração — e uma publicação antes disso teria fórmula sem
 * fonte para copiar.
 */
export async function garantirFormulaConfig(db: Firestore): Promise<FormulaConfig> {
  const ref = db.collection(COLECAO_CONFIG).doc(DOC_FORMULA);
  const snap = await ref.get();
  if (snap.exists) return snap.data() as FormulaConfig;

  const origem: FormulaConfig = {
    phases: FORMULA_DEFAULTS,
    updatedAt: null,
    updatedBy: null,
    _test: process.env.CONTEXT !== "production",
  };
  // `create`, não `set`: se duas requisições concorrentes chegarem à primeira
  // leitura ao mesmo tempo, a segunda `create` falha em vez de sobrescrever a
  // primeira em silêncio — e o catch abaixo relê o que já existe.
  try {
    await ref.create(origem);
  } catch {
    const relido = await ref.get();
    if (relido.exists) return relido.data() as FormulaConfig;
    throw new Error("Não foi possível criar config/nutritionFormula.");
  }
  return origem;
}

/**
 * Validates one coefficient table. `rotulo` is the field name used in the
 * error messages (`phases` for the training day, `restDayPhases` for the rest
 * day); the bounds are the same for both tables.
 */
export function validarCoeficientesFormula(payload: unknown, rotulo = "phases"):
  | { ok: true; phases: Record<PlanPhase, CoeficientesFase> }
  | { ok: false; erro: string } {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, erro: `${rotulo} precisa ser um mapa.` };
  }
  const entrada = payload as Record<string, unknown>;
  const saida = {} as Record<PlanPhase, CoeficientesFase>;

  for (const fase of PLAN_PHASES) {
    const v = entrada[fase];
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return { ok: false, erro: `${rotulo}.${fase} ausente ou não é um mapa.` };
    }
    const c = v as Record<string, unknown>;
    for (const campo of ["proteinPerKg", "carbPerKg", "fatPerKg"] as const) {
      const n = c[campo];
      if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
        return { ok: false, erro: `${rotulo}.${fase}.${campo} precisa ser um número maior que zero.` };
      }
      const { min, max } = FORMULA_LIMITS[campo];
      if (n < min || n > max) {
        return {
          ok: false,
          erro: `${rotulo}.${fase}.${campo} fora da faixa aceita (${min} a ${max} g/kg): recebido ${n}.`,
        };
      }
    }
    saida[fase] = {
      proteinPerKg: c.proteinPerKg as number,
      carbPerKg: c.carbPerKg as number,
      fatPerKg: c.fatPerKg as number,
    };
  }
  return { ok: true, phases: saida };
}

/**
 * Thrown by `calcularFormulaSnapshot` when the stored coefficient for the
 * athlete's phase is outside FORMULA_LIMITS. Writes are already bounded by
 * `validarCoeficientesFormula`; this guards values saved before the bounds
 * existed, so they are never silently frozen into a published plan.
 */
export class FormulaForaDaFaixaError extends Error {
  constructor(
    public fase: PlanPhase,
    public campo: keyof CoeficientesFase,
    public valor: number,
    public min: number,
    public max: number,
    public dia: DiaFormula = "treino",
  ) {
    const tabela = dia === "descanso" ? "dia de descanso, " : "";
    super(`Coeficiente ${tabela}${fase}.${campo} = ${valor} fora da faixa aceita (${min} a ${max} g/kg).`);
  }
}

/**
 * Thrown by `calcularFormulaSnapshot` when the athlete has no usable weight:
 * missing, not a number, zero or negative (Adendo 03 v1.6, AF-16). Without it
 * every target would be frozen as zero (or negative) in the published plan.
 */
export class PesoAusenteError extends Error {
  constructor(public valor: unknown) {
    super(`Peso do atleta ausente ou inválido para o cálculo da fórmula: ${JSON.stringify(valor ?? null)}.`);
  }
}

export class FaseInvalidaError extends Error {
  constructor(public fase: unknown) {
    super(`Fase inválida para cálculo de fórmula: ${JSON.stringify(fase)}.`);
  }
}

/**
 * O retrato que entra em `content.formulaSnapshot` (Adendo 03, §6). Lança
 * `FaseInvalidaError` se a fase do atleta não estiver no vocabulário fechado
 * — CORRESPONDÊNCIA EXATA, nunca recurso silencioso a Bulking (AF-03, CF-01,
 * CF-12): é exatamente a falha que o estado anterior cometia em silêncio.
 *
 * CF-05: "nenhum recálculo na leitura" fala da LEITURA de uma versão já
 * publicada — não impede que ESTA função, no instante da PUBLICAÇÃO, calcule
 * as metas que vão ser congeladas. É o mesmo texto do Adendo 03 §6: "as metas
 * gravadas no retrato são iguais às exibidas ao Coach no momento da
 * publicação" — e este cálculo roda nesse mesmo instante, com a mesma fórmula.
 */
export async function calcularFormulaSnapshot(
  db: Firestore,
  phase: unknown,
  weightKg: unknown,
): Promise<Record<string, unknown>> {
  if (!PLAN_PHASES.includes(phase as PlanPhase)) throw new FaseInvalidaError(phase);
  const fase = phase as PlanPhase;

  // AF-16: the weight is taken as stored, never coerced. Callers used to pass
  // `Number(weightCurrentKg) || 0`, which turned a missing weight into zero
  // targets. Checked before any database read.
  if (typeof weightKg !== "number" || !Number.isFinite(weightKg) || weightKg <= 0) {
    throw new PesoAusenteError(weightKg);
  }
  const weightKgUsed = weightKg;

  const config = await garantirFormulaConfig(db);
  const coef = config.phases[fase] ?? FORMULA_DEFAULTS[fase];
  // Rest day: its own table when present, otherwise the training table.
  const coefDescanso = config.restDayPhases?.[fase] ?? coef;
  conferirFaixa(fase, coef, "treino");
  conferirFaixa(fase, coefDescanso, "descanso");

  // The existing fields stay the training day, so snapshots written before the
  // rest day existed keep their meaning; the rest day goes in `restDay`.
  return {
    phase: fase,
    proteinPerKg: coef.proteinPerKg,
    carbPerKg: coef.carbPerKg,
    fatPerKg: coef.fatPerKg,
    weightKgUsed,
    targets: calcularMetas(weightKgUsed, coef),
    restDay: {
      proteinPerKg: coefDescanso.proteinPerKg,
      carbPerKg: coefDescanso.carbPerKg,
      fatPerKg: coefDescanso.fatPerKg,
      targets: calcularMetas(weightKgUsed, coefDescanso),
    },
  };
}

/** AF-14: refuses a stored coefficient outside FORMULA_LIMITS, for either table. */
function conferirFaixa(fase: PlanPhase, coef: CoeficientesFase, dia: DiaFormula): void {
  for (const campo of ["proteinPerKg", "carbPerKg", "fatPerKg"] as const) {
    const { min, max } = FORMULA_LIMITS[campo];
    const valor = coef[campo];
    if (typeof valor !== "number" || !Number.isFinite(valor) || valor < min || valor > max) {
      throw new FormulaForaDaFaixaError(fase, campo, valor, min, max, dia);
    }
  }
}

function calcularMetas(pesoKg: number, coef: CoeficientesFase) {
  const proteinG = Math.round(pesoKg * coef.proteinPerKg);
  const carbG = Math.round(pesoKg * coef.carbPerKg);
  const fatG = Math.round(pesoKg * coef.fatPerKg);
  // 4 kcal/g proteína e carboidrato, 9 kcal/g gordura — mesma conta de
  // `nteCalcularMetas` (nucleo.js), preservada aqui.
  const kcal = Math.round(proteinG * 4 + carbG * 4 + fatG * 9);
  return { proteinG, carbG, fatG, kcal };
}

export { COLECAO_CONFIG, DOC_FORMULA };
export const camposAtualizacao = (uid: string, email: string | null) => ({
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: { uid, email },
});
