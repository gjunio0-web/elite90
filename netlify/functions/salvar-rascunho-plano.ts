// ELITE90 PRO · salvar-rascunho-plano
// Netlify Function: primeira escrita do Módulo M2 (Fase 1 do plano de
// persistência, fileId 16Vaoo9BcbKdrKMWb14aMnDqrf6Eplttc).
//
// Grava o rascunho de plano em athletes/{uid}/plans/{planType}, conforme a
// seção 8.1 do esquema de persistência v3.
//
// POR QUE A ESCRITA NÃO PARTE DO NAVEGADOR
// Mesmo motivo de atualizar-exercicio.ts e promote-lead.ts: o provedor de
// e-mail/senha está aberto e a chave pública está no HTML, então qualquer
// pessoa consegue criar conta neste projeto. "Autenticado" não é "autorizado".
// A autorização real é o claim admin, conferido aqui pelo Admin SDK.
//
// POR QUE O RASCUNHO, E NÃO A SÉRIE DE PESO
// A Fase 1 precisava de uma primeira escrita que exercitasse o caminho inteiro.
// A série de peso seria mais simples, mas quem escreve peso é o ATLETA, e a
// superfície de entrada dele — o Portal do Atleta — é posterior ao M2
// (confirmado por Gon em 31/08/2026). Escolher a série de peso seria construir
// uma escrita sem escritor. O rascunho de plano é ato do Coach, e o gancho de
// autossalvo já existe na tela, com represamento de 500 ms.
//
// O QUE ESTA FUNÇÃO NÃO FAZ, DELIBERADAMENTE
//
// Não cria versão publicada. Publicar é a Fase 5, e ela está condicionada às
// decisões AF-04 e AF-05 do Adendo 03 — que tocam a forma do retrato da fórmula
// DENTRO da versão publicada. Versão publicada é imutável: gravar com a forma
// errada não se corrige, publica-se outra. Por isso a Fase 1 grava apenas o
// rascunho, que é mutável por natureza.
//
// Não registra evento de rastreabilidade. A ação reservada no vocabulário é
// `plano.publicado`, e ela descreve a publicação, não o autossalvo. Registrar um
// evento a cada 500 ms de digitação encheria a coleção de ruído e não
// responderia a pergunta nenhuma. O evento entra na Fase 5, no ato de publicar.
//
// Não desduplica pela chave de idempotência. Ela é aceita e devolvida como
// registro de recebimento; o uso real chega na Fase 7 (fila local sem rede).
// Para o rascunho a idempotência é natural: gravar duas vezes o mesmo conteúdo
// no mesmo documento sobrescreve.
//
// Não valida o conteúdo interno do plano — séries, cargas, alimentos. Ver a
// justificativa em _m2-validacao.ts.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import {
  validarUid,
  validarPlanType,
  validarRascunho,
  validarChaveIdempotencia,
  type PlanType,
} from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_PLANOS = "plans";

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Autenticação antes de qualquer leitura do corpo: requisição sem token não
  // merece nem o custo de analisar o JSON, e responder de forma diferente para
  // corpo inválido revelaria que o endpoint existe a quem não deveria saber.
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let uid: string;
  let email: string | null;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    uid = decoded.uid;
    email = decoded.email ?? null;
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo inválido." });
  }

  const { athleteUid, planType, draft, idempotencyKey } = corpo;

  for (const v of [
    validarUid(athleteUid),
    validarPlanType(planType),
    validarRascunho(draft),
    validarChaveIdempotencia(idempotencyKey),
  ]) {
    if (!v.ok) return json(400, { erro: v.erro });
  }

  const db = getFirestore(app);

  try {
    // O atleta precisa existir. Sem esta guarda, um uid errado criaria uma
    // subcoleção pendurada em documento inexistente — que o Firestore aceita
    // sem reclamar, e que some da listagem do console por não ter pai.
    const atletaRef = db.collection(COLECAO_ATLETAS).doc(athleteUid);
    const atletaSnap = await atletaRef.get();
    if (!atletaSnap.exists) {
      return json(404, { erro: "Atleta não encontrado." });
    }

    const planoRef = atletaRef.collection(SUBCOLECAO_PLANOS).doc(planType as PlanType);
    const planoSnap = await planoRef.get();
    const atual = planoSnap.exists ? planoSnap.data() ?? {} : {};

    // `hasUnpublishedChanges` só faz sentido depois que existe versão publicada.
    // Enquanto currentVersion for null, o rascunho É o plano, e não há do que
    // divergir. Marcar true aqui produziria emblema de "alterações não
    // publicadas" num plano que nunca foi publicado.
    const jaPublicado =
      typeof atual.currentVersion === "number" && atual.currentVersion > 0;

    const documento: Record<string, any> = {
      planType,
      draft,
      draftUpdatedAt: FieldValue.serverTimestamp(),
      draftUpdatedBy: { uid, email },
      // Situação: `none` só existe antes do primeiro rascunho. A partir daqui,
      // ou é rascunho, ou é publicado com rascunho por cima.
      status: jaPublicado ? "published" : "draft",
      ...(jaPublicado ? { hasUnpublishedChanges: true } : {}),
      // Preserva o ponteiro de versão. `merge: true` sozinho já preservaria,
      // mas declarar o valor inicial evita que o campo simplesmente não exista
      // num documento recém-criado — e ausência de campo e valor nulo não são a
      // mesma coisa na leitura.
      ...(planoSnap.exists ? {} : { currentVersion: null }),
      ...(idempotencyKey ? { lastIdempotencyKey: idempotencyKey } : {}),
    };

    // merge: true porque este documento tem dois donos com ciclos distintos —
    // o rascunho, que esta função escreve a cada autossalvo, e o ponteiro de
    // versão, que a Fase 5 escreverá ao publicar. Sobrescrever inteiro faria
    // uma gravação de rascunho apagar o ponteiro da versão corrente.
    await planoRef.set(documento, { merge: true });

    return json(200, {
      ok: true,
      athleteUid,
      planType,
      status: documento.status,
      idempotencyKey: idempotencyKey ?? null,
    });
  } catch (e: any) {
    console.error("[salvar-rascunho-plano]", e?.stack ?? e);
    return json(500, { erro: "Falha ao gravar o rascunho do plano." });
  }
};
