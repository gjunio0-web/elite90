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
// ESCOPO ATUAL: o rascunho de plano (Fase 1 do plano de persistência), o
// rótulo externo do atleta (Fase 2, Adendo 02 — Delegação) e o cadastro
// profissional com a carteira de atribuições (Fase 4-B, Adendo 02, seções 4.1
// e 4.2). As demais estruturas do M2 — check-in, série de peso, avaliação
// física, relatório — entram aqui quando as fases correspondentes forem
// implementadas.
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

// ─────────────────────────────────────────────────────────────────────────────
// FASE 4-B · CADASTRO PROFISSIONAL E CARTEIRA DE ATRIBUIÇÕES
// Adendo 02 — Delegação, seções 4.1 (`professionals`) e 4.2 (`assignments`).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conselho profissional. Fechado (Adendo 02, seção 4.1).
 *
 * `council` e `councilNumber` são campos separados de propósito: o rodapé de
 * responsabilidade técnica (D-07 do documento de casos de uso) compõe
 * "CREF 122761" a partir das partes. Campo único de texto livre tornaria
 * impossível validar o formato ou trocar a apresentação depois.
 */
export const COUNCILS = ["CRN", "CREF", "CRM"] as const;
export type Council = (typeof COUNCILS)[number];

/**
 * Classificação do profissional. Fechado (Adendo 02, seção 4.1).
 * Determina o nível de escopo da projeção de leitura (D-04) e se o delegado
 * enxerga o nome do atleta ou o rótulo externo (D-14).
 */
export const CLASSIFICATIONS = ["internal", "external"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/**
 * Especialidade do profissional e da atribuição de carteira. Fechado.
 *
 * POR QUE NÃO REUSAR `PLAN_TYPES`, que hoje tem os mesmos dois valores: são
 * vocabulários de coisas diferentes — um diz que tipo de plano um documento é,
 * o outro diz por qual matéria um profissional responde. Derivar um do outro
 * faria com que acrescentar um tipo de plano criasse, em silêncio, uma
 * especialidade que ninguém decidiu.
 */
export const SPECIALTIES = ["training", "nutrition"] as const;
export type Specialty = (typeof SPECIALTIES)[number];

/**
 * Motivo de encerramento de uma atribuição de carteira. Fechado
 * (Adendo 02, seção 4.2).
 */
export const ASSIGNMENT_ENDED_REASONS = [
  "replaced",
  "professional_exit",
  "cycle_closed",
] as const;
export type AssignmentEndedReason = (typeof ASSIGNMENT_ENDED_REASONS)[number];

/** Tetos de tamanho dos campos de texto do cadastro. */
export const PROFESSIONAL_NAME_MAX_CHARS = 120;
export const PROFESSIONAL_EMAIL_MAX_CHARS = 254;
export const COUNCIL_NUMBER_MAX_CHARS = 32;

/**
 * Carga aceita para o cadastro do profissional.
 *
 * `active` não entra aqui: quem cadastra cria ativo, e a desativação é operação
 * própria. Aceitar o campo na criação abriria caminho para nascer inativo, que
 * não é estado que sirva a nada.
 */
export type CargaProfissional = {
  name: string;
  email: string;
  phone: string | null;
  council: Council;
  councilNumber: string;
  councilState: string | null;
  classification: Classification;
  specialties: Specialty[];
};

function textoObrigatorio(
  valor: unknown,
  campo: string,
  limite: number,
): ResultadoValidacao {
  if (typeof valor !== "string" || !valor.trim()) {
    return { ok: false, erro: `${campo} ausente ou não é texto.` };
  }
  if (valor.length > limite) {
    return { ok: false, erro: `${campo} excede ${limite} caracteres.` };
  }
  return { ok: true };
}

function textoOpcional(
  valor: unknown,
  campo: string,
  limite: number,
): ResultadoValidacao {
  if (valor === undefined || valor === null) return { ok: true };
  return textoObrigatorio(valor, campo, limite);
}

/**
 * Valida a carga do cadastro profissional.
 *
 * O QUE ESTA FUNÇÃO DELIBERADAMENTE NÃO FAZ: conferir que o número de registro
 * existe no conselho. Não há fonte consultável para isso, e inventar formato
 * recusaria registros legítimos — o Adendo 02 determina que o número é gravado
 * "como o profissional o declara", e string justamente porque carrega zeros à
 * esquerda, barras e sufixos de registro de qualificação.
 *
 * A unicidade do endereço de correio também não é decidida aqui: é guarda de
 * banco, não de forma, e depende de leitura da coleção.
 */
export function validarProfissional(carga: unknown): ResultadoValidacao {
  if (carga === null || typeof carga !== "object" || Array.isArray(carga)) {
    return { ok: false, erro: "Cadastro precisa ser um objeto." };
  }
  const c = carga as Record<string, unknown>;

  for (const v of [
    textoObrigatorio(c.name, "name", PROFESSIONAL_NAME_MAX_CHARS),
    textoObrigatorio(c.email, "email", PROFESSIONAL_EMAIL_MAX_CHARS),
    textoObrigatorio(c.councilNumber, "councilNumber", COUNCIL_NUMBER_MAX_CHARS),
    textoOpcional(c.phone, "phone", 32),
    textoOpcional(c.councilState, "councilState", 2),
  ]) {
    if (!v.ok) return v;
  }

  // Forma mínima do endereço: um arroba, com texto dos dois lados e um ponto à
  // direita. Não se pretende validar endereço de correio por expressão — o que
  // se recusa aqui é o que claramente não é endereço.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c.email))) {
    return { ok: false, erro: "email inválido." };
  }

  if (!COUNCILS.includes(c.council as Council)) {
    return { ok: false, erro: `council inválido. Esperado um de: ${COUNCILS.join(", ")}.` };
  }

  if (!CLASSIFICATIONS.includes(c.classification as Classification)) {
    return {
      ok: false,
      erro: `classification inválida. Esperado um de: ${CLASSIFICATIONS.join(", ")}.`,
    };
  }

  const especialidades = c.specialties;
  if (!Array.isArray(especialidades) || especialidades.length === 0) {
    return { ok: false, erro: "specialties precisa ser um vetor com ao menos um item." };
  }
  if (especialidades.length > SPECIALTIES.length) {
    return { ok: false, erro: "specialties tem mais itens do que o vocabulário admite." };
  }
  const vistas = new Set<string>();
  for (const item of especialidades) {
    if (!SPECIALTIES.includes(item as Specialty)) {
      return {
        ok: false,
        erro: `specialty inválida. Esperado um de: ${SPECIALTIES.join(", ")}.`,
      };
    }
    if (vistas.has(item as string)) {
      return { ok: false, erro: "specialties tem item repetido." };
    }
    vistas.add(item as string);
  }

  return { ok: true };
}

/** Especialidade isolada — usada pela atribuição de carteira. */
export function validarSpecialty(valor: unknown): ResultadoValidacao {
  if (!SPECIALTIES.includes(valor as Specialty)) {
    return {
      ok: false,
      erro: `specialty inválida. Esperado um de: ${SPECIALTIES.join(", ")}.`,
    };
  }
  return { ok: true };
}

/**
 * Identificador de documento gerado pelo banco — `professionalId`,
 * `assignmentId`. Mesma forma de `validarUid`, com o nome do campo na mensagem,
 * porque devolver "athleteUid inválido" para um erro de professionalId manda
 * quem depura para o lugar errado.
 */
export function validarIdDocumento(valor: unknown, campo: string): ResultadoValidacao {
  if (typeof valor !== "string" || !valor.trim()) {
    return { ok: false, erro: `${campo} ausente ou não é texto.` };
  }
  if (valor.includes("/") || valor === "." || valor === "..") {
    return { ok: false, erro: `${campo} inválido.` };
  }
  if (valor.length > 128) {
    return { ok: false, erro: `${campo} longo demais.` };
  }
  return { ok: true };
}

/** Motivo de encerramento da atribuição. */
export function validarMotivoEncerramento(valor: unknown): ResultadoValidacao {
  if (!ASSIGNMENT_ENDED_REASONS.includes(valor as AssignmentEndedReason)) {
    return {
      ok: false,
      erro: `endedReason inválido. Esperado um de: ${ASSIGNMENT_ENDED_REASONS.join(", ")}.`,
    };
  }
  return { ok: true };
}
