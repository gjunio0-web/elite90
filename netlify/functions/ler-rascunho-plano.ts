// ELITE90 PRO · ler-rascunho-plano
// Netlify Function: leitura do rascunho gravado em athletes/{uid}/plans/{planType}.
// Item 1.4 do plano de persistência do M2 — a metade que faltava da Fase 1.
//
// POR QUE ESTE ITEM PERTENCE À FASE 1, E NÃO À SEGUINTE
// Sem leitura, a forma do `draft` nunca é exercitada de volta. Um campo perdido
// na serialização só apareceria muitas fases adiante, com dado real por cima.
// A LEITURA É O TESTE DA ESCRITA. Enquanto ela não existia, o painel exibia
// "salvo" para um trabalho que se perdia ao recarregar — o pior estado
// possível, porque promete o que não cumpre.
//
// -----------------------------------------------------------------------------
// DECISÕES DE FORMA, submetidas e acatadas em 01/09/2026
// -----------------------------------------------------------------------------
//
// 1. USA POST, e não GET. O método de consulta seria o convencional, mas
//    quebraria a simetria com o padrão de escrita que o Adendo 05 descreve em
//    nove elementos e manda seguir "sem desvio" (fato W-4, decisão TF-05). O
//    padrão está declarado normativo; a convenção de método, não. Simetria
//    acima de convenção — quem escrever a próxima função do M2 encontra a mesma
//    moldura nas duas direções.
//
// 2. AUSÊNCIA DE RASCUNHO NÃO É ERRO. Devolve `ok: true` com `draft: null`.
//    Todo atleta está nesse estado antes da primeira edição, e tratá-lo como
//    404 obrigaria o cliente a distinguir falha de ausência pelo código de
//    resposta — a distinção mais fácil de errar que existe. O 404 fica
//    reservado para atleta inexistente, que é falha de verdade.
//
// 3. UMA CHAMADA POR TIPO DE PLANO, não uma que traga os dois. As abas montam
//    sob demanda; trazer o plano nutricional ao abrir a aba de treino gastaria
//    leitura que pode nunca ser usada.
//
// -----------------------------------------------------------------------------
// O QUE DEVOLVE, E O QUE NÃO DEVOLVE
// -----------------------------------------------------------------------------
// Devolve o mapa `draft` INTEIRO, exatamente como gravado. Sem transformar, sem
// sanear, sem preencher ausência. É simetria com a regra que o Adendo 01 impõe
// à escrita de `coachNotes` — "apenas armazená-lo como recebido" — e coerência
// com a seção 8.1 do esquema (versão 3), que justifica manter o rascunho
// embutido justamente porque "é lido e gravado sempre inteiro, nunca consultado
// por dentro".
//
// Devolve também `draftUpdatedAt` e `status`, que a tela pode querer exibir.
//
// NÃO devolve `lastIdempotencyKey`: é registro de recebimento, não conteúdo.
// NÃO devolve `draftUpdatedBy`: autoria do autossalvo não é dado de tela; se um
// dia for, entra por decisão própria, não por descuido de projeção.
// NÃO lê versões publicadas — isso é a Fase 5.
//
// LISTA DE PERMITIDOS, NUNCA LISTA DE PROIBIDOS. A projeção enumera o que
// devolve. Uma lista de proibidos deixaria escapar todo campo novo acrescentado
// depois, em silêncio. É o mesmo argumento que o Adendo 02 usa na seção 6.3
// para a projeção do delegado, e que o esquema usa para mandar toda escrita
// pelo servidor.
//
// NÃO REGISTRA EVENTO DE RASTREABILIDADE. Leitura não é fato a preservar, e
// nenhuma das ações reservadas ao M2 a cobre. Mesma lógica que dispensou o
// evento no autossalvo, por motivo diferente: lá seria ruído, aqui não há o que
// registrar.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import {
  validarUid,
  validarPlanType,
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

  // Autenticação antes de qualquer leitura do corpo — mesma ordem da função de
  // escrita, e pelo mesmo motivo: requisição sem token não merece o custo de
  // analisar o JSON, e responder de forma diferente para corpo inválido
  // revelaria que o endpoint existe a quem não deveria saber.
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

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
    return json(400, { erro: "Corpo inválido." });
  }

  const { athleteUid, planType } = corpo;

  for (const v of [validarUid(athleteUid), validarPlanType(planType)]) {
    if (!v.ok) return json(400, { erro: v.erro });
  }

  const db = getFirestore(app);

  try {
    // Mesma guarda da escrita: atleta inexistente é 404. Sem ela, um uid errado
    // devolveria "sem rascunho" — indistinguível do atleta que ainda não editou.
    const atletaRef = db.collection(COLECAO_ATLETAS).doc(athleteUid);
    const atletaSnap = await atletaRef.get();
    if (!atletaSnap.exists) {
      return json(404, { erro: "Atleta não encontrado." });
    }

    const planoSnap = await atletaRef
      .collection(SUBCOLECAO_PLANOS)
      .doc(planType as PlanType)
      .get();

    if (!planoSnap.exists) {
      // Estado legítimo: ninguém editou este plano ainda. A gaveta monta como
      // monta hoje, e é o próprio cliente que decide isso — não o servidor.
      return json(200, {
        ok: true,
        athleteUid,
        planType,
        draft: null,
        draftUpdatedAt: null,
        status: "none",
      });
    }

    const d = planoSnap.data() ?? {};

    // Timestamp do Firestore não sobrevive à serialização JSON de forma útil.
    // Convertido para ISO 8601, que a tela formata na leitura conforme o P1 do
    // esquema (versão 3): dado é dado, formatação é da interface.
    const atualizadoEm =
      d.draftUpdatedAt && typeof d.draftUpdatedAt.toDate === "function"
        ? d.draftUpdatedAt.toDate().toISOString()
        : null;

    return json(200, {
      ok: true,
      athleteUid,
      planType,
      draft: d.draft ?? null,
      draftUpdatedAt: atualizadoEm,
      status: d.status ?? "none",
    });
  } catch (e: any) {
    console.error("[ler-rascunho-plano]", e?.stack ?? e);
    return json(500, { erro: "Falha ao ler o rascunho do plano." });
  }
};
