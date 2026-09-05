// ELITE90 PRO · _projecao-atleta
// Módulo compartilhado da projeção de dados de atleta para delegado.
// Adendo 02 — Delegação, seções 6.2 e 6.3, decisão AD-06.
//
// POR QUE ESTE MÓDULO EXISTE
//
// `athletes/{uid}` reúne os três níveis de escopo num único documento, e regras
// de banco operam por documento, não por campo. Não há como liberar ao delegado
// a altura do atleta e reter o dado de pagamento pelas regras: ou o documento
// inteiro é legível, ou nada é. Por isso a AD-06 decide que NENHUMA leitura de
// dado de atleta pelo delegado é direta — passa por servidor, que devolve
// apenas os campos do nível autorizado.
//
// Isso não exige alterar `firestore.rules`, e não altera: elas continuam negando
// tudo, e é o SDK administrativo que lê.
//
// LISTA DE PERMITIDOS, NUNCA LISTA DE PROIBIDOS
//
// A escolha é da seção 6.3, e o motivo está na CA-07: um campo novo no documento
// do atleta, sem alteração deste arquivo, NÃO aparece em projeção nenhuma. Com
// lista de proibidos, o mesmo campo novo vazaria por omissão — e vazaria em
// silêncio, que é o pior modo de vazar.
//
// Os campos abaixo são transcritos da tabela da seção 6.3. Acrescentar um item
// aqui é decisão de especificação, não de implementação.

import { Timestamp } from "firebase-admin/firestore";

/** Nível 1: delegado externo e interno. Nível 2: delegado interno e Substituto. */
export type NivelProjecao = 1 | 2;

/**
 * Nível 1 — o que o delegado externo enxerga do documento do atleta.
 *
 * `genero` está em português de propósito: exceção ao princípio de chaves em
 * inglês, declarada pelo Adendo 04 e registrada como DV-5 no Adendo 02. Nenhuma
 * projeção devolve `gender` (CA-27).
 */
const CAMPOS_NIVEL_1 = [
  "heightCm",
  "birthDate",
  "goal",
  "trainingYears",
  "weeklyFrequency",
  "dailyMinutes",
  "flags",
  "startDate",
  "phase",
  "weightInitialKg",
  "weightCurrentKg",
  "genero",
] as const;

/** Nível 2 — acrescenta identificação real. Nunca vai para delegado externo. */
const CAMPOS_NIVEL_2_EXTRA = ["name", "email", "phone", "baselinePhotos"] as const;

/**
 * As três subcoleções do Nível 1. Declaradas aqui porque a lista de permitidos
 * é deste arquivo, e não do chamador.
 *
 * ESTA FASE NÃO AS BUSCA. A tela restrita, no seu primeiro bloco, lista atletas
 * e não abre histórico. Deixá-las nomeadas evita que quem for buscá-las adiante
 * invente uma segunda lista noutro lugar.
 */
export const SUBCOLECOES_NIVEL_1 = ["weights", "checkins", "evaluations"] as const;

/**
 * Campos que NUNCA vão a delegado, em nível nenhum. Esta constante é redundante
 * por construção — o que não está nas duas listas acima já não sai —, e existe
 * como declaração legível de intenção, para que a CA-05 possa ser lida por
 * quem revisa sem reconstituir a lógica de exclusão. NÃO é usada para filtrar.
 */
export const NUNCA_PROJETADOS = [
  "payment",
  "originLeadId",
  "evaluationToken",
  "promotedBy",
  "promotedByEmail",
  "_source",
] as const;

/**
 * O nível decorre da classificação do profissional, e de nada mais.
 * `internal` → 2; `external` → 1. Valor desconhecido cai no MENOR nível.
 */
export function nivelPara(classification: unknown): NivelProjecao {
  return classification === "internal" ? 2 : 1;
}

export type AtletaProjetado = Record<string, unknown> & { uid: string };

function normalizar(v: unknown): unknown {
  // Timestamp vira texto ISO: o cliente não recebe objeto de servidor, e a
  // serialização deixa de depender de como o SDK o representa hoje.
  if (v instanceof Timestamp) return v.toDate().toISOString();
  return v === undefined ? null : v;
}

/**
 * Projeta um documento de atleta já lido.
 *
 * A SUBSTITUIÇÃO DO NOME PELO RÓTULO (D-14). No Nível 1 a projeção não devolve
 * `name` e devolve `externalLabel`; no Nível 2, o inverso — `name` sai e
 * `externalLabel` NÃO sai (CA-06). Não é uma escolha de apresentação: é o que
 * impede que um delegado externo associe o plano a uma pessoa identificável.
 *
 * Recebe o documento já lido, e não o identificador, para que o chamador decida
 * como e quando ler — inclusive dentro de transação, se um dia precisar. Mesmo
 * arranjo de `_profissional-ativo.ts`.
 */
export function projetarAtleta(
  uid: string,
  dados: Record<string, any>,
  nivel: NivelProjecao,
): AtletaProjetado {
  const saida: AtletaProjetado = { uid };

  for (const campo of CAMPOS_NIVEL_1) {
    saida[campo] = normalizar(dados[campo]);
  }

  if (nivel === 2) {
    for (const campo of CAMPOS_NIVEL_2_EXTRA) {
      saida[campo] = normalizar(dados[campo]);
    }
  } else {
    saida.externalLabel = normalizar(dados.externalLabel);
  }

  return saida;
}
