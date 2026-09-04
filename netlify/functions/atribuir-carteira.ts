// ELITE90 PRO · atribuir-carteira
// Netlify Function: atribui um profissional à carteira de um atleta, para uma
// especialidade. Cobre UC-DEL-02 (primeira atribuição) e UC-DEL-07
// (substituição), unificados aqui porque o Adendo 02 os unifica: a seção 4.2
// diz que uma segunda atribuição para o mesmo par "se torna uma substituição"
// (A2 do UC-DEL-02), não um fluxo separado que o chamador precise escolher.
//
// Grava em `assignments/{assignmentId}` (Adendo 02, seção 4.2).
//
// A INVARIANTE (RN-10): no máximo um vínculo ativo (`endedAt: null`) por par
// `athleteUid` + `specialty`. Fechar o anterior e abrir o novo acontece NA
// MESMA TRANSAÇÃO — separá-los deixaria uma janela em que uma falha entre as
// duas escritas produz dois vínculos ativos ou nenhum.
//
// DOIS EVENTOS NA SUBSTITUIÇÃO, UM SÓ NA PRIMEIRA ATRIBUIÇÃO (AD-14, seção
// 7.4.2). Operação atômica no banco não implica evento único na auditoria: o
// encerramento precisa ser encontrável pelo nome quando alguém perguntar
// quando determinado profissional deixou de responder por um atleta.
//
// O QUE ESTA FUNÇÃO NÃO FAZ, DELIBERADAMENTE
//
// Não aceita atribuir o MESMO profissional que já está ativo naquele par. Não
// é substituição — é no-op —, e gravar um evento de troca que não trocou nada
// confundiria a auditoria. Recusado com 400.
//
// Não aceita profissional inativo nem sem a especialidade pedida (regras do
// UC-DEL-02: "Profissional sem a especialidade requerida — não aparece como
// opção").

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { validarUid, validarIdDocumento, validarSpecialty } from "./_m2-validacao";

const COLECAO = "assignments";
const COLECAO_ATLETAS = "athletes";
const COLECAO_PROFISSIONAIS = "professionals";

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

class AtletaNaoEncontrado extends Error {}
class ProfissionalInvalido extends Error {
  constructor(public motivo: string) {
    super(motivo);
  }
}
class MesmoProfissionalJaAtivo extends Error {}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let ator: Ator & { tipo: "humano" };
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    ator = {
      tipo: "humano",
      uid: decoded.uid,
      email: decoded.email ?? null,
      papel: "admin",
    };
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo inválido." });
  }

  const { athleteUid, professionalId, specialty } = corpo;

  for (const v of [
    validarUid(athleteUid),
    validarIdDocumento(professionalId, "professionalId"),
    validarSpecialty(specialty),
  ]) {
    if (!v.ok) return json(400, { erro: v.erro });
  }

  const db = getFirestore(app);
  const emHomologacao = process.env.CONTEXT !== "production";

  let substituicao = false;
  let assignmentAnteriorId: string | null = null;
  const novaRef = db.collection(COLECAO).doc();

  try {
    await db.runTransaction(async (tx) => {
      // O atleta precisa existir. Mesma guarda de salvar-rascunho-plano.ts:
      // sem ela, um uid errado cria vínculo pendurado em atleta inexistente.
      const atletaSnap = await tx.get(db.collection(COLECAO_ATLETAS).doc(athleteUid));
      if (!atletaSnap.exists) throw new AtletaNaoEncontrado();

      const profSnap = await tx.get(db.collection(COLECAO_PROFISSIONAIS).doc(professionalId));
      if (!profSnap.exists) throw new ProfissionalInvalido("Profissional não encontrado.");
      const prof = profSnap.data() as Record<string, any>;
      if (prof.active !== true) {
        throw new ProfissionalInvalido("Profissional está inativo.");
      }
      if (!Array.isArray(prof.specialties) || !prof.specialties.includes(specialty)) {
        throw new ProfissionalInvalido(
          "Profissional não tem a especialidade requerida.",
        );
      }

      // A invariante: no máximo um vínculo ativo por par athleteUid+specialty.
      const ativoSnap = await tx.get(
        db
          .collection(COLECAO)
          .where("athleteUid", "==", athleteUid)
          .where("specialty", "==", specialty)
          .where("endedAt", "==", null)
          .limit(1),
      );

      if (!ativoSnap.empty) {
        const atual = ativoSnap.docs[0];
        if (atual.get("professionalId") === professionalId) {
          throw new MesmoProfissionalJaAtivo();
        }
        substituicao = true;
        assignmentAnteriorId = atual.id;
        // Encerramento por substituição, na MESMA transação da abertura do
        // novo vínculo — é o que a invariante exige.
        tx.update(atual.ref, {
          endedAt: FieldValue.serverTimestamp(),
          endedReason: "replaced",
          endedBy: { uid: ator.uid, email: ator.email },
        });
      }

      tx.create(novaRef, {
        athleteUid,
        professionalId,
        specialty,
        startedAt: FieldValue.serverTimestamp(),
        endedAt: null,
        endedReason: null,
        startedBy: { uid: ator.uid, email: ator.email },
        endedBy: null,
        _test: emHomologacao,
      });
    });
  } catch (e) {
    if (e instanceof AtletaNaoEncontrado) {
      return json(404, { erro: "Atleta não encontrado." });
    }
    if (e instanceof ProfissionalInvalido) {
      return json(400, { erro: e.motivo });
    }
    if (e instanceof MesmoProfissionalJaAtivo) {
      return json(400, {
        erro: "Este profissional já responde por este atleta nesta especialidade.",
      });
    }
    console.error("[atribuir-carteira] falha ao gravar:", e);
    return json(500, { erro: "Não foi possível atribuir a carteira." });
  }

  // Eventos DEPOIS da transação e FORA dela (DR-06): descrevem fato consumado.
  // Um evento na primeira atribuição; dois na substituição (AD-14, seção 7.4.2).
  if (substituicao && assignmentAnteriorId) {
    await registrar({
      acao: "carteira.encerrada",
      ator,
      origem: "atribuir-carteira",
      alvo: { colecao: COLECAO, id: assignmentAnteriorId } as Alvo,
      detalhe: { endedReason: "replaced" },
      _test: emHomologacao,
    });
  }

  await registrar({
    acao: "carteira.atribuida",
    ator,
    origem: "atribuir-carteira",
    alvo: { colecao: COLECAO, id: novaRef.id } as Alvo,
    detalhe: { specialty },
    _test: emHomologacao,
  });

  return json(200, {
    ok: true,
    assignmentId: novaRef.id,
    substituicao,
    assignmentAnteriorId,
  });
};
