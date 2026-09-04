// ELITE90 PRO · _rastreabilidade
// -----------------------------------------------------------------------------
// Registro imutável de atos de escrita. Coleção `rastreabilidade/{eventoId}`.
//
// POR QUE ISTO EXISTE (28/08/2026, especificação RASTREABILIDADE v1.1, Fase 1)
// Os campos `criadoPor`, `atualizadoPor`, `revisadoPor` e `revisadoEm` gravados
// nos próprios documentos respondem a uma pergunta de ESTADO — "qual é a
// situação deste item agora" — e são sobrescritos a cada operação. No catálogo,
// desfazer a homologação chega a zerá-los. Nada no sistema respondia à outra
// pergunta: "quem alterou isto, quando, e o que mais aconteceu no período".
// O comentário no cabeçalho de atualizar-exercicio.ts já registrava que
// responder a ela exigiria uma coleção de eventos, não um campo. É esta.
//
// APPEND-ONLY (decisão DR-06 e seção 5.3 da especificação)
// Este módulo exporta APENAS `registrar`. Não há função de edição nem de
// exclusão de evento, e nenhuma outra parte do código deve escrever na coleção
// direto. Um registro editável não é registro. A única remoção admitida é o
// expurgo por prazo de retenção (24 meses, DR-07), feito pela função agendada
// expurgar-rastreabilidade.ts — Fase 5, ainda não implementada.
//
// BEST-EFFORT, COM UMA RESSALVA (DR-06)
// Segue o padrão de _publicacao.ts: falha aqui NÃO derruba a operação que
// chamou. A gravação principal já aconteceu e já é verdadeira, e responder erro
// a uma escrita bem-sucedida seria pior. A RESSALVA é que, diferentemente do
// carimbo de publicação — reposto na gravação seguinte —, um evento perdido é
// perdido para sempre e sem sinal visível para quem opera. Por isso o log leva
// o prefixo EVENTO PERDIDO e carrega ação, origem e alvo em texto: o registro
// sobrevive ao menos no log da função. É mitigação, não solução; fila durável
// está fora de escopo por decisão da especificação (seção 1.4).
//
// O QUE NÃO ENTRA NO EVENTO (DR-04 — restrição de dados pessoais)
// É PROIBIDO gravar em `detalhe`: conteúdo de anamnese, condições médicas, uso
// de medicamentos, relato de lesão, fotografias ou URLs de fotografias, texto
// de avaliação gerada, medidas corporais, peso, e nome ou e-mail do TITULAR.
// A razão não é estética: purge-rejected-leads.ts existe para cumprir o direito
// de exclusão previsto na LGPD, e o consentimento colhido em TriageModal.astro
// promete exclusão mediante solicitação. Uma coleção que replicasse dado de
// saúde criaria segunda cópia fora do alcance do expurgo — convertendo um
// mecanismo de conformidade em violação. Permitido em `detalhe`: NOMES de
// campos alterados (nunca valores), contagens, identificadores de documento,
// transições entre valores de vocabulário fechado e critérios de filtro.
// O e-mail do OPERADOR é caso distinto (DR-09): identificação funcional de quem
// opera o sistema, que é exatamente o que este módulo existe para registrar.
//
// ARTEFATO DURÁVEL.
// -----------------------------------------------------------------------------

import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./_firebase";

const COLECAO = "rastreabilidade";

/**
 * Teto de alvos gravados num evento de lote (DR-10). Acima disso o array é
 * truncado e `alvosTotal` guarda a contagem real — sem ela, o evento sugeriria
 * que menos coisas mudaram do que de fato mudaram. O conjunto exato de um lote
 * grande continua reconstituível pelo cruzamento de `detalhe.filtro` com o
 * estado dos documentos. Pode subir sem alteração de esquema.
 */
const LIMITE_ALVOS = 50;

/**
 * Vocabulário fechado de ações (seção 7 da especificação). Declarado `as const`
 * de propósito: uma ação fora desta lista vira erro de compilação, e não string
 * livre que ninguém consegue consultar depois.
 *
 * A base afetada vai em `alvo.colecao` ('exercises' ou 'foods'), e não em oito
 * ações duplicadas por base. `lead.excluido` e `lead.expurgado` são distintas de
 * propósito — uma é ato humano deliberado, a outra é cumprimento automático de
 * política de retenção —, e colapsá-las apagaria justamente a distinção que a
 * rastreabilidade precisa preservar.
 *
 * RESERVADO PARA O M2, a acrescentar quando as fases correspondentes forem
 * implementadas: 'plano.publicado', 'checkin.registrado', 'peso.registrado',
 * 'atleta.status-alterado'. Constam aqui em comentário para que o M2 não
 * precise reabrir o vocabulário.
 */
export const ACOES = [
  "catalogo.criar",
  "catalogo.editar",
  "catalogo.revisar",
  "catalogo.desrevisar",
  "catalogo.revisar-lote",
  "catalogo.desrevisar-lote",
  "catalogo.arquivar",
  "catalogo.desarquivar",
  "lead.recebido",
  "lead.pontuado",
  "lead.excluido",
  "lead.expurgado",
  "avaliacao.enviada",
  "avaliacao.reenviada",
  "atleta.promovido",
  "plano.compartilhado",
  "base.publicada",
  // Delegação (Adendo 02, seção 7.2 — AD-10). Entram as TRÊS do ciclo de vida do
  // cadastro profissional, que são as únicas cuja função existe. As outras OITO
  // do AD-10 — sugestao.submetida, sugestao.devolvida, sugestao.recusada,
  // carteira.atribuida, carteira.encerrada, janela.ativada, janela.prorrogada e
  // janela.encerrada — ficam RESERVADAS aqui em comentário, no mesmo padrão da
  // reserva do M2 acima, até que a operação correspondente seja implementada.
  // Todas as onze já têm conteúdo especificado nas seções 7.3 e 7.4 daquele
  // adendo: ator, alvo, origem e o que pode ir em `detalhe`. Nomear a ação sem
  // dizer o que ela grava é convite a gravar valor de campo, que a regra de
  // `detalhe` proíbe por conformidade.
  "profissional.cadastrado",
  "profissional.editado",
  "profissional.desativado",
] as const;

export type Acao = (typeof ACOES)[number];

/**
 * Quem praticou o ato. Três tipos, porque três situações reais existem no
 * sistema: função autenticada (nove das doze que gravam), endpoint público
 * (submit-lead, onde o ator é o próprio candidato, ainda não identificado) e
 * rotina agendada (purge-rejected-leads, publicar-bases-pendentes).
 *
 * `email` vem do token verificado e é gravado NO MOMENTO do evento, não
 * resolvido na leitura (DR-09): preserva a identificação histórica ainda que a
 * conta seja renomeada ou removida depois. Sem ele, cada evento identificaria
 * quem agiu por um uid opaco, e ler o histórico exigiria consultar o console do
 * Firebase item a item — o que na prática significa que ninguém leria.
 *
 * Em 'publico' NÃO gravar endereço de rede nem identificador de navegador:
 * seriam dados pessoais de titular que consentiu apenas com o tratamento
 * declarado no formulário.
 */
export type Ator =
  | { tipo: "humano"; uid: string; email: string | null; papel: "admin" | "athlete" }
  | { tipo: "sistema"; processo: string }
  | { tipo: "publico" };

export type Alvo = { colecao: string; id: string };

type Base = {
  acao: Acao;
  ator: Ator;
  /** Nome do arquivo da função, sem extensão. Ex.: 'atualizar-exercicio'. */
  origem: string;
  detalhe?: Record<string, unknown>;
  resultado?: "ok" | "parcial";
  _test?: boolean;
};

/**
 * União discriminada de propósito (seção 5.1 da especificação): é o que faz o
 * invariante "`alvo` e `alvos` nunca coexistem" valer em tempo de compilação.
 * Um chamador que passe os dois não compila, e `npx tsc --noEmit` pega isso
 * antes de qualquer implantação.
 *
 * `ocorridoEm` e `ambiente` NÃO constam deste tipo: são preenchidos pelo módulo
 * e nunca aceitos do chamador. Um ator que pudesse declarar o próprio horário do
 * ato tornaria o registro inútil.
 */
export type Evento =
  | (Base & { alvo: Alvo; alvos?: never })
  | (Base & { alvos: Alvo[]; alvo?: never })
  | (Base & { alvo?: never; alvos?: never });

/**
 * Grava um evento. Chamar SEMPRE depois da gravação principal e FORA de
 * qualquer transação (DR-06): o evento descreve fato consumado, e colocá-lo na
 * mesma transação faria a operação falhar quando o registro falhasse — o que
 * registra menos que não registrar.
 */
export async function registrar(evento: Evento): Promise<void> {
  try {
    const ambiente = process.env.CONTEXT === "production" ? "producao" : "homologacao";

    const doc: Record<string, unknown> = {
      acao: evento.acao,
      ator: evento.ator,
      origem: evento.origem,
      resultado: evento.resultado ?? "ok",
      ambiente,
      ocorridoEm: FieldValue.serverTimestamp(),
    };

    if (evento.alvo) doc.alvo = evento.alvo;

    if (evento.alvos) {
      doc.alvos = evento.alvos.slice(0, LIMITE_ALVOS);
      if (evento.alvos.length > LIMITE_ALVOS) doc.alvosTotal = evento.alvos.length;
    }

    if (evento.detalhe) doc.detalhe = evento.detalhe;
    if (evento._test) doc._test = true;

    await getDb().collection(COLECAO).add(doc);
  } catch (e: any) {
    // Ver "BEST-EFFORT, COM UMA RESSALVA" no cabeçalho. O alvo entra em texto
    // para que o evento perdido seja ao menos reconstituível a partir do log.
    const alvoTexto = JSON.stringify(evento.alvo ?? evento.alvos ?? null);
    console.error(
      `[_rastreabilidade] EVENTO PERDIDO — acao="${evento.acao}" origem="${evento.origem}" alvo=${alvoTexto}:`,
      e?.stack ?? e,
    );
  }
}
