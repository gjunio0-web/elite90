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
import { registrar, type Alvo } from "./_rastreabilidade";

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
    let avaliacoesDeleted = 0;
    const errors: string[] = [];
    // Identificadores do que foi de fato removido nesta execução — é o que o
    // evento registra. Colhidos aqui e não no laço porque um único evento cobre
    // a rodada inteira, não uma ficha por vez.
    const removidos: Alvo[] = [];

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
          // CASCATA PARA AS AVALIAÇÕES VINCULADAS
          // Uma ficha recusada pode ter recebido avaliação: enviá-la a quem foi
          // recusado é prática deliberada do programa. O documento em
          // "avaliacoes" guarda nome, e-mail, o texto integral das cinco seções
          // e o token que abre /avaliacao/{token} — página pública, sem
          // autenticação. Apagar só a ficha manteria esse conjunto acessível a
          // quem tivesse o link, esvaziando a própria rotina de retenção.
          // Mesma ordem de delete-lead: a avaliação sai antes da ficha. Se esta
          // etapa falhar, a exceção interrompe a iteração deste documento, a
          // ficha permanece e a próxima execução diária tenta de novo — a ordem
          // inversa deixaria uma avaliação órfã, sem registro que levasse a ela.
          const avaliacoesSnap = await db
            .collection("avaliacoes")
            .where("leadId", "==", docSnap.id)
            .get();

          if (!avaliacoesSnap.empty) {
            const lote = db.batch();
            avaliacoesSnap.docs.forEach((d) => lote.delete(d.ref));
            await lote.commit();
            avaliacoesDeleted += avaliacoesSnap.size;
          }

          await docSnap.ref.delete();
          removidos.push({ colecao: "leads", id: docSnap.id });
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
      avaliacoesDeleted,
      retentionDays: RETENTION_DAYS,
      errors,
      ranAt: new Date().toISOString(),
    };

    // SÓ REGISTRA QUANDO ALGO FOI REMOVIDO. A rotina roda todo dia às 03:00 e
    // na maioria das execuções não encontra nada devido; gravar um evento por
    // execução vazia encheria a coleção de ruído diário e afogaria os eventos
    // que importam. Execução sem remoção fica apenas no log da função.
    //
    // Ação distinta de `lead.excluido` de propósito: aquela é ato humano
    // deliberado, esta é cumprimento automático de política de retenção.
    // Colapsá-las apagaria justamente a distinção que o registro precisa manter.
    if (removidos.length > 0) {
      await registrar({
        acao: "lead.expurgado",
        ator: { tipo: "sistema", processo: "purge-rejected-leads" },
        origem: "purge-rejected-leads",
        alvos: removidos,
        detalhe: {
          verificadas: snap.size,
          fichasRemovidas: deleted,
          avaliacoesRemovidas: avaliacoesDeleted,
          falhas: errors.length,
          retencaoDias: RETENTION_DAYS,
        },
        resultado: errors.length > 0 ? "parcial" : "ok",
      });
    }

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