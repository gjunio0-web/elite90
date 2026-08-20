// ELITE90 PRO · _mailer
// Módulo compartilhado: ÚNICO ponto de envio de e-mail da plataforma (Resend).
// Importado por submit-lead.ts, send-evaluation.ts, resend-evaluation.ts e
// promote-lead.ts. O prefixo _ impede o Netlify de tratar este arquivo como
// endpoint.
//
// Duas variáveis de ambiente, ambas OBRIGATÓRIAS:
//   RESEND_API_KEY — credencial da conta no Resend.
//   RESEND_FROM    — remetente exibido ao destinatário, no formato
//                    "Nome <endereco@dominio>". É o que difere entre ambientes:
//                    em homologação, o remetente da caixa de areia do Resend
//                    ("ELITE90 PRO Testes <onboarding@resend.dev>"), que só
//                    entrega para o endereço do titular da conta; em produção,
//                    o endereço do domínio próprio, que exige o domínio
//                    verificado no Resend (registros SPF e DKIM publicados).
//
// A ausência de qualquer uma das duas RECUSA o envio — nunca é tratada como
// permissão para seguir adiante. Cada chamador decide o que fazer com a
// exceção: submit-lead apenas registra (a ficha já está gravada);
// send-evaluation e resend-evaluation devolvem erro, para que nenhum estado
// avance sem que o e-mail tenha saído.
//
// ANEXOS
// Opcionais. Servem tanto para arquivo comum quanto para imagem embutida no
// corpo: basta dar um contentId ao anexo e referenciá-lo no HTML como
// <img src="cid:o-mesmo-identificador">. É assim que uma imagem aparece sem
// depender da autorização do leitor para carregar imagem remota.
//
// Três restrições documentadas pelo Resend que valem registrar aqui:
//   • o conteúdo viaja em base64 (é o formato que a API espera em `content`);
//   • convém informar contentType ou filename, para o cliente de e-mail saber
//     como renderizar o anexo;
//   • anexos NÃO funcionam no endpoint de envio em lote. Esta plataforma não
//     o usa — todo envio aqui é individual —, mas a limitação existe.
//
// Quando nenhum anexo é passado, o corpo da requisição sai exatamente igual ao
// que saía antes de os anexos existirem: a chave sequer é incluída.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class MailerNotConfiguredError extends Error {
  constructor(variavel: string) {
    super(`Envio de e-mail indisponível: variável ${variavel} ausente no ambiente.`);
    this.name = "MailerNotConfiguredError";
  }
}

/**
 * Anexo de uma mensagem. Também é o mecanismo de imagem embutida: com
 * contentId preenchido, o HTML referencia o anexo por "cid:<contentId>".
 */
export interface MailAttachment {
  /** Conteúdo do arquivo já codificado em base64, sem o prefixo de data URI. */
  content: string;
  /** Nome do arquivo, ex.: "logo.png". */
  filename: string;
  /** Tipo MIME, ex.: "image/png". Ajuda o cliente a renderizar corretamente. */
  contentType?: string;
  /**
   * Identificador da imagem embutida. Cadeia arbitrária de menos de 128
   * caracteres, escolhida por quem envia, que precisa ser exatamente a mesma
   * usada no HTML depois de "cid:". Ausente = anexo comum, não embutido.
   */
  contentId?: string;
}

export interface MailInput {
  /** Endereço do destinatário. */
  to: string;
  subject: string;
  /** Corpo em HTML, montado por quem chama. */
  html: string;
  /** Anexos opcionais. Lista vazia equivale a não passar nada. */
  attachments?: MailAttachment[];
}

export interface MailResult {
  /** Identificador da mensagem no Resend — null se a resposta não o trouxer. */
  id: string | null;
}

/** Informa se o ambiente tem a configuração mínima, sem tentar enviar. */
export function isMailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM?.trim());
}

/**
 * Envia uma mensagem pelo Resend.
 * Lança MailerNotConfiguredError se faltar configuração e Error se a API
 * recusar a mensagem. Só retorna quando o provedor aceitou o envio.
 */
export async function sendMail({ to, subject, html, attachments }: MailInput): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new MailerNotConfiguredError("RESEND_API_KEY");

  const from = process.env.RESEND_FROM?.trim();
  if (!from) throw new MailerNotConfiguredError("RESEND_FROM");

  const payload: Record<string, unknown> = { from, to: [to], subject, html };

  // A chave só entra quando há anexo de verdade. Sem esta guarda, um envio sem
  // anexo passaria a mandar "attachments": [] — corpo diferente do que a
  // plataforma sempre mandou, e mudança que não teria por que existir.
  //
  // A tradução de nome é necessária, não estética: esta função fala com o
  // endpoint REST do Resend, que nomeia os campos com sublinhado
  // (content_type, content_id). O formato com maiúscula intermediária existe
  // nos SDKs, não na API. Escrever contentId direto no corpo faria a API
  // ignorar o campo em silêncio, e a imagem chegaria como anexo comum em vez
  // de embutida — falha que não levanta erro nenhum.
  if (attachments && attachments.length > 0) {
    payload.attachments = attachments.map((a) => {
      const anexo: Record<string, unknown> = { content: a.content, filename: a.filename };
      if (a.contentType) anexo.content_type = a.contentType;
      if (a.contentId) anexo.content_id = a.contentId;
      return anexo;
    });
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detalhe = `status ${res.status}`;
    try {
      const erro = (await res.json()) as any;
      detalhe = erro?.message ?? detalhe;
    } catch {
      detalhe = (await res.text()) || detalhe;
    }
    throw new Error(`Falha no envio de e-mail (${res.status}): ${detalhe}`);
  }

  let id: string | null = null;
  try {
    const dados = (await res.json()) as any;
    id = typeof dados?.id === "string" ? dados.id : null;
  } catch {
    // Resposta aceita porém sem corpo legível: o envio vale, o rastro se perde.
  }

  return { id };
}
