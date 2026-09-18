// ELITE90 PRO · _link-plano
// Módulo compartilhado: o endereço público do protocolo de um atleta.
//
// POR QUE EXISTE
//
// `compartilhar-plano.ts` já sabia gerar e renovar esse link, mas como
// endpoint: só o Coach, clicando. A AC-41 (C-2) precisa do MESMO link dentro
// de `publicar-plano-direto.ts` e `aprovar-sugestao.ts`, para mandar ao atleta
// por e-mail. Duplicar a lógica criaria duas fontes do mesmo token, e a
// primeira divergência entre elas seria um link que abre plano de outro tipo.
//
// O CONTRATO, COMO JÁ ERA
//
// Um par token/validade por atleta e por tipo de plano. O token NUNCA muda:
// expirado, a validade é renovada por mais 90 dias e o mesmo token segue
// valendo. Republicar troca o CONTEÚDO que o link mostra, jamais o link.

import { randomBytes } from "crypto";
import type { Firestore } from "firebase-admin/firestore";

export const COLECAO_ATLETAS = "athletes";
export const VALIDADE_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias

export const CAMPO_TOKEN = { training: "trainingPlanToken", nutrition: "nutritionPlanToken" } as const;
export const CAMPO_EXPIRA = { training: "trainingPlanTokenExpiresAt", nutrition: "nutritionPlanTokenExpiresAt" } as const;
export const ROTULO_PLANO_PUBLICO = { training: "Plano de Treino", nutrition: "Plano Nutricional" } as const;

export type KindPlano = keyof typeof CAMPO_TOKEN;

export interface LinkPlano {
  token: string;
  url: string;
  /** true quando a validade precisou ser estendida nesta chamada. */
  renovado: boolean;
}

/**
 * Devolve o link público do plano, criando o token na primeira vez e
 * renovando a validade quando vencida. `dados` evita uma leitura a mais quando
 * quem chama já tem o documento do atleta em mãos.
 */
export async function garantirLinkPlano(
  db: Firestore,
  athleteId: string,
  kind: KindPlano,
  siteUrl: string,
  dados?: Record<string, any>,
): Promise<LinkPlano> {
  const ref = db.collection(COLECAO_ATLETAS).doc(athleteId);
  let doc = dados;
  if (!doc) {
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Atleta não encontrado: " + athleteId);
    doc = snap.data() ?? {};
  }

  const agora = Date.now();
  const campoToken = CAMPO_TOKEN[kind];
  const campoExpira = CAMPO_EXPIRA[kind];

  let token: string | undefined = doc[campoToken];
  const expiraEmMs: number = doc[campoExpira]?.toMillis?.() ?? 0;
  const renovado = !token || expiraEmMs < agora;

  if (!token) token = randomBytes(16).toString("hex");
  if (renovado) {
    await ref.update({ [campoToken]: token, [campoExpira]: new Date(agora + VALIDADE_MS) });
  }

  return { token, url: `${siteUrl}/plano/${token}`, renovado };
}

/** Endereço do site a partir dos cabeçalhos da requisição Netlify. */
export function siteUrlDoEvento(event: any): string {
  const proto = event?.headers?.["x-forwarded-proto"] ?? "https";
  return `${proto}://${event?.headers?.["host"]}`;
}
