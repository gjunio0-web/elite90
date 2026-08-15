// --- ELITE90 PRO · purge-rejected-leads
// Netlify Scheduled Function: rotina de retenção de dados (LGPD, Art. 16).
//
// Política definida pelo controlador (ELITE90 PRO / Coach Ruiz):
//   Leads com status "recusado" são eliminados permanentemente 90 dias
//   após a última atualização de status (campo "updatedAt").
//
// Execução: diária, às 03:00 (horário do servidor Netlify, UTC).
// Configuração do agendamento: ver netlify.toml ([[functions]] schedule).

import { schedule } from "@netlify/functions";
import { Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getDb, storageBucketName } from "./_firebase";

const RETENTION_DAYS = 90;


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

      // GUARDA DE FICHA PROMOVIDA (15/08/2026): mesma razão de delete-lead —
      // as fotos são compartilhadas com o atleta. Improvável (exigiria uma
      // ficha promovida marcada como "recusado"), mas o status permanece
      // editável depois da promoção, então a guarda não é supérflua.
      if (data.convertedAt) {
        continue;
      }

      if (!referenceTs) {
        // Sem timestamp de referência: não exclui automaticamente,
        // para evitar remoção indevida de dados sem critério auditável.
        continue;
      }

      if (referenceTs.toMillis() <= cutoffTs.toMillis()) {
        try {
          const fotosPaths: string[] = Array.isArray(data.fotos_paths) ? data.fotos_paths : [];
          if (fotosPaths.length > 0) {
            const bucketName = storageBucketName();
            const bucket = getStorage().bucket(bucketName);
            await Promise.all(
              fotosPaths.map(async (filePath: string) => {
                try {
                  await bucket.file(filePath).delete();
                } catch (e: any) {
                  if (e.code !== 404 && e.code !== 204) {
                    errors.push(`storage:${filePath}: ${e.message}`);
                  }
                }
              })
            );
          }
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