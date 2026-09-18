// ELITE90 PRO · _email-plano-republicado
// Corpo do e-mail que avisa o ATLETA de que o plano dele foi republicado
// (AC-41 · C-2, Adendo 07 v1.45).
//
// ESCOPO MÍNIMO, POR DECISÃO (CA-160)
//
// Só o aviso e o link. Sem resumo do que mudou, sem comparação com a versão
// anterior: isso é C-3, que segue fora. O e-mail não menciona se a mudança veio
// de sugestão de profissional ou de publicação direta do Coach (CA-165) — para
// o atleta, quem responde pelo plano é sempre o Coach.
//
// SEM JULGAMENTO DE RELEVÂNCIA (CA-158). Toda republicação avisa, inclusive
// correção pequena: o custo de um e-mail a mais é menor que o de o atleta
// seguir carga desatualizada sem saber.

import { EMAIL_BASE_CSS, emailHeader } from "./_email-header";

export const ROTULO_PLANO_ATLETA = {
  training: "plano de treino",
  nutrition: "plano nutricional",
} as const;

export type KindPlano = keyof typeof ROTULO_PLANO_ATLETA;

/** Assunto da mensagem. Nomeia o plano, nunca genérico (CA-161). */
export function assuntoPlanoRepublicado(kind: KindPlano): string {
  const rotulo = kind === "training" ? "Plano de treino" : "Plano nutricional";
  return `${rotulo} atualizado — ELITE 90 PRO`;
}

export function buildPlanoRepublicadoEmail(
  nomeAtleta: string | null,
  kind: KindPlano,
  url: string,
): string {
  const primeiro = String(nomeAtleta ?? "").trim().split(/\s+/)[0];
  const saudacao = primeiro ? `Olá, ${primeiro}!` : "Olá!";
  const rotulo = ROTULO_PLANO_ATLETA[kind];

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<meta name="supported-color-schemes" content="dark"/>
<title>ELITE 90 PRO — ${rotulo} atualizado</title>
<style>
${EMAIL_BASE_CSS}
  h1{font-size:22px;font-weight:700;color:#FFFFFF !important;text-transform:uppercase;letter-spacing:.04em;margin:0 0 16px;}
  p{font-size:15px;line-height:1.7;margin:0 0 16px;color:#CCCCCC !important;}
  .btn{display:inline-block;background:#A6C300;color:#0D0D0D !important;font-weight:700;text-decoration:none;
       padding:14px 28px;border-radius:6px;text-transform:uppercase;letter-spacing:.04em;font-size:14px;margin:8px 0 8px;}
  .nota{font-size:13px;color:#999999 !important;}
</style>
</head>
<body>
<div class="wrap">
${emailHeader("Atualização de protocolo")}
  <h1>${saudacao} seu ${rotulo} foi atualizado.</h1>
  <p>O Coach Ruiz publicou uma versão nova do seu ${rotulo}. Abra o link abaixo para ver o que passa a valer a partir de agora.</p>
  <p><a class="btn" href="${url}">Ver meu ${rotulo}</a></p>
  <p class="nota">É o mesmo link de sempre: ele continua funcionando e mostra sempre a versão mais recente.</p>
</div>
</body>
</html>`;
}
