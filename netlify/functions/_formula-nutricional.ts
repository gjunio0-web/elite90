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
export type FormulaConfig = {
  phases: Record<PlanPhase, CoeficientesFase>;
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

export function validarCoeficientesFormula(payload: unknown):
  | { ok: true; phases: Record<PlanPhase, CoeficientesFase> }
  | { ok: false; erro: string } {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, erro: "phases precisa ser um mapa." };
  }
  const entrada = payload as Record<string, unknown>;
  const saida = {} as Record<PlanPhase, CoeficientesFase>;

  for (const fase of PLAN_PHASES) {
    const v = entrada[fase];
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      return { ok: false, erro: `phases.${fase} ausente ou não é um mapa.` };
    }
    const c = v as Record<string, unknown>;
    for (const campo of ["proteinPerKg", "carbPerKg", "fatPerKg"] as const) {
      const n = c[campo];
      if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
        return { ok: false, erro: `phases.${fase}.${campo} precisa ser um número maior que zero.` };
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
  weightKgUsed: number,
): Promise<Record<string, unknown>> {
  if (!PLAN_PHASES.includes(phase as PlanPhase)) throw new FaseInvalidaError(phase);
  const fase = phase as PlanPhase;

  const config = await garantirFormulaConfig(db);
  const coef = config.phases[fase] ?? FORMULA_DEFAULTS[fase];

  const proteinG = Math.round(weightKgUsed * coef.proteinPerKg);
  const carbG = Math.round(weightKgUsed * coef.carbPerKg);
  const fatG = Math.round(weightKgUsed * coef.fatPerKg);
  // 4 kcal/g proteína e carboidrato, 9 kcal/g gordura — mesma conta de
  // `nteBuildBasePlan` (nucleo.js), preservada aqui.
  const kcal = Math.round(proteinG * 4 + carbG * 4 + fatG * 9);

  return {
    phase: fase,
    proteinPerKg: coef.proteinPerKg,
    carbPerKg: coef.carbPerKg,
    fatPerKg: coef.fatPerKg,
    weightKgUsed,
    targets: { proteinG, carbG, fatG, kcal },
  };
}

export { COLECAO_CONFIG, DOC_FORMULA };
export const camposAtualizacao = (uid: string, email: string | null) => ({
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: { uid, email },
});
