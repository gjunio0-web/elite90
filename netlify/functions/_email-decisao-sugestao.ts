// ELITE90 PRO · _email-decisao-sugestao
// Módulo compartilhado pelas três funções de decisão sobre sugestão —
// aprovar-sugestao.ts, devolver-sugestao.ts, recusar-sugestao.ts — Adendo 07,
// AC-36 (v1.30), CA-116/CA-117.
//
// POR QUE COMPARTILHADO, E NÃO TRÊS CÓPIAS. As três funções produzem a mesma
// forma de e-mail — nome do atleta, tipo de plano, resultado, nota quando
// houver —, mudando só o resultado e se a nota é opcional. Três cópias quase
// idênticas divergiriam na primeira alteração de texto que tocasse uma e
// esquecesse as outras — o mesmo risco que o projeto já tratou ao extrair
// `_vocabulario-alimentos.ts`/`_vocabulario-exercicios.ts` para fora das
// telas de curadoria, e que `_publicacao.ts` documenta na abertura.
//
// `reviewNote` NO CORPO QUANDO EXISTIR (CA-117), NUNCA INVENTADA. Aprovação
// nunca tem nota — o parâmetro fica `null`, e o e-mail simplesmente não
// mostra a seção. Recusa pode ou não ter; devolução sempre tem, por exigência
// da própria função que a chama.

import { EMAIL_BASE_CSS, emailHeader } from "./_email-header";

export const ROTULO_PLANO = { training: "Plano de Treino", nutrition: "Plano Nutricional" } as const;

const ROTULO_RESULTADO: Record<"published" | "returned" | "rejected", string> = {
  published: "Aprovada",
  returned: "Devolvida para ajuste",
  rejected: "Recusada",
};

const COR_RESULTADO: Record<"published" | "returned" | "rejected", string> = {
  published: "#A6C300",
  returned: "#E0A93A",
  rejected: "#C0392B",
};

export function buildDecisaoSugestaoEmail(
  nomeProfissional: string,
  nomeAtleta: string,
  planType: "training" | "nutrition",
  resultado: "published" | "returned" | "rejected",
  reviewNote: string | null,
  urlPortal: string,
): string {
  const firstName = String(nomeProfissional || "").split(" ")[0] || "";
  const saudacao = firstName ? `${firstName},` : "Olá,";
  const rotuloPlano = ROTULO_PLANO[planType];
  const rotuloResultado = ROTULO_RESULTADO[resultado];
  const cor = COR_RESULTADO[resultado];

  const blocoNota = reviewNote
    ? `<div style="background:#161616;border-left:3px solid ${cor};padding:12px 16px;margin:8px 0 20px;">
         <p style="margin:0;font-size:13px;color:#999;text-transform:uppercase;letter-spacing:.04em;">Observação do Coach</p>
         <p style="margin:6px 0 0;font-size:15px;line-height:1.6;">${reviewNote}</p>
       </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<meta name="supported-color-schemes" content="dark"/>
<title>ELITE 90 PRO — ${rotuloResultado}</title>
<style>
${EMAIL_BASE_CSS}
  h1{font-size:22px;font-weight:700;color:#FFFFFF;text-transform:uppercase;letter-spacing:.04em;margin:0 0 16px;}
  p{font-size:15px;line-height:1.7;margin:0 0 16px;}
  .status{display:inline-block;color:${cor};font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:14px;
          border:1px solid ${cor};border-radius:4px;padding:4px 12px;margin:0 0 16px;}
  .btn{display:inline-block;background:#A6C300;color:#0D0D0D !important;font-weight:700;text-decoration:none;
       padding:14px 28px;border-radius:6px;text-transform:uppercase;letter-spacing:.04em;font-size:14px;margin:8px 0 8px;}
</style>
</head>
<body>
<div class="wrap">
${emailHeader("Sugestão de plano")}
  <h1>${saudacao} sua sugestão foi revisada.</h1>
  <span class="status">${rotuloResultado}</span>
  <p>${rotuloPlano} de <span style="color:#A6C300;font-weight:700;">${nomeAtleta}</span>.</p>
  ${blocoNota}
  <p><a class="btn" href="${urlPortal}">Ver na sua carteira</a></p>
</div>
</body>
</html>`;
}
