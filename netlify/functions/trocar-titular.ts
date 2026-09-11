// ELITE90 PRO · trocar-titular
// Netlify Function: substitui o profissional TITULAR de uma especialidade e
// migra a carteira que nasceu da titularidade.
//
// Adendo 09, AT-05, com AT-14, AT-15 e AT-16.
//
// DUAS METADES, E SÓ UMA ESTÁ AQUI.
//
// METADE AUTOMÁTICA (esta função). Os vínculos ativos com `origin: "default"`
// do titular anterior migram para o novo titular, na mesma transação em que a
// configuração é atualizada. Cada atleta custa DUAS escritas — encerrar o
// vínculo antigo e criar o novo —, e cada um gera DOIS eventos.
//
// METADE INTERATIVA (não está aqui — AT-16). Os vínculos `explicit` NÃO SÃO
// TOCADOS. Esta função os DEVOLVE na resposta, e a tela pergunta ao Coach,
// atleta por atleta. Cada resposta vira uma chamada a `atribuir-carteira.ts`,
// que já existe, já tem as guardas certas e já grava `origin: "explicit"`. Não
// há função nova para essa metade, e não deve haver: duplicaria as guardas.
//
// POR QUE OS EXPLÍCITOS NÃO MIGRAM SOZINHOS. Eles estão ali porque o Coach
// decidiu, atleta a atleta, que aquele profissional responderia por aquele
// atleta. Migrá-los em massa desfaria essa decisão em silêncio. E perguntar
// sobre TODOS seria igualmente errado: os `default` estão ali porque eram o
// padrão, e é o padrão que está mudando.
//
// A SESSÃO DE INTERFACE NÃO É UNIDADE DE TRANSAÇÃO (AT-05). A parte interativa
// acontece em várias idas e vindas, com o Coach pensando entre uma e outra;
// nada disso cabe numa transação do Firestore, e tentar prendê-la a uma seria
// trocar consistência real por aparência de atomicidade.

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
 * A origem dos vínculos migrados por esta função (AT-03).
 *
 * Continua `default`: o vínculo migrado nasceu da regra de titularidade e
 * segue nascendo dela — mudou o titular, não a natureza do vínculo. O vínculo
 * migrado POR ESCOLHA do Coach, na metade interativa, nasce `explicit`, e nasce
 * em `atribuir-carteira.ts`, não aqui.
 */
const ORIGEM_DESTA_FUNCAO: AssignmentOrigin = "default";

/**
 * Teto de atletas migrados por ato (AT-14).
 *
 * NÃO É O MESMO 499 DE `definir-titular.ts`, e a diferença não é arbitrária:
 * lá cada atleta custa UMA escrita — a criação do vínculo —, e o quingentésimo
 * documento é a configuração. Aqui cada atleta custa DUAS — encerrar o antigo e
 * criar o novo —, então o mesmo limite de 500 escritas por transação do
 * Firestore comporta metade dos atletas. `(500 - 1) / 2 = 249`.
 *
 * Acima do teto, RECUSA com 422 em vez de tentar. Reaproveitar 499 aqui faria a
 * transação estourar o limite no meio da escrita e falhar com erro do Firestore
 * — em vez de uma recusa que diz quantos atletas são e por que não deu.
 */
const MAX_ATLETAS_POR_ATO = 249;

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
class SemTitular extends Error {}
class MesmoTitular extends Error {}
class VolumeExcedido extends Error {
  constructor(public quantidade: number) {
    super("Volume excedido");
  }
}

/** Vínculo `explicit` devolvido para a tela perguntar (AT-16). */
// A forma que a TRANSAÇÃO produz — sem nome, porque o getAll dos nomes
// acontece DEPOIS dela, sobre o lote final de pendentes (não faz sentido
// buscar nome de um atleta que a transação pode ainda descartar).
type PendenteBruto = {
  assignmentId: string;
  athleteUid: string;
  professionalId: string;
};

// A forma que a RESPOSTA devolve — com nome, sempre presente (`null` é
// resposta válida, ausência do campo não é). Achado em execução, 12/09/2026:
// a tela mostrava o athleteUid literal na lista de pendências, porque esta
// função nunca precisou do nome até a interface passar a listar por nome.
type PendenteDeEscolha = PendenteBruto & { athleteName: string | null };

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Identidade antes de qualquer leitura do Firestore (Adendo 09, seção 3.7).
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let ator: Extract<Ator, { tipo: "humano" }>;
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

  // Identificadores para os eventos posteriores à transação.
  const migrados: { anteriorId: string; novoId: string }[] = [];
  let pendentes: PendenteBruto[] = [];
  let titularAnteriorId = "";

  try {
    await db.runTransaction(async (tx) => {
      migrados.length = 0;
      pendentes = [];

      // -- TODAS AS LEITURAS ANTES DE QUALQUER ESCRITA --

      const configSnap = await tx.get(configRef);
      const titular = configSnap.exists
        ? (configSnap.data() ?? {})[specialty]
        : undefined;
      const anterior = titular?.professionalId
        ? String(titular.professionalId)
        : null;

      // SEM TITULAR NÃO É TROCA. Definir é ato próprio, com regra própria
      // (AT-01), e aceitar aqui faria a mesma configuração nascer por dois
      // caminhos, um deles sem a guarda que o outro tem.
      if (!anterior) throw new SemTitular();
      if (anterior === professionalId) throw new MesmoTitular();
      titularAnteriorId = anterior;

      // O estado do profissional é lido AGORA, e não confiado à configuração
      // (AC-13): a configuração registra a decisão, o cadastro é a verdade.
      const profSnap = await tx.get(
        db.collection(COLECAO_PROFISSIONAIS).doc(professionalId),
      );
      const verdicto = conferirProfissionalAtivo(profSnap);
      if (!verdicto.ok) throw new ProfissionalInvalido(verdicto.erro);
      const prof = verdicto.dados;
      if (!Array.isArray(prof.specialties) || !prof.specialties.includes(specialty)) {
        throw new ProfissionalInvalido("Profissional não tem a especialidade requerida.");
      }

      // Todos os vínculos ativos do titular ANTERIOR nesta especialidade. A
      // separação por `origin` é a razão de o campo existir (AT-03): sem ele,
      // distinguir o que migra do que se pergunta exigiria inferir pelo
      // `professionalId`, e a inferência quebra na segunda troca.
      const ativosSnap = await tx.get(
        db
          .collection(COLECAO)
          .where("specialty", "==", specialty)
          .where("endedAt", "==", null),
      );

      const aMigrar = ativosSnap.docs.filter(
        (d) => d.get("professionalId") === anterior && d.get("origin") === "default",
      );
      pendentes = ativosSnap.docs
        .filter(
          (d) => d.get("professionalId") === anterior && d.get("origin") === "explicit",
        )
        .map((d) => ({
          assignmentId: d.id,
          athleteUid: String(d.get("athleteUid")),
          professionalId: anterior,
        }));

      if (aMigrar.length > MAX_ATLETAS_POR_ATO) {
        throw new VolumeExcedido(aMigrar.length);
      }

      // -- ESCRITAS --

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

      for (const antigo of aMigrar) {
        // ENCERRAR E CRIAR NA MESMA TRANSAÇÃO, SOB O MESMO PAR — é a condição
        // que autoriza `replaced` (AT-15). Fora dela, o motivo seria falso: não
        // haveria substituição, apenas um encerramento se dizendo uma.
        tx.update(antigo.ref, {
          endedAt: FieldValue.serverTimestamp(),
          endedReason: "replaced",
          endedBy: { uid: ator.uid, email: ator.email },
        });

        const novaRef = db.collection(COLECAO).doc();
        tx.create(novaRef, {
          athleteUid: antigo.get("athleteUid"),
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

        migrados.push({ anteriorId: antigo.id, novoId: novaRef.id });
      }
    });
  } catch (e) {
    if (e instanceof SemTitular) {
      return json(409, {
        erro:
          "Esta especialidade ainda não tem titular. Definir o primeiro titular é operação própria.",
      });
    }
    if (e instanceof MesmoTitular) {
      return json(409, {
        erro: "Este profissional já é o titular desta especialidade.",
      });
    }
    if (e instanceof ProfissionalInvalido) {
      return json(400, { erro: e.motivo });
    }
    if (e instanceof VolumeExcedido) {
      return json(422, {
        erro:
          `São ${e.quantidade} atletas a migrar, acima do limite de ${MAX_ATLETAS_POR_ATO} ` +
          "que uma única operação atômica comporta — cada atleta custa duas escritas, " +
          "encerrar e criar. Migrar nesse volume exige processamento em lotes, que ainda não foi decidido.",
        quantidade: e.quantidade,
      });
    }
    console.error("[trocar-titular] falha ao gravar:", e);
    return json(500, { erro: "Não foi possível trocar o titular." });
  }

  // Eventos DEPOIS da transação e FORA dela (DR-06): descrevem fato consumado.
  // A decisão primeiro; os efeitos depois, dois por atleta migrado (AT-05).
  await registrar({
    acao: "titular.definido",
    ator,
    origem: "trocar-titular",
    alvo: { colecao: COLECAO_CONFIG, id: DOC_DELEGACAO } as Alvo,
    detalhe: { specialty },
    _test: emHomologacao,
  });

  for (const { anteriorId, novoId } of migrados) {
    await registrar({
      acao: "carteira.encerrada",
      ator,
      origem: "trocar-titular",
      alvo: { colecao: COLECAO, id: anteriorId } as Alvo,
      detalhe: { endedReason: "replaced" },
      _test: emHomologacao,
    });
    await registrar({
      acao: "carteira.atribuida",
      ator,
      origem: "trocar-titular",
      alvo: { colecao: COLECAO, id: novoId } as Alvo,
      detalhe: { specialty, origin: ORIGEM_DESTA_FUNCAO },
      _test: emHomologacao,
    });
  }

  // Nomes dos atletas pendentes, restrito ao LOTE devolvido — nunca a
  // coleção inteira. Mesmo padrão de listar-carteira.ts: um getAll pequeno é
  // mais barato do que obrigar a tela a resolver identificador por conta
  // própria, e a pendência já é curta por natureza (vínculos explícitos do
  // titular que está saindo, tipicamente poucos).
  const uidsPendentes = [...new Set(pendentes.map((x) => x.athleteUid))];
  const nomesPorAtleta = new Map<string, string | null>();
  if (uidsPendentes.length) {
    const refs = uidsPendentes.map((uid) => db.collection(COLECAO_ATLETAS).doc(uid));
    const docs = await db.getAll(...refs);
    for (const s of docs) {
      if (s.exists) {
        const nome = (s.data() ?? {}).name;
        nomesPorAtleta.set(s.id, typeof nome === "string" ? nome : null);
      }
    }
  }

  return json(200, {
    ok: true,
    specialty,
    professionalId,
    professionalIdAnterior: titularAnteriorId,
    vinculosMigrados: migrados.length,
    // A metade interativa começa aqui: a tela pergunta sobre cada um destes, e
    // cada resposta de migrar vira uma chamada a `atribuir-carteira.ts` (AT-16).
    // Lista vazia quer dizer que não há nada a perguntar, e a troca terminou.
    pendentesDeEscolha: pendentes.map((x) => ({
      ...x,
      athleteName: nomesPorAtleta.get(x.athleteUid) ?? null,
    })),
  });
};
