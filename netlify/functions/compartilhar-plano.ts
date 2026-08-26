// ELITE90 PRO · compartilhar-plano
// Netlify Function: gera (ou renova) o link público do protocolo publicado
// de um atleta — treino ou nutricional — e monta o atalho de WhatsApp para o
// Coach enviar.
//
// ESPELHA send-evaluation.ts / resend-evaluation.ts, com UMA divergência
// deliberada (decisão do Coach, 26/08/2026): lá, reenviar uma avaliação
// expirada é recusado (410) — é o registro de decisão de um candidato, e um
// link morto força gerar outro do zero. Aqui não: o atleta é uma relação
// contínua, não um evento único, e o link nunca deveria "morrer de vez" só
// porque ninguém pediu por 90 dias. Por isso esta função NUNCA recusa por
// expiração — ela RENOVA a validade (mais 90 dias a partir de agora) e segue
// devolvendo o MESMO token, mesmo depois de expirado.
//
// TOKEN FIXO POR ATLETA E POR TIPO DE PROTOCOLO
// Treino e nutrição publicam de forma independente (ver doPublish em
// atletas.astro) — por isso cada um tem seu próprio par token/validade, nunca
// um só compartilhado pelos dois. Gerado uma única vez, na primeira chamada;
// chamadas seguintes reusam o mesmo token para sempre — republicar o
// protocolo troca o CONTEÚDO que o link mostra, nunca o link em si.
//
// SEM PLANO PUBLICADO: NÃO É RECUSADO AQUI (decisão do Coach, 26/08/2026)
// Esta função sempre gera/renova o link, contanto que o atleta exista — ela
// não sabe e não pergunta se há algo publicado. Quem decide se há conteúdo
// de verdade para mostrar é só /plano/[token].astro (estado "semPlano"), na
// hora em que o link é aberto. Motivo: a lacuna deve aparecer para quem abre
// o link, como esperado desde o início — não travar o botão de compartilhar
// no painel antes disso. A tela do painel ainda esconde o próprio botão
// enquanto nada foi publicado (ver renderPubHeader em atletas.astro), mas
// isso é só conveniência de UI; a função não depende disso para nada.

import { getAuth } from "firebase-admin/auth";
import { getApp, getDb } from "./_firebase";
import { randomBytes } from "crypto";

const COLECAO = "athletes";
const VALIDADE_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias — mesma janela da avaliação (seção 9 do repasse)

const CAMPO_TOKEN = { training: "trainingPlanToken", nutrition: "nutritionPlanToken" } as const;
const CAMPO_EXPIRA = { training: "trainingPlanTokenExpiresAt", nutrition: "nutritionPlanTokenExpiresAt" } as const;
const ROTULO = { training: "Plano de Treino", nutrition: "Plano Nutricional" } as const;

type Kind = keyof typeof CAMPO_TOKEN;

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo não é JSON válido." });
  }

  const { athleteId, kind } = corpo;
  if (!athleteId || typeof athleteId !== "string") {
    return json(400, { erro: "athleteId obrigatório." });
  }
  if (kind !== "training" && kind !== "nutrition") {
    return json(400, { erro: `kind inválido: ${String(kind)}. Aceitos: 'training', 'nutrition'.` });
  }
  const k = kind as Kind;

  try {
    const db = getDb();
    const ref = db.collection(COLECAO).doc(athleteId);
    const doc = await ref.get();
    if (!doc.exists) return json(404, { erro: "Atleta não encontrado." });

    const dados = doc.data() ?? {};

    const agora = Date.now();
    const campoToken = CAMPO_TOKEN[k];
    const campoExpira = CAMPO_EXPIRA[k];

    let token: string | undefined = dados[campoToken];
    const expiraEmMs: number = dados[campoExpira]?.toMillis?.() ?? 0;
    const precisaRenovar = !token || expiraEmMs < agora;

    if (!token) token = randomBytes(16).toString("hex");

    if (precisaRenovar) {
      await ref.update({
        [campoToken]: token,
        [campoExpira]: new Date(agora + VALIDADE_MS),
      });
    }

    const siteUrl = `${event.headers["x-forwarded-proto"] ?? "https"}://${event.headers["host"]}`;
    const url = `${siteUrl}/plano/${token}`;

    const phone: string | null = typeof dados.phone === "string" ? dados.phone : null;
    const primeiroNome = String(dados.name ?? "").trim().split(/\s+/)[0] || null;
    const mensagem = `Olá${primeiroNome ? ", " + primeiroNome : ""}! Aqui está o link do seu ${ROTULO[k]}: ${url}`;
    const whatsappUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(mensagem)}` : null;

    return json(200, { ok: true, kind: k, url, whatsappUrl, phone, renovado: precisaRenovar });
  } catch (e: any) {
    console.error("[compartilhar-plano]", e?.stack ?? e);
    return json(500, { erro: "Falha ao gerar o link do protocolo." });
  }
};
