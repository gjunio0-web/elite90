// ELITE90 PRO · _email-header
// Módulo compartilhado: ÚNICA definição do cabeçalho de marca dos e-mails.
// Importado pelos CINCO modelos da plataforma:
//   submit-lead.ts       — confirmação ao candidato E aviso interno ao Coach
//   send-evaluation.ts   — envio da avaliação ao atleta
//   resend-evaluation.ts — reenvio da avaliação
//   promote-lead.ts      — boas-vindas após a promoção
// O prefixo _ impede o Netlify de tratar este arquivo como endpoint (mesma
// convenção de _mailer.ts, _firebase.ts e _scoring.ts).
//
// POR QUE ESTE MÓDULO EXISTE
// As quatro regras de estilo de base e as duas linhas de marcação do cabeçalho
// estavam copiadas nos cinco modelos, byte a byte idênticas. Toda alteração de
// marca exigia cinco edições coordenadas, e bastava esquecer uma para os
// e-mails divergirem entre si sem que nada quebrasse. É o mesmo problema que
// _firebase.ts resolveu para a inicialização do Admin SDK, e pelo mesmo
// motivo: cópia que ninguém é obrigado a sincronizar acaba divergindo.
//
// ESCOPO DELIBERADAMENTE ESTREITO
// Só entra aqui o que era IDÊNTICO nos cinco modelos. As regras h1, p, .sig e
// afins divergem entre eles (por exemplo, h1 usa #fff em send-evaluation e
// #FFFFFF em submit-lead, com letter-spacing só no segundo) e permanecem em
// cada arquivo. Unificá-las seria mudança de aparência disfarçada de
// refatoração — outra decisão, para outra hora.
//
// CONTRATO DE INDENTAÇÃO
// As cadeias abaixo já vêm com o recuo de dois espaços que tinham no lugar de
// origem, e SEM quebra de linha final. Quem interpola deve colocá-las sozinhas
// numa linha, como em:
//   <style>
//   ${EMAIL_BASE_CSS}
//     h1{...}
// Alterar o recuo muda a saída e quebra a comparação byte a byte que valida
// esta extração.

/** Regras de estilo comuns aos cinco modelos: corpo, moldura e cabeçalho. */
export const EMAIL_BASE_CSS = [
  "  body{margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Arial,sans-serif;color:#CCCCCC;}",
  "  .wrap{max-width:600px;margin:0 auto;padding:40px 24px;}",
  "  .logo{font-size:28px;font-weight:900;letter-spacing:.08em;color:#A6C300;text-transform:uppercase;margin-bottom:4px;}",
  "  .tagline{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#666;margin-bottom:40px;}",
].join("\n");

/**
 * Cabeçalho de marca do e-mail: nome e assinatura.
 *
 * A assinatura é o único trecho que varia entre os modelos — nos quatro
 * dirigidos ao atleta ela é a tradução de "Estrategista em Alta Performance";
 * no aviso interno ao Coach é "ELITE90 PRO &middot; Aviso interno". Por isso
 * entra como argumento, e não como constante.
 *
 * O valor chega como HTML já pronto (o aviso interno usa a entidade
 * `&middot;`), logo NÃO é escapado aqui — a responsabilidade de não injetar
 * conteúdo não confiável é de quem chama. Hoje todos os chamadores passam
 * texto fixo do próprio código, nunca dado vindo do usuário.
 */
export function emailHeader(tagline: string): string {
  return [
    '  <div class="logo">Coach Ruiz</div>',
    `  <div class="tagline">${tagline}</div>`,
  ].join("\n");
}
