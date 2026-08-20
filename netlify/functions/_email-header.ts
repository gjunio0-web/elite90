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

import { EMBLEMA_CID, emblemaAttachment } from "./_email-emblema";

// Reexportado de propósito: quem monta o cabeçalho precisa do anexo na mesma
// mensagem. Um import só entrega as duas metades do contrato.
export { emblemaAttachment };

/** Regras de estilo comuns aos cinco modelos: corpo, moldura e cabeçalho. */
export const EMAIL_BASE_CSS = [
  "  body{margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Arial,sans-serif;color:#CCCCCC;-webkit-text-size-adjust:100%;text-size-adjust:100%;}",
  "  .wrap{max-width:600px;margin:0 auto;padding:40px 24px;}",
  "  .logo{font-size:28px;font-weight:900;letter-spacing:.08em;color:#A6C300;text-transform:uppercase;}",
  "  .tagline{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#666;}",
].join("\n");

/**
 * Cabeçalho de marca do e-mail: emblema à esquerda, nome e assinatura à
 * direita.
 *
 * CONTRATO — LEIA ANTES DE USAR
 * Quem chama esta função É OBRIGADO a enviar `emblemaAttachment()` na lista de
 * anexos da mensagem. O emblema é referenciado por "cid:", e sem o anexo
 * correspondente o leitor recebe um ícone de imagem quebrada. Por isso a
 * função de anexo é reexportada logo abaixo: um único import entrega as duas
 * metades, e fica mais difícil levar uma sem a outra.
 *
 * POR QUE A ASSINATURA FICA EM LINHA PRÓPRIA, E NÃO AO LADO DO EMBLEMA
 * Ela é o elemento MAIS LARGO do cabeçalho — mais largo que o próprio nome da
 * marca. São 32 caracteres com espaçamento de 0,2em, o que dá cerca de 281
 * pixels, contra cerca de 212 do nome. Dividindo a linha com o emblema, sobram
 * ~247 pixels num aparelho de 360, e ela quebra em duas linhas. Ocupando a
 * largura inteira logo abaixo, cabe com folga. Evidência: conferência no
 * aplicativo do Gmail em 20/08/2026, onde nome e assinatura quebravam.
 *
 * POR QUE `text-size-adjust` NO CORPO
 * Aparelhos móveis aplicam um algoritmo de inflação que AUMENTA o tamanho do
 * texto sem modificar o leiaute — o texto cresce, o contêiner não, e a quebra
 * é consequência. A propriedade desliga esse comportamento e é suportada com o
 * prefixo -webkit no aplicativo do Gmail para Android.
 *
 * O QUE FOI DELIBERADAMENTE NÃO FEITO
 * Não há `white-space:nowrap` no nome da marca. Impediria a quebra, mas se a
 * inflação escapasse do controle o texto TRANSBORDARIA em vez de quebrar — e
 * transbordar é pior que quebrar. A quebra continua sendo o comportamento de
 * reserva, de propósito.
 *
 * POR QUE TABELA, E NÃO `flex`
 * O Outlook para Windows renderiza e-mail com o motor do Word, que não
 * implementa Flexbox nem Grid. Colocar duas coisas lado a lado de forma
 * confiável em todos os clientes ainda se faz com tabela. Daí `role
 * "presentation"` — a tabela é recurso de diagramação, não dado tabular, e o
 * atributo informa isso a leitor de tela.
 *
 * DETALHES QUE PARECEM SUPÉRFLUOS E NÃO SÃO
 *  • `width`/`height` como ATRIBUTOS da imagem, além do estilo: o Outlook
 *    ignora as dimensões declaradas só em CSS e exibe a imagem no tamanho
 *    original — aqui, o dobro.
 *  • `display:block` na imagem: sem isso, vários clientes deixam uma folga
 *    embaixo, herdada do comportamento de elemento de linha.
 *  • `alt` vazio: o nome "Coach Ruiz" está escrito ao lado, em texto. Um alt
 *    com o mesmo nome faria a marca aparecer duas vezes quando as imagens
 *    estivessem bloqueadas, e o leitor de tela anunciaria duas vezes.
 *  • Linha vazia ao final da tabela: substitui o `margin-bottom` que a
 *    assinatura tinha antes. Margem dentro de célula de tabela é tratada de
 *    forma irregular pelos clientes; célula com altura declarada, não.
 *
 * A assinatura é o único trecho que varia entre os modelos — nos quatro
 * dirigidos ao atleta ela é a tradução de "Estratégia de Alta Performance";
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
    '  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">',
    "    <tr>",
    '      <td width="51" valign="middle" style="padding:0 14px 0 0;vertical-align:middle;">',
    `        <img src="cid:${EMBLEMA_CID}" width="51" height="56" alt="" border="0"`,
    '             style="display:block;width:51px;height:56px;border:0;outline:none;text-decoration:none;">',
    "      </td>",
    '      <td valign="middle" style="vertical-align:middle;">',
    '        <div class="logo">Coach Ruiz · ELITE90 PRO</div>',
    "      </td>",
    "    </tr>",
    "    <tr>",
    '      <td colspan="2" style="padding-top:4px;">',
    `        <div class="tagline">${tagline}</div>`,
    "      </td>",
    "    </tr>",
    "    <tr>",
    '      <td colspan="2" height="40" style="height:40px;line-height:40px;font-size:0;">&nbsp;</td>',
    "    </tr>",
    "  </table>",
  ].join("\n");
}
