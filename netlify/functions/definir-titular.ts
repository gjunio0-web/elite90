// ELITE90 PRO · definir-titular
// Netlify Function: define o profissional TITULAR de uma especialidade e
// materializa a carteira — cria um vínculo em `assignments` para cada atleta que
// ainda não tenha vínculo ativo naquela especialidade.
//
// Adendo 09 (Titularidade e Superfície Administrativa), AT-01 e AT-02.
//
// O ATO PRIMÁRIO NÃO É ATRIBUIR ATLETA A ATLETA. O Coach define titulares, e
// todos os atletas passam a estar nas carteiras deles. `atribuir-carteira.ts`
// continua sendo o ato individual, e os dois convivem: o que os distingue no
// banco e na auditoria é o campo `origin` (AT-03).
//
// ATÔMICO, E O VOLUME É ACEITO (AT-02). Um atleta que ficasse de fora por falha
// parcial seria INVISÍVEL — não apareceria na carteira de ninguém, e nada
// reprovaria. Por isso configuração e vínculos são gravados na mesma transação:
// ou o titular existe com a carteira inteira, ou não existe.
//
// ATLETAS COM VÍNCULO ATIVO NÃO SÃO TOCADOS (AT-01). Quem já tem profissional
// naquela especialidade fica como está — inclusive quem foi atribuído
// individualmente. Definir titular não desfaz decisão anterior do Coach.
//
// RECUSA SE JÁ HOUVER TITULAR (AT-01). Trocar é ato próprio, com regra própria
// (AT-05: migra os `default` e pergunta sobre os `explicit`), e virá em função
// própria. Aceitar aqui uma segunda definição faria a troca acontecer sem a
// metade interativa, sobrescrevendo decisão do Coach em silêncio.
//
// UM EVENTO 'titular.definido' MAIS UM 'carteira.atribuida' POR ATLETA (AT-02).
// Não é ruído: a carteira mudou mesmo para cada um. Os 'carteira.atribuida'
// registram o EFEITO; o 'titular.definido' registra a DECISÃO, que nenhum deles
// registra (AT-09).

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import {
  validarIdDocumento,
  validarSpecialty,
  type AssignmentOrigin,
} from "./_m2-validacao";
import { conferirProfissionalAtivo } from "./_profissional-ativo";

const COLECAO = "assignments";
const COLECAO_ATLETAS = "athletes";
const COLECAO_PROFISSIONAIS = "professionals";
const COLECAO_CONFIG = "config";
const DOC_DELEGACAO = "delegationDefaults";

/**
 * A origem dos vínculos que ESTA função cria (AT-03).
 *
 * Sempre `default`: nasceram da regra de titularidade, não de escolha atleta a
 * atleta. É esta marca que permite à troca de titular (AT-05) migrar estes
 * automaticamente e PERGUNTAR sobre os `explicit`.
 *
 * Tipada contra o vocabulário fechado para que uma mudança lá alcance este
 * ponto na compilação, e não em produção.
 */
const ORIGEM_DESTA_FUNCAO: AssignmentOrigin = "default";

/**
 * Teto de vínculos por ato, imposto pela transação do Firestore: no máximo 500
 * documentos escritos. Um deles é o documento de configuração, restando 499
 * vínculos.
 *
 * POR QUE RECUSAR EM VEZ DE FATIAR. A AT-02 diz que, se o volume tornar a
 * transação inviável, a saída NÃO é abandonar a atomicidade — é processar em
 * lotes com registro de progresso, e isso exige decisão que ninguém tomou. Até
 * lá, exceder o teto é recusa explícita: a alternativa seria a transação falhar
 * sozinha, no meio de um ato do Coach, com erro do Firestore em vez de
 * explicação.
 *
 * Em 08/09/2026 a base de produção tinha zero atletas promovidos. O teto é
 * salvaguarda para o dia em que isso mudar, não restrição do presente.
 */
const MAX_VINCULOS_POR_ATO = 499;

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

class ProfissionalInvalido extends Error {
  constructor(public motivo: string) {
    super(motivo);
  }
}
class TitularJaDefinido extends Error {
  constructor(public professionalIdAtual: string) {
    super("Titular já definido");
  }
}
class VolumeExcedido extends Error {
  constructor(public quantidade: number) {
    super("Volume excedido");
  }
}

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

  const { professionalId, specialty } = corpo;

  for (const v of [
    validarIdDocumento(professionalId, "professionalId"),
    validarSpecialty(specialty),
  ]) {
    if (!v.ok) return json(400, { erro: v.erro });
  }

  const db = getFirestore(app);
  const emHomologacao = process.env.CONTEXT !== "production";
  const configRef = db.collection(COLECAO_CONFIG).doc(DOC_DELEGACAO);

  // Identificadores dos vínculos criados, para os eventos posteriores. Cada
  // referência é reservada FORA da transação porque `doc()` só gera o
  // identificador — não lê nem escreve nada.
  const criados: { assignmentId: string; athleteUid: string }[] = [];

  try {
    await db.runTransaction(async (tx) => {
      criados.length = 0;

      // -- TODAS AS LEITURAS ANTES DE QUALQUER ESCRITA --
      // Exigência da transação do Firestore, e também o que mantém as guardas
      // válidas no instante da gravação (mesma razão registrada na AC-13).

      const configSnap = await tx.get(configRef);
      const titularAtual = configSnap.exists
        ? (configSnap.data() ?? {})[specialty]
        : undefined;
      if (titularAtual && titularAtual.professionalId) {
        throw new TitularJaDefinido(String(titularAtual.professionalId));
      }

      const profSnap = await tx.get(
        db.collection(COLECAO_PROFISSIONAIS).doc(professionalId),
      );
      const verdicto = conferirProfissionalAtivo(profSnap);
      if (!verdicto.ok) throw new ProfissionalInvalido(verdicto.erro);
      const prof = verdicto.dados;
      if (!Array.isArray(prof.specialties) || !prof.specialties.includes(specialty)) {
        throw new ProfissionalInvalido("Profissional não tem a especialidade requerida.");
      }

      // Todos os atletas. Não há estado de arquivamento no documento do atleta
      // — a exclusão é remoção —, então quem está na coleção está no programa.
      // Os documentos de homologação (`_test: true`) entram: no ambiente em que
      // existem, eles SÃO a base, e deixá-los de fora tornaria a homologação um
      // exercício sobre uma carteira que a produção não terá.
      const atletasSnap = await tx.get(db.collection(COLECAO_ATLETAS));

      // Vínculos ativos desta especialidade. A diferença entre os dois conjuntos
      // é a carteira a materializar. Não existe consulta de "atleta sem vínculo"
      // no Firestore: a junção é feita aqui, em memória, e por isso as duas
      // leituras precisam estar na MESMA transação — senão um vínculo criado no
      // intervalo produziria um segundo vínculo ativo para o mesmo par, que é a
      // invariante RN-10.
      const ativosSnap = await tx.get(
        db
          .collection(COLECAO)
          .where("specialty", "==", specialty)
          .where("endedAt", "==", null),
      );
      const comVinculo = new Set<string>(
        ativosSnap.docs.map((d) => String(d.get("athleteUid"))),
      );

      const semVinculo = atletasSnap.docs.filter((d) => !comVinculo.has(d.id));
      if (semVinculo.length > MAX_VINCULOS_POR_ATO) {
        throw new VolumeExcedido(semVinculo.length);
      }

      // -- ESCRITAS --

      // `merge: true` porque o documento é compartilhado pelas especialidades:
      // definir o titular de treino não pode apagar o de nutrição.
      tx.set(
        configRef,
        {
          [specialty]: {
            professionalId,
            definedAt: FieldValue.serverTimestamp(),
            definedBy: { uid: ator.uid, email: ator.email },
          },
        },
        { merge: true },
      );

      for (const atleta of semVinculo) {
        const novaRef = db.collection(COLECAO).doc();
        tx.create(novaRef, {
          athleteUid: atleta.id,
          professionalId,
          specialty,
          origin: ORIGEM_DESTA_FUNCAO,
          startedAt: FieldValue.serverTimestamp(),
          endedAt: null,
          endedReason: null,
          startedBy: { uid: ator.uid, email: ator.email },
          endedBy: null,
          _test: emHomologacao,
        });
        criados.push({ assignmentId: novaRef.id, athleteUid: atleta.id });
      }
    });
  } catch (e) {
    if (e instanceof TitularJaDefinido) {
      return json(409, {
        erro:
          "Esta especialidade já tem titular. Trocar o titular é operação própria, " +
          "que pergunta o que fazer com os vínculos atribuídos individualmente.",
        professionalIdAtual: e.professionalIdAtual,
      });
    }
    if (e instanceof ProfissionalInvalido) {
      return json(400, { erro: e.motivo });
    }
    if (e instanceof VolumeExcedido) {
      return json(422, {
        erro:
          `São ${e.quantidade} atletas sem vínculo nesta especialidade, acima do limite ` +
          `de ${MAX_VINCULOS_POR_ATO} que uma única operação atômica comporta. ` +
          "Materializar a carteira nesse volume exige processamento em lotes, que ainda não foi decidido.",
        quantidade: e.quantidade,
      });
    }
    console.error("[definir-titular] falha ao gravar:", e);
    return json(500, { erro: "Não foi possível definir o titular." });
  }

  // Eventos DEPOIS da transação e FORA dela (DR-06): descrevem fato consumado.
  // A decisão primeiro, os efeitos depois — é a ordem em que se lê a auditoria.
  await registrar({
    acao: "titular.definido",
    ator,
    origem: "definir-titular",
    alvo: { colecao: COLECAO_CONFIG, id: DOC_DELEGACAO } as Alvo,
    detalhe: { specialty },
    _test: emHomologacao,
  });

  // Um por atleta (AT-02). Sequencial de propósito: `registrar` é best-effort e
  // não participa de transação, e disparar dezenas em paralelo trocaria uma
  // falha isolada e visível por um pico de escrita difícil de atribuir.
  for (const { assignmentId } of criados) {
    await registrar({
      acao: "carteira.atribuida",
      ator,
      origem: "definir-titular",
      alvo: { colecao: COLECAO, id: assignmentId } as Alvo,
      detalhe: { specialty, origin: ORIGEM_DESTA_FUNCAO },
      _test: emHomologacao,
    });
  }

  return json(200, {
    ok: true,
    specialty,
    professionalId,
    vinculosCriados: criados.length,
  });
};
