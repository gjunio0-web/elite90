// ELITE90 PRO · _llm
// -----------------------------------------------------------------------------
// Shared model-access module — T-17 (Addendum 10 v1.4, §3.7; persistence plan
// v5.29, Phase 8, delivery 1). Thin TypeScript layer over _llm-nucleo.js: it
// reads the key from the environment, supplies the platform `fetch`, and gives
// the core its types. All behavior lives in the core, where it is tested.
//
// Every call to a language model in this project goes through `chamarModelo`.
// See _llm-nucleo.js for the guarantees: closed vocabularies of tasks and
// errors, mandatory timeout, key in the request header, never throws, no
// database writes and no events.
//
// The underscore prefix keeps Netlify from treating this file as an endpoint.
// -----------------------------------------------------------------------------

import nucleo from "./_llm-nucleo.js";

export type TarefaLlm = "triagem-ajuste" | "avaliacao-rascunho";

export type ParteLlm =
  | { texto: string }
  | { imagem: { mimeType: string; base64: string } };

export type PedidoLlm = {
  tarefa: TarefaLlm;
  /** "<task>/v<n>", declared next to the prompt text. */
  promptVersion: string;
  /** Defaults to the core's MODELO_PADRAO. */
  modelo?: string;
  partes: ParteLlm[];
  /** Structured output schema; when present, the answer is requested as JSON. */
  esquema?: Record<string, unknown>;
  temperatura: number;
  maxTokensSaida: number;
  /** Mandatory (DP-13); at most the function limit, 60 000 ms. */
  tempoLimiteMs: number;
};

export type ErroLlm =
  | "sem-chave"
  | "tempo-esgotado"
  | "http"
  | "bloqueado"
  | "fora-do-formato"
  | "vazio"
  | "pedido-invalido";

export type SucessoLlm<T> = {
  ok: true;
  valor: T;
  texto: string;
  promptVersion: string;
  modelVersion: string;
  finishReason: string | null;
  truncado: boolean;
};

export type FalhaLlm = {
  ok: false;
  erro: ErroLlm;
  promptVersion: string | null;
  /** Null when no response envelope was read. */
  modelVersion: string | null;
  /** Only for "http": where the call failed. */
  etapa?: "rede" | "status" | "envelope";
  status?: number | null;
  detalhe?: string;
  finishReason?: string | null;
  truncado?: boolean;
  /** Only for "fora-do-formato": the text the model produced. */
  textoBruto?: string;
};

export type ResultadoLlm<T> = SucessoLlm<T> | FalhaLlm;

/**
 * Timeouts per task (DP-13), below the 60 s limit of a synchronous Netlify
 * function. The margin covers what each function does around the call:
 *   · triagem-ajuste, 15 s — runs inside submit-lead, which also uploads the
 *     photos and sends two e-mails; the score is non-fatal, so a slow model
 *     must not hold the lead's arrival.
 *   · avaliacao-rascunho, 45 s — the request carries images and asks for up to
 *     4 096 output tokens; before the call the function reads the lead, three
 *     previous evaluations and downloads the photos. 15 s are left for that.
 */
export const TEMPO_LIMITE_MS: Record<TarefaLlm, number> = {
  "triagem-ajuste": 15000,
  "avaliacao-rascunho": 45000,
};

/** True when the key is configured — lets callers keep their own message order. */
export function modeloConfigurado(): boolean {
  return Boolean(process.env.GOOGLE_GEMINI_KEY);
}

export async function chamarModelo<T = unknown>(
  pedido: PedidoLlm,
  validar?: (valor: unknown) => valor is T,
): Promise<ResultadoLlm<T>> {
  return nucleo.chamarModelo(pedido, {
    chave: process.env.GOOGLE_GEMINI_KEY,
    // Resolved at call time, not at import: tests and the platform may swap it.
    fetch: (url: string, init: RequestInit) => fetch(url, init),
    validar,
  }) as Promise<ResultadoLlm<T>>;
}

export const versaoDeComandoValida: (tarefa: string, versao: unknown) => boolean = nucleo.versaoDeComandoValida;
export const versaoDeModeloValida: (versao: unknown) => boolean = nucleo.versaoDeModeloValida;

export type Procedencia = { aiDrafted: boolean; promptVersion: string | null; modelVersion: string | null };

export type LeituraProcedencia = { ok: true; valor: Procedencia } | { ok: false; erro: string };

/** Validates the draft provenance the panel sends back (DP-12); see the core. */
export function lerProcedencia(entrada: unknown, tarefa: TarefaLlm): LeituraProcedencia {
  return nucleo.lerProcedencia(entrada, tarefa) as LeituraProcedencia;
}
