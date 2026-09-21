// ELITE90 PRO · alterar-fase-atleta
// Netlify Function: TF-01 a TF-13 do Adendo 05 v1.5 — troca a fase do ciclo
// de um atleta, com histórico preservado em `athletes/{uid}/phases/{phaseId}`.
//
// POR QUE ISTO EXISTE (Adendo 05, §1 e §3)
// A fase é gravada uma única vez, na promoção, e nunca mais — decisão AF-04
// do Adendo 03 já previa quatro fases, mas a promoção só emite três
// (Bulking/Cutting/Diet Break); a manutenção só é alcançável por esta
// transição. Sem esta função: manutenção inalcançável, impossível saber em
// que fase o atleta estava em certa data, e uma troca por sobrescrita simples
// apagaria a fase anterior — o mesmo defeito que motivou o histórico de
// versões de plano, agora para a fase.
//
// SUBCOLEÇÃO, NÃO CAMPO SOLTO (§4). `athletes/{uid}/phases/{phaseId}` é
// registro histórico, nunca sobrescrito — só o período vigente (`endedAt`)
// muda, e só para fechar. `athletes/{uid}.phase` permanece como cópia
// desnormalizada (§4.3): é lido em toda parte que hoje já lê a fase, e só
// muda por esta função — ponto único de escrita.
//
// INVARIANTE (§4.2): no máximo UM documento com `endedAt: null` por atleta, a
// qualquer momento. Fechamento do vigente e abertura do novo na MESMA
// transação — nunca os dois passos separados, porque uma falha entre eles
// deixaria o atleta sem fase vigente nenhuma, ou com duas.
//
// CORRESPONDÊNCIA EXATA (§5.1, AF-09 do Adendo 03). `validarPlanPhase`
// (`_m2-validacao.ts`) já existe, criada para a fórmula nutricional — mesmo
// vocabulário de quatro valores, `PLAN_PHASES`, DISTINTO de `FASES_VALIDAS`
// da promoção (três valores). Reusado aqui, não duplicado.
//
// DUAS RECUSAS PRÓPRIAS (§5.2): trocar para a fase já vigente, e justificativa
// vazia. As duas voltam 409, não 400 — o corpo da requisição é bem formado;
// o que falha é uma regra de negócio sobre o estado atual.
//
// EVENTO `atleta.fase-alterada` (§6), não `atleta.status-alterado` — a
// reserva antiga nunca descreveu um ato deliberado (Adendo 06 removeu o
// campo por isso) e segue reservada, sem destino, para outro candidato.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { validarUid, validarPlanPhase, type PlanPhase } from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_FASES = "phases";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Autenticação ANTES do corpo (padrão da Fase 1, W-4). Ator sempre admin —
  // a transição de fase é ato do Coach (§6.1); este adendo não acrescenta
  // papel novo.
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

  const vUid = validarUid(corpo.athleteUid);
  if (!vUid.ok) return json(400, { erro: vUid.erro });

  const vFase = validarPlanPhase(corpo.phase);
  if (!vFase.ok) return json(400, { erro: vFase.erro });
  const novaFase: PlanPhase = corpo.phase;

  const reason = typeof corpo.reason === "string" ? corpo.reason.trim() : "";
  if (!reason) {
    return json(400, { erro: "reason é obrigatória ao trocar de fase." });
  }

  // Opcional (§4.1, §8.3): só presente quando a troca nasce da revisão do
  // relatório semanal, na aba Evolução.
  const weeklyReportWeek =
    typeof corpo.weeklyReportWeek === "number" && Number.isInteger(corpo.weeklyReportWeek)
      ? corpo.weeklyReportWeek
      : null;

  const db = getFirestore(app);
  const refAtleta = db.collection(COLECAO_ATLETAS).doc(corpo.athleteUid);
  const emHomologacao = process.env.CONTEXT !== "production";

  let faseAnterior: string | null = null;
  let novaFaseId = "";

  try {
    await db.runTransaction(async (tx) => {
      const snapAtleta = await tx.get(refAtleta);
      if (!snapAtleta.exists) {
        throw new AtletaNaoEncontrado();
      }

      faseAnterior = snapAtleta.get("phase") ?? null;
      if (faseAnterior === novaFase) {
        throw new MesmaFase();
      }

      // O vigente, se existir (§4.2). Query DENTRO da transação — mesmo
      // padrão já usado em `aprovar-sugestao.ts` para a numeração de versão.
      // Pode não existir ainda: um atleta promovido antes desta função nunca
      // teve `phases` preenchida — a rotina de retroalimentação (§7) resolve
      // isso em lote; aqui, a ausência não impede a abertura do novo período,
      // só não há o que fechar.
      const vigente = await tx.get(
        refAtleta.collection(SUBCOLECAO_FASES).where("endedAt", "==", null).limit(1),
      );

      if (!vigente.empty) {
        tx.update(vigente.docs[0].ref, {
          endedAt: FieldValue.serverTimestamp(),
          endedBy: { uid, email },
        });
      }

      const refNovo = refAtleta.collection(SUBCOLECAO_FASES).doc();
      novaFaseId = refNovo.id;
      tx.set(refNovo, {
        phase: novaFase,
        startedAt: FieldValue.serverTimestamp(),
        endedAt: null,
        startedBy: { uid, email },
        endedBy: null,
        reason,
        weeklyReportWeek,
        _test: emHomologacao,
      });

      // Cópia desnormalizada (§4.3) — ponto único de escrita.
      tx.update(refAtleta, { phase: novaFase });
    });
  } catch (e: any) {
    if (e instanceof AtletaNaoEncontrado) return json(404, { erro: "Atleta não encontrado." });
    if (e instanceof MesmaFase) {
      return json(409, { erro: "O atleta já está na fase informada.", reason: "mesma-fase" });
    }
    console.error("[alterar-fase-atleta] falha na transação:", e);
    return json(500, { erro: "Não foi possível trocar a fase agora." });
  }

  // Evento DEPOIS da transação, FORA dela (DR-06, já citado em
  // `_rastreabilidade.ts`): descreve fato consumado, best-effort, e não deve
  // desfazer uma escrita principal já bem-sucedida se a gravação do evento
  // falhar.
  const ator: Ator = { tipo: "humano", uid, email, papel: "admin" };
  await registrar({
    acao: "atleta.fase-alterada",
    ator,
    origem: "alterar-fase-atleta",
    alvo: { colecao: SUBCOLECAO_FASES, id: novaFaseId } as Alvo,
    detalhe: { de: faseAnterior, para: novaFase },
    _test: emHomologacao,
  });

  return json(200, { ok: true, phaseId: novaFaseId, phase: novaFase });
};

class AtletaNaoEncontrado extends Error {}
class MesmaFase extends Error {}
