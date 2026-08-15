// ELITE 90 PRO · _mailer
// Módulo compartilhado: ÚNICO ponto de envio de e-mail da plataforma (Resend).
// Importado por submit-lead.ts, send-evaluation.ts e resend-evaluation.ts.
// O prefixo _ impede o Netlify de tratar este arquivo como endpoint.
//
// Duas variáveis de ambiente, ambas OBRIGATÓRIAS:
//   RESEND_API_KEY — credencial da conta no Resend.
//   RESEND_FROM    — remetente exibido ao destinatário, no formato
//                    "Nome <endereco@dominio>". É o que difere entre ambientes:
//                    em homologação, o remetente da caixa de areia do Resend
//                    ("ELITE 90 PRO Testes <onboarding@resend.dev>"), que só
//                    entrega para o endereço do titular da conta; em produção,
//                    o endereço do domínio próprio, que exige o domínio
//                    verificado no Resend (registros SPF e DKIM publicados).
//
// A ausência de qualquer uma das duas RECUSA o envio — nunca é tratada como
// permissão para seguir adiante. Cada chamador decide o que fazer com a
// exceção: submit-lead apenas registra (a ficha já está gravada);
// send-evaluation e resend-evaluation devolvem erro, para que nenhum estado
// avance sem que o e-mail tenha saído.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class MailerNotConfiguredError extends Error {
  constructor(variavel: string) {
    super(`Envio de e-mail indisponível: variável ${variavel} ausente no ambiente.`);
    this.name = "MailerNotConfiguredError";
  }
}

export interface MailInput {
  /** Endereço do destinatário. */
  to: string;
  subject: string;
  /** Corpo em HTML, montado por quem chama. */
  html: string;
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
export async function sendMail({ to, subject, html }: MailInput): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new MailerNotConfiguredError("RESEND_API_KEY");

  const from = process.env.RESEND_FROM?.trim();
  if (!from) throw new MailerNotConfiguredError("RESEND_FROM");

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
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
