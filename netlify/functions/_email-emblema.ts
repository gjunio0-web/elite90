// ELITE90 PRO · _email-emblema
// Módulo compartilhado: o emblema da marca embutido nos e-mails, como anexo
// referenciado por Content-ID. Importado pelo cabeçalho dos e-mails
// (_email-header.ts). O prefixo _ impede o Netlify de tratar este arquivo como
// endpoint.
//
// POR QUE ANEXO, E NÃO IMAGEM REMOTA
// Imagem remota costuma ficar bloqueada até o leitor autorizar o carregamento,
// e o emblema simplesmente não apareceria na primeira abertura. Anexo embutido
// viaja dentro da própria mensagem. A alternativa de endereço remoto foi
// descartada por outro motivo também: o Resend precisaria baixar a imagem no
// momento do envio, e uma falha nesse download poderia derrubar o envio
// inteiro — um atleta ficaria sem a avaliação porque um logotipo não baixou.
//
// POR QUE PNG, E NÃO O WEBP QUE O SITE USA
// O Outlook para Windows não renderiza WebP (usa o motor do Word, não um
// navegador) e o Gmail converte WebP em JPEG, o que destrói a transparência.
// PNG funciona nos três clientes que importam aqui. O site continua com WebP,
// onde ele funciona e pesa um terço.
//
// POR QUE 102 × 112 PIXELS
// A exibição é 51 × 56, mas cliente de e-mail ignora `srcset`: só é possível
// entregar UM arquivo. Entregar o dobro da resolução e declarar o tamanho
// menor nos atributos width/height é o que mantém o emblema nítido em tela de
// alta densidade, que é a maioria dos celulares.
//
// FUNDO TRANSPARENTE, DE PROPÓSITO
// Alguns clientes forçam fundo claro. Com fundo chapado escuro, o emblema
// viraria um retângulo preto sobre branco. Transparente, ele se lê nos dois.
//
// PROCEDÊNCIA E CONFERÊNCIA
// Extraído de apps/site/public/images/brand/logo-hero.webp, recorte
// (258, 97) a (976, 884) — o mesmo recorte do emblema em WebP usado na ficha
// de avaliação e nos documentos do atleta —, redimensionado para 102 × 112 com
// reamostragem Lanczos e gravado em PNG sem perdas.
//
// O conteúdo abaixo tem 23.723 bytes depois de decodificado, com resumo
// criptográfico SHA-256:
//   c3840a2d38cb4e236debd255f13c7e4d7be01f84e9d2a2f9746dd216d1923d8f
// Para conferir, em Node:
//   crypto.createHash("sha256")
//     .update(Buffer.from(EMBLEMA_BASE64, "base64")).digest("hex")
//
// A cadeia está quebrada em linhas de 96 caracteres para o arquivo continuar
// revisável em diff e em editor. A concatenação é resolvida em tempo de
// compilação, sem custo em execução.

import type { MailAttachment } from "./_mailer";

/**
 * Identificador da imagem embutida. Precisa ser exatamente igual ao que
 * aparece no HTML depois de "cid:". Alterar aqui sem alterar lá faz o emblema
 * chegar como anexo comum, em silêncio — sem erro e sem aviso.
 */
export const EMBLEMA_CID = "emblema-coach-ruiz";

/** Nome do arquivo exibido caso o cliente também liste o anexo. */
export const EMBLEMA_FILENAME = "coach-ruiz.png";

/** Tipo MIME. O Resend recomenda informá-lo para o cliente renderizar certo. */
export const EMBLEMA_CONTENT_TYPE = "image/png";

/** O PNG do emblema, codificado em base64, sem prefixo de data URI. */
export const EMBLEMA_BASE64 =
  "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" +
  "y3Q4cfw4t99+OxvHNjI0OMQXvvBFYvEkt9x+G1NTVxm/OMHQYL9cN9gfWbZzSCl94TOf+cy5typTe6uBEYcPHxZTU1PO8Oi6" +
  "b0RhMOR5njp67LghELz9vnvp7unm5gM38+KLL7G4tMjQ4BBf/epXOXzP26jV6jz++SeW8vniRSmtOhi+YRoiCkKdTCbDu+66" +
  "o33jxmEjDD08t0EinsA0TTZsWE+9VmNhYZEtmzdz6623gm66/EQ8wejoKJVKhY9/7KP86PveD1rz+pnTRH6EYVhoHWlDmiKf" +
  "z/PG66cZGRll9549fPUrX6Wru5uvfPUrGKbFz33iE3R2thP5HrNzC0xPz4p9+/aInu4uMunM/a+9/sYXTp8+nXsrkoG3FJhD" +
  "hw6Zf/RHfxTddNPeXzKk+nAQeuHk5BUzny/wvve9D9/z+dM//TO6e7p5//vfx8kTJ5mevqofevj9YvzSpH7mW8+Oa80107Qi" +
  "pXTFMKUfBl4wNNTf95GPPDK0Z99O4+rVy6yt5ekf6Cf0Q8qVCsPDQxSLRYqFAjt37uSO2++gUCwQ+QFXJia59Y7bGBgYwHM9" +
  "uro6uPe+wwytG+T06TMUC3ltmhYq0hiGSRiG4uzZM2SyGe655x6+9tWvkogn+LVf/zWOHHmeJ//8C9xzzz24rsf0zCyFfEEM" +
  "DKxT3V2dcdMwd5+/cOGPH3/8cfHEE0/80DTK5JEjR6LNm3futh3zX7Z1tCnPC40L5ye47dbb2bBhI1/+8lfo7eslCiPW1tYY" +
  "HFrH+97/I+LEidfVSy8dvSCEnBUYHpA3TcMLAz+3Z9f25I995EP9G9YPi4lLF6nXamzbthXLNDEtk8D3KZUqRBrsWBzbiRGE" +
  "igvnL+K6HolkipdfeJFquYLSMD01wwtHXuTjH/4wn/nDP2D79q2EQYBhmiiltBAoKSXPfvs5Ll4c52d/9h9h2zYXLpxHoKhU" +
  "Khw58hxvf/u9DA2t4+Rrb3D6zGmjrT0T3nvfvYc2b978Cx985JHo4Ycflj8UwIyMjNhCCLFhrP+X4nErkUzE9aWL40Ipzfnz" +
  "FygWi/zkT/4E9XqdqelpvvKVpxhdP6jPnr0QHH/11EkpzSUh8KUhl62YXQ0Cr7B9++bUA+9+x87BkXWMj1/S5WKJQ7cfZnjd" +
  "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" +
  "URD4tXyhoKSU6EhjSMlAby+NWgPP9di5a5toeC4LK8vStM2M1jrTjC3YpmmmIq27QqU6m+5RGMViWWstaWtrI9uRJdKaXC5P" +
  "pVKnVq8Dis2bttPd1UuhVCRSmnQq0xKaN8Xibe3tVCou5y5ewok5bNywgc72Dq5cvszKygp33nkn3d1dJLNpxq9c44//7HGO" +
  "HT9BKpMm29ZGOpNBKU0QhgRhAALi8QS23YwzSimiMEQIQW9PP2EYcerUa5RKBbLZFOvXjxGEEWEY6VKpxMpanmrFDX+QMea6" +
  "pQStzyJUUdho1INiseSY0sT3fUINZ85dYN3QIDu272B84rIOlJbxeLxPa7ffMIy81joJJKUQ6QjaQMQBEXie4XsNMpl2LKPJ" +
  "VU3NzJJbK9LWlmbzlg3E43FC3yeTTLFUrpBbyRF3YjhOglKpxOXLVxgcWsf69evp6OhEmgbTU1Mkk0nuve9ejh8/zrVr07z8" +
  "8lHeOHMOPwi4ef9e2to6WV5ZYXFpCdNsxqwgaN7PkeF+cms5PM9DSollNmON63lorZiemqFUKlBvuNy0/ybKlQrt7VkKpSJ1" +
  "341CW/iENxREPwBX9ma6J4SwwiCMoaHRaGCYBp7nE4UhAwMD1Gp1Xnz5JSToyxOTolAoDQIXHMdxlFKWNM24wDAIldQoIYQQ" +
  "WiP8wCUIAsrlOul0Finm8HyX5WWXtbWCnro2L3Zs38rw0DqiMMK0jFbGZJPJZLBsk3q9jJTQ3d3F1PQUHR0d9PX28+STT/Hk" +
  "X/wFE5NXm+5CSoQQbNm+HcMwmJuZJZ/L4YUByXgcQ5jU6zUq1QqWaRFFChVFKK3wfZcjR55jYF03b3/H3SyvFtFIQj9AR4qO" +
  "jg6iKKJcLvtBPWj8IC1Gtj5ERCQEwkBjuZ5LT08PVkubNTMzQzyRILe6ih+EJJJx0dPdw/rR0QPT03OlpaWlecuyFGBHKpJS" +
  "CEMLKTTClFIIQ9pcujSOjhRbNm9manqGSqWCEIYOw0jPzs4xOzunuzo7xObNG0Vfbz8LS3MUimuk02n6+/sIgggpJH4Ykcm2" +
  "c/TYcfXskRfVxOUrGjCFFEIiUFohDQPbtlhZXaGnp5vID3CkiSGaoAGUy2V6e3vRgFIhN+3bQ1dXJ8XiGoiIkdENnLvwNYTW" +
  "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";

/**
 * Devolve o emblema no formato de anexo aceito pelo _mailer.
 * Quem chama junta este anexo aos demais que a mensagem porventura tenha.
 */
export function emblemaAttachment(): MailAttachment {
  return {
    content: EMBLEMA_BASE64,
    filename: EMBLEMA_FILENAME,
    contentType: EMBLEMA_CONTENT_TYPE,
    contentId: EMBLEMA_CID,
  };
}
