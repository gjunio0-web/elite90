// ELITE90 PRO · _m2-validacao
// Vocabulário fechado e validação de carga do Módulo M2 (Acompanhamento).
//
// POR QUE ESTE MÓDULO EXISTE, E POR QUE NO SERVIDOR
// A tela também valida, mas validação de tela é conveniência: quem chama a
// função pode não ser a tela. O servidor é o único lugar onde a regra vale de
// verdade. Este módulo é a fonte única — a tela pode importar as mesmas listas
// em vez de manter cópia própria, exatamente como _vocabulario-exercicios.ts
// faz com CAMPOS_EDITAVEIS.
//
// ESCOPO ATUAL: o rascunho de plano (Fase 1 do plano de persistência) e o
// rótulo externo do atleta (Fase 2, Adendo 02 — Delegação). As demais
// estruturas do M2 — check-in, série de peso, avaliação física, relatório —
// entram aqui quando as fases correspondentes forem implementadas.
// Não antecipar: validar estrutura que ainda não é gravada envelhece sozinho.

// @ts-ignore — módulo CommonJS compartilhado com scripts/ (mesmo arranjo de
// _athlete-from-lead.js em promote-lead.ts). A forma do rótulo é definida uma
// única vez lá; aqui ela só é reexportada e aplicada.
import externalLabelModule from "./_external-label.js";
const { EXTERNAL_LABEL_PATTERN, isExternalLabel } = externalLabelModule as {
  EXTERNAL_LABEL_PATTERN: RegExp;
  isExternalLabel: (v: unknown) => boolean;
};
export { EXTERNAL_LABEL_PATTERN };

/** Tipos de plano. Fechado — o esquema de persistência v3, seção 8, define dois. */
export const PLAN_TYPES = ["training", "nutrition"] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

/** Situação do plano. Fechado. `none` é o estado de quem nunca teve rascunho. */
export const PLAN_STATUS = ["none", "draft", "published"] as const;

/**
 * Teto de tamanho do rascunho, em caracteres do JSON serializado.
 *
 * O Firestore limita um documento a 1 MiB, e o rascunho vive embutido no
 * documento do plano (v3, seção 8.1) porque é lido e gravado sempre inteiro,
 * nunca consultado por dentro. 700 mil caracteres deixam folga confortável para
 * os demais campos do documento e ainda comportam um plano de treino extenso.
 *
 * O ponto de recusar aqui: sem teto, o erro do Firestore chegaria como falha
 * genérica de gravação depois do trabalho do Coach, e a causa não seria óbvia.
 */
export const DRAFT_MAX_CHARS = 700000;

export type ResultadoValidacao =
  | { ok: true }
  | { ok: false; erro: string };

/**
 * Rótulo externo do atleta: `ATL-` mais quatro símbolos do alfabeto de 31
 * (Adendo 02, AD-04; critério CA-25). Armazenado com o prefixo.
 */
export function validarExternalLabel(valor: unknown): ResultadoValidacao {
  if (!isExternalLabel(valor)) {
    return {
      ok: false,
      erro: "externalLabel inválido. Esperado ATL- seguido de quatro símbolos sem I, L, O, 0 ou 1.",
    };
  }
  return { ok: true };
}

/** Identificador de documento do Firestore: não vazio, sem barra, sem ponto isolado. */
export function validarUid(uid: unknown): ResultadoValidacao {
  if (typeof uid !== "string" || !uid.trim()) {
    return { ok: false, erro: "athleteUid ausente ou não é texto." };
  }
  if (uid.includes("/") || uid === "." || uid === "..") {
    return { ok: false, erro: "athleteUid inválido." };
  }
  if (uid.length > 128) {
    return { ok: false, erro: "athleteUid longo demais." };
  }
  return { ok: true };
}

export function validarPlanType(valor: unknown): ResultadoValidacao {
  if (!PLAN_TYPES.includes(valor as PlanType)) {
    return {
      ok: false,
      erro: `planType inválido. Esperado um de: ${PLAN_TYPES.join(", ")}.`,
    };
  }
  return { ok: true };
}

/**
 * Valida o rascunho de plano.
 *
 * O QUE ESTA FUNÇÃO DELIBERADAMENTE NÃO FAZ: validar o conteúdo interno do
 * plano — séries, cargas, alimentos, gramas. Esse conteúdo ainda está em
 * evolução no editor, e travá-lo aqui na Fase 1 congelaria a tela contra um
 * formato que as fases seguintes vão mudar. O que se valida agora é a moldura:
 * que seja um objeto, que caiba no documento, que não seja vetor nem nulo.
 *
 * A validação de conteúdo entra na Fase 5, junto com a conversão de valores
 * numéricos de texto para número — que é correção acoplada daquela fase.
 */
export function validarRascunho(draft: unknown): ResultadoValidacao {
  if (draft === null || typeof draft !== "object" || Array.isArray(draft)) {
    return { ok: false, erro: "draft precisa ser um objeto." };
  }

  let serializado: string;
  try {
    serializado = JSON.stringify(draft);
  } catch {
    // Referência circular. Chega aqui só se o cliente montar algo que o próprio
    // JSON.stringify da tela não teria conseguido enviar — mas o servidor não
    // presume que o cliente é a tela.
    return { ok: false, erro: "draft não é serializável." };
  }

  if (serializado.length > DRAFT_MAX_CHARS) {
    return {
      ok: false,
      erro: `draft excede o limite de ${DRAFT_MAX_CHARS} caracteres.`,
    };
  }

  return { ok: true };
}

/**
 * Chave de idempotência gerada no cliente.
 *
 * A Fase 1 apenas ACEITA e REGISTRA a chave; não a usa para desduplicar ainda.
 * O uso real chega na Fase 7 (fila local de escrita sem rede), onde reenviar o
 * mesmo item não pode produzir efeito duplicado. Aceitá-la desde já é o que
 * evita reescrever o cliente e o contrato da função quando aquela fase chegar.
 *
 * Para o rascunho, a idempotência é natural: gravar duas vezes o mesmo conteúdo
 * no mesmo documento sobrescreve. A chave serve de registro de recebimento.
 */
export function validarChaveIdempotencia(chave: unknown): ResultadoValidacao {
  if (chave === undefined || chave === null) return { ok: true }; // opcional
  if (typeof chave !== "string" || !chave.trim()) {
    return { ok: false, erro: "idempotencyKey, se enviada, precisa ser texto não vazio." };
  }
  if (chave.length > 128) {
    return { ok: false, erro: "idempotencyKey longa demais." };
  }
  return { ok: true };
}
