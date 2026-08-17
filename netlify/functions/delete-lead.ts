// ELITE90 PRO · delete-lead
// Netlify Function: exclui permanentemente a ficha de um lead (LGPD Art. 18, VI).
// Remove as fotos do Firebase Storage antes de apagar o documento Firestore,
// garantindo que nenhum dado pessoal permaneça no bucket após a exclusão.
//
// Segurança: requer Firebase ID token com custom claim admin:true.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getApp, storageBucketName } from "./_firebase";


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

  try {
    const { leadId } = JSON.parse(event.body ?? "{}");
    if (!leadId) return { statusCode: 400, body: "leadId obrigatório" };

    const db = getFirestore();
    const leadDoc = await db.collection("leads").doc(leadId).get();
    if (!leadDoc.exists) return { statusCode: 404, body: "Lead não encontrado" };

    const lead = leadDoc.data() as Record<string, any>;

    // GUARDA DE FICHA PROMOVIDA (15/08/2026)
    // O atleta criado por promote-lead aponta para AS MESMAS fotos desta ficha
    // (baselinePhotos = fotos_paths, sem cópia no Storage). Excluir a ficha
    // apagaria as fotos do Dia 1 de um atleta ativo, e o campo continuaria
    // preenchido com caminhos que não levam a lugar nenhum.
    // Pedido legítimo de exclusão por parte de um atleta deve ser tratado a
    // partir do registro do atleta — envolve encerrar um acompanhamento em
    // curso, não apenas apagar uma ficha de candidatura.
    if (lead.convertedAt) {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: "Esta ficha não pode ser excluída: o candidato já foi promovido a atleta. "
               + "A remoção dos dados deve ser feita a partir do registro do atleta.",
          athleteUid: lead.convertedAthleteUid ?? null,
        }),
      };
    }

    const fotosPaths: string[] = Array.isArray(lead.fotos_paths) ? lead.fotos_paths : [];

    const bucketName = storageBucketName();
    const bucket = getStorage().bucket(bucketName);

    const storageErrors: string[] = [];
    await Promise.all(
      fotosPaths.map(async (filePath: string) => {
        try {
          await bucket.file(filePath).delete();
        } catch (e: any) {
          // Arquivo já ausente não é erro — prossegue com exclusão do documento.
          if (e.code !== 404 && e.code !== 204) {
            storageErrors.push(`${filePath}: ${e.message}`);
          }
        }
      })
    );

    // CASCATA PARA AS AVALIAÇÕES VINCULADAS
    // O documento gravado por send-evaluation em "avaliacoes" guarda nome,
    // e-mail, o texto integral das cinco seções e o token que abre
    // /avaliacao/{token} — página pública, sem autenticação, válida por 90
    // dias. Apagar apenas a ficha deixaria esse conjunto acessível a quem
    // tivesse o link, o que contraria o próprio pedido de exclusão.
    // A exclusão vem ANTES da ficha: se falhar, a ficha permanece e a operação
    // pode ser repetida — o inverso deixaria uma avaliação órfã, sem nenhum
    // registro que levasse de volta a ela.
    const avaliacoesSnap = await db
      .collection("avaliacoes")
      .where("leadId", "==", leadId)
      .get();

    if (!avaliacoesSnap.empty) {
      const lote = db.batch();
      avaliacoesSnap.docs.forEach((d) => lote.delete(d.ref));
      await lote.commit();
    }

    await leadDoc.ref.delete();

    if (storageErrors.length > 0) {
      console.warn("[delete-lead] Fotos não removidas do Storage:", storageErrors);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        fotosApagadas: fotosPaths.length - storageErrors.length,
        avaliacoesApagadas: avaliacoesSnap.size,
        storageErrors,
      }),
    };
  } catch (err: any) {
    console.error("[delete-lead] Erro:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message ?? "Erro interno" }),
    };
  }
};
