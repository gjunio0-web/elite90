// --- ELITE 90 · purge-rejected-leads
// Netlify Scheduled Function: rotina de retenção de dados (LGPD, Art. 16).
//
// Política definida pelo controlador (Elite 90 / Coach Ruiz):
//   Leads com status "recusado" são eliminados permanentemente 90 dias
//   após a última atualização de status (campo "updatedAt").
//
// Execução: diária, às 03:00 (horário do servidor Netlify, UTC).
// Configuração do agendamento: ver netlify.toml ([[functions]] schedule).

import { schedule } from "@netlify/functions";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const RETENTION_DAYS = 90;

function getDb() {
  if (!getApps().length) {
    let saEnv: string = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "{}").trim();
    let serviceAccount: any = null;

    try {
      if (saEnv.startsWith('"') && saEnv.endsWith('"')) saEnv = saEnv.slice(1, -1);
      if (saEnv.startsWith("'") && saEnv.endsWith("'")) saEnv = saEnv.slice(1, -1);

      try {
        serviceAccount = JSON.parse(saEnv);
      } catch {
        serviceAccount = JSON.parse(saEnv.replace(/\\"/g, '"'));
      }

      if (serviceAccount?.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
      }
    } catch (e: any) {
      console.error("FALHA CRÍTICA (purge-rejected-leads): FIREBASE_SERVICE_ACCOUNT_JSON inválido.");
      throw new Error(`Erro no parse das credenciais do Firebase: ${e.message}`);
    }

    if (!serviceAccount?.private_key) {
      throw new Error("Credenciais do Firebase ausentes ou incompletas.");
    }

    initializeApp({ credential: cert(serviceAccount as any) });
  }
  return getFirestore();
}

const handlerFn = async () => {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffTs = Timestamp.fromDate(cutoff);

  try {
    // Considera updatedAt quando presente; cai para createdAt em fichas
    // antigas que ainda não possuem o campo updatedAt.
    const snap = await db.collection("leads")
      .where("status", "==", "recusado")
      .get();

    let deleted = 0;
    const errors: string[] = [];

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const referenceTs: Timestamp | undefined = data.updatedAt ?? data.createdAt;

      if (!referenceTs) {
        // Sem timestamp de referência: não exclui automaticamente,
        // para evitar remoção indevida de dados sem critério auditável.
        continue;
      }

      if (referenceTs.toMillis() <= cutoffTs.toMillis()) {
        try {
          await docSnap.ref.delete();
          deleted++;
        } catch (e: any) {
          errors.push(`${docSnap.id}: ${e.message}`);
        }
      }
    }

    const summary = {
      success: true,
      checked: snap.size,
      deleted,
      retentionDays: RETENTION_DAYS,
      errors,
      ranAt: new Date().toISOString(),
    };

    console.log("[purge-rejected-leads]", JSON.stringify(summary));

    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (err: any) {
    console.error("[purge-rejected-leads] erro:", err?.message ?? err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err?.message ?? "Erro interno no expurgo de leads recusados." }),
    };
  }
};

// Agendamento: diariamente às 03:00 UTC.
export const handler = schedule("0 3 * * *", handlerFn);