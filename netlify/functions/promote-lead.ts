// ELITE90 PRO · promote-lead
// Netlify Function: promove um lead do M1 (Captação & Triagem) a atleta do M2
// (Acompanhamento), por decisão explícita do Coach no painel admin.
//
// Substitui o pagamento como GATILHO da entrada no programa. A ROTINA de
// promoção é única e vive aqui; quando a FN-08 (stripe-webhook) for
// implementada, deve chamar esta mesma lógica em vez de duplicá-la.
//
// Segurança: requer Firebase ID token com custom claim admin:true — promover
// cria conta e concede permissão, então exige o mesmo nível de delete-lead.
//
// Contrato de dados: reutiliza _athlete-from-lead.js, o mesmo módulo puro que o
// runner de homologação (scripts/emulate-fn08.js) já usa. Nenhuma tradução
// paralela lead → atleta é criada aqui.
//
// FOTOS DE REFERÊNCIA (decisão de 15/08/2026): baselinePhotos recebe os MESMOS
// caminhos de fotos_paths do lead — não há cópia dos arquivos no Storage. Os
// dois documentos passam a apontar para os mesmos objetos. Por isso a exclusão
// de fichas já promovidas foi bloqueada em delete-lead.ts e em
// purge-rejected-leads.ts: apagar a ficha apagaria as fotos do atleta ativo.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { sendMail, isMailerConfigured } from "./_mailer";

// @ts-ignore — módulo CommonJS compartilhado com scripts/emulate-fn08.js
import athleteContract from "./_athlete-from-lead.js";
const { athleteFromLead } = athleteContract as any;

const FASES_VALIDAS = ["Bulking", "Cutting", "Diet Break"];

/** Valida DD/MM/AAAA e confirma que a data existe (rejeita 31/02/2026). */
function isValidBrDate(s: string): boolean {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s ?? "");
  if (!m) return false;
  const [, dd, mm, yyyy] = m;
  const d = new Date(+yyyy, +mm - 1, +dd);
  return d.getFullYear() === +yyyy && d.getMonth() + 1 === +mm && d.getDate() === +dd;
}

// NOTA (decisão de 15/08/2026): este e-mail NÃO traz link de definição de senha.
// O primeiro acesso do atleta será tratado junto com o Portal do Atleta (PRT-01).
// Por isso o texto diz que o Coach enviará os dados de acesso — e não que eles
// virão automaticamente. Não prometer o que o sistema ainda não faz.
function buildWelcomeEmail(nome: string, startDate: string): string {
  const firstName = String(nome || "").split(" ")[0];
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>ELITE 90 PRO — Bem-vindo</title>
<style>
  body{margin:0;padding:0;background:#080808;font-family:'Helvetica Neue',Arial,sans-serif;color:#CCCCCC;}
  .wrap{max-width:600px;margin:0 auto;padding:40px 24px;}
  .logo{font-size:28px;font-weight:900;letter-spacing:.08em;color:#A6C300;text-transform:uppercase;margin-bottom:4px;}
  .tagline{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#666;margin-bottom:40px;}
  h1{font-size:22px;font-weight:700;color:#FFFFFF;text-transform:uppercase;letter-spacing:.04em;margin:0 0 16px;}
  p{font-size:15px;line-height:1.7;margin:0 0 16px;}
  .highlight{color:#A6C300;font-weight:700;}
  .steps{background:#121212;border-left:3px solid #A6C300;padding:20px 24px;border-radius:0 6px 6px 0;margin:24px 0;}
  .steps p{margin:0 0 8px;font-size:14px;}
  .steps p:last-child{margin:0;}
  .sig{margin-top:40px;padding-top:24px;border-top:1px solid #1a1a1a;}
  .sig-name{font-size:16px;font-weight:700;color:#FFFFFF;text-transform:uppercase;letter-spacing:.06em;}
  .sig-title{font-size:11px;color:#A6C300;letter-spacing:.15em;text-transform:uppercase;margin-top:4px;}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">Coach Ruiz</div>
  <div class="tagline">Estrategista em Alta Performance</div>
  <h1>${firstName}, sua vaga está confirmada.</h1>
  <p>
    Você foi aprovado no <span class="highlight">Programa ELITE 90 PRO</span>.
    Seu ciclo de 90 dias começa em <span class="highlight">${startDate}</span>.
  </p>
  <div class="steps">
    <p><strong style="color:#fff;">O que acontece agora:</strong></p>
    <p>— O Coach entrará em contato com você para combinar o primeiro passo.</p>
    <p>— Seu plano de treino e de nutrição será montado a partir da sua avaliação.</p>
    <p>— A partir daí, o acompanhamento é semanal.</p>
  </div>
  <p>Qualquer dúvida, basta responder a esta mensagem.</p>
  <div class="sig">
    <div class="sig-name">Fernando Ruiz</div>
    <div class="sig-title">Coach Ruiz | ELITE 90 PRO</div>
  </div>
</div>
</body>
</html>`;
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: JSON.stringify({ error: "Não autenticado." }) };

  let caller: any;
  try {
    caller = await getAuth(app).verifyIdToken(idToken);
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: "Token inválido." }) };
  }
  if (caller.admin !== true) {
    return { statusCode: 403, body: JSON.stringify({ error: "Ação restrita ao administrador." }) };
  }

  try {
    const body = JSON.parse(event.body ?? "{}");
    const leadId: string    = String(body.leadId ?? "").trim();
    const startDate: string = String(body.startDate ?? "").trim();
    const phase: string     = String(body.phase ?? "Bulking").trim();
    const sendWelcome: boolean = body.sendWelcome !== false;

    if (!leadId) {
      return { statusCode: 400, body: JSON.stringify({ error: "leadId é obrigatório." }) };
    }
    if (!isValidBrDate(startDate)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Data de início inválida." }) };
    }
    if (!FASES_VALIDAS.includes(phase)) {
      return { statusCode: 400, body: JSON.stringify({ error: `Fase deve ser uma de: ${FASES_VALIDAS.join(", ")}.` }) };
    }

    const db = getFirestore();
    const leadRef  = db.collection("leads").doc(leadId);
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) {
      return { statusCode: 404, body: JSON.stringify({ error: "Ficha não encontrada." }) };
    }
    const lead: any = { id: leadId, ...leadSnap.data() };

    if (!lead.email) {
      return {
        statusCode: 422,
        body: JSON.stringify({ error: "A ficha não tem e-mail — não é possível criar a conta de acesso." }),
      };
    }

    // -- Guarda de idempotência --
    // Sobrescrever devolveria o atleta ao dia 1 do ciclo, apagando semana, dia
    // e peso atual já acumulados. O caso do atleta excluído depois (referência
    // órfã na ficha) segue adiante e repromove.
    if (lead.convertedAt && lead.convertedAthleteUid) {
      const existente = await db.collection("athletes").doc(lead.convertedAthleteUid).get();
      if (existente.exists) {
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: "Esta ficha já foi promovida a atleta.",
            athleteUid: lead.convertedAthleteUid,
          }),
        };
      }
    }

    // -- Conta de acesso: cria ou reaproveita a existente pelo e-mail --
    const auth = getAuth(app);
    const emailNorm = String(lead.email).trim().toLowerCase();
    let uid: string;
    try {
      uid = (await auth.getUserByEmail(emailNorm)).uid;
    } catch {
      const criada = await auth.createUser({
        email: emailNorm,
        emailVerified: false,
        displayName: String(lead.nome ?? "").trim() || undefined,
        // Senha aleatória e descartada: o primeiro acesso será definido junto
        // com o Portal do Atleta (PRT-01). Até lá, o Coach envia o acesso.
        password: `E90-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
      });
      uid = criada.uid;
    }

    // Preserva claims existentes — a conta pode já ter outro papel.
    const claimsAtuais = (await auth.getUser(uid)).customClaims ?? {};
    await auth.setCustomUserClaims(uid, { ...claimsAtuais, athlete: true });

    // -- Documento do atleta, pelo contrato compartilhado --
    const athleteDoc = athleteFromLead(lead, null, {
      uid,
      leadId,
      startDate,
      phase,
      test: lead._test === true,
    });
    // Fotos do Dia 1 = as mesmas enviadas na ficha de triagem (decisão 15/08/2026).
    athleteDoc.baselinePhotos = Array.isArray(lead.fotos_paths) ? lead.fotos_paths : [];
    athleteDoc.payment         = null;   // entrada por decisão do Coach, não por pagamento
    athleteDoc._source         = "promote-lead";
    athleteDoc.promotedBy      = caller.uid;
    athleteDoc.promotedByEmail = caller.email ?? null;

    await db.collection("athletes").doc(uid).set(athleteDoc, { merge: true });

    // -- Fecha o elo na ficha de origem --
    await leadRef.update({
      convertedAt:         FieldValue.serverTimestamp(),
      convertedAthleteUid: uid,
      convertedBy:         caller.uid,
      convertedByEmail:    caller.email ?? null,
    });

    // -- E-mail de boas-vindas (opcional, escolha do Coach no modal) --
    // Não-fatal: a promoção já aconteceu quando chegamos aqui. Falha no envio
    // é reportada ao painel, não desfaz a promoção.
    let welcomeSent = false;
    let welcomeError: string | null = null;
    if (sendWelcome) {
      if (!isMailerConfigured()) {
        welcomeError = "Envio de e-mail não configurado no ambiente.";
      } else {
        try {
          await sendMail({
            to: emailNorm,
            subject: `${String(lead.nome ?? "").split(" ")[0]}, sua vaga no ELITE 90 PRO está confirmada`,
            html: buildWelcomeEmail(lead.nome, startDate),
          });
          welcomeSent = true;
        } catch (e: any) {
          welcomeError = e?.message ?? "Falha no envio.";
          console.error("[promote-lead] E-mail não enviado (não-fatal):", welcomeError);
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, athleteUid: uid, startDate, phase, welcomeSent, welcomeError }),
    };

  } catch (err: any) {
    console.error("[promote-lead] Erro:", err?.message ?? err);
    return { statusCode: 500, body: JSON.stringify({ error: err?.message ?? "Erro interno." }) };
  }
};
