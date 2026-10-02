// ELITE90 PRO · salvar-relatorio-rascunho
// -----------------------------------------------------------------------------
// Netlify Function: saves the Coach's DRAFT of one week's evolution report in
// `athletes/{uid}/weeklyReports/{wNN}` — M2 Phase 6 (persistence plan v5.26;
// schema v3, section 9, with its update note; Addendum 10 v1.4, RP-1).
//
// WHO CALLS IT
// The Coach (`admin` claim), from the report editor of the Evolução tab in
// /admin/atletas, through a throttled autosave.
//
// CONTRACT
//   POST, `Authorization: Bearer <admin ID token>`
//   { athleteUid, week: "wNN", diagnosis?, trainingAdjustments?,
//     nutritionAdjustments?, causalLinks?, idempotencyKey? }
//   200 { ok, athleteUid, week, criou, salvou, semAlteracao, duplicado, updatedAt }
//   400 malformed, text over 4,000 characters, a server-only field in the body,
//       week in the future (O9)
//   401 no/invalid token   403 not admin   404 athlete not found   405 method
//   409 no start date; report already published (`ja-publicado` — an edit after
//       publication goes through publicar-relatorio.ts, O7)
//
// THE DOCUMENT IS BORN WITH THE STRUCTURED LAYER AND THE PROVENANCE (RP-1)
// The first write creates every field of the plan's Phase 6 table: the four
// texts, `status: "draft"`, the structured layer present and empty, provenance
// `generatedBy: "coach"` with `aiOriginalDraft: null`, `promptVersion` and
// `modelVersion` null, `coachInputRefs` empty, `publishedAt` and `publishedBy`
// null. No free text in any array (CP-24). `coachAudioPaths` is never created
// (O10). Later draft saves change only the four texts and `updatedAt`.
//
// NO TRACEABILITY EVENT (plan, Phase 6 contract): saving a draft is not a
// publication — same rule as the plan draft (salvar-rascunho-plano.ts).
// -----------------------------------------------------------------------------

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import {
  validarUid,
  validarSemanaId,
  validarChaveIdempotencia,
  validarTextosRelatorio,
  textosIguais,
  camposIniciaisRelatorio,
  semanaDoRelatorioPermitida,
  dataCivilDoInicio,
  dataCivilReferencia,
  semanaDoCiclo,
  numeroDaSemana,
  type TextosRelatorio,
} from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const SUBCOLECAO_RELATORIOS = "weeklyReports";
const ORIGEM = "salvar-relatorio-rascunho";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

class AtletaNaoEncontrado extends Error {}
class Recusa409 extends Error {
  constructor(public erro: string, public reason: string) {
    super(erro);
  }
}
class Recusa400 extends Error {
  constructor(public erro: string) {
    super(erro);
  }
}

type Resultado = { criou: boolean; salvou: boolean; semAlteracao: boolean; duplicado: boolean };

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

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
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) {
    return json(400, { erro: "Corpo inválido." });
  }

  const { athleteUid, week, idempotencyKey } = corpo;
  const vUid = validarUid(athleteUid);
  if (!vUid.ok) return json(400, { erro: vUid.erro });
  const vSemana = validarSemanaId(week);
  if (!vSemana.ok) return json(400, { erro: vSemana.erro });
  const vChave = validarChaveIdempotencia(idempotencyKey);
  if (!vChave.ok) return json(400, { erro: vChave.erro });
  const vTextos = validarTextosRelatorio(corpo);
  if (!vTextos.ok) return json(400, { erro: vTextos.erro });
  const textos: TextosRelatorio = vTextos.valor;

  const db = getFirestore(app);
  const refAtleta = db.collection(COLECAO_ATLETAS).doc(athleteUid);
  const refSemana = refAtleta.collection(SUBCOLECAO_RELATORIOS).doc(week);
  const emHomologacao = process.env.CONTEXT !== "production";
  const agora = new Date();

  let resultado: Resultado;
  try {
    resultado = await db.runTransaction<Resultado>(async (tx) => {
      const snapAtleta = await tx.get(refAtleta);
      if (!snapAtleta.exists) throw new AtletaNaoEncontrado();
      const snap = await tx.get(refSemana);

      const inicio = dataCivilDoInicio(snapAtleta.get("startDate"));
      if (!inicio) {
        throw new Recusa409("O atleta não tem data de início do ciclo.", "sem-data-de-inicio");
      }
      // O9: weeks 1 to min(A, 13).
      const A = semanaDoCiclo(inicio, dataCivilReferencia(agora));
      if (!semanaDoRelatorioPermitida(numeroDaSemana(week) as number, A)) {
        throw new Recusa400(`A semana ${week} ainda não aconteceu (semana do ciclo: ${A}).`);
      }

      if (snap.exists && snap.get("status") === "published") {
        throw new Recusa409(
          "O relatório desta semana já foi publicado. A edição passa pela publicação.",
          "ja-publicado",
        );
      }
      if (snap.exists && typeof idempotencyKey === "string" && snap.get("lastIdempotencyKey") === idempotencyKey) {
        return { criou: false, salvou: false, semAlteracao: false, duplicado: true };
      }
      if (snap.exists && textosIguais(snap.data(), textos)) {
        return { criou: false, salvou: false, semAlteracao: true, duplicado: false };
      }

      const chave = idempotencyKey ? { lastIdempotencyKey: idempotencyKey } : {};
      if (!snap.exists) {
        tx.set(refSemana, {
          cycleWeek: numeroDaSemana(week),
          status: "draft",
          ...textos,
          ...camposIniciaisRelatorio(),
          publishedAt: null,
          publishedBy: null,
          updatedAt: FieldValue.serverTimestamp(),
          ...chave,
          _test: emHomologacao,
        });
        return { criou: true, salvou: true, semAlteracao: false, duplicado: false };
      }
      tx.update(refSemana, { ...textos, updatedAt: FieldValue.serverTimestamp(), ...chave });
      return { criou: false, salvou: true, semAlteracao: false, duplicado: false };
    });
  } catch (e: any) {
    if (e instanceof AtletaNaoEncontrado) return json(404, { erro: "Atleta não encontrado." });
    if (e instanceof Recusa400) return json(400, { erro: e.erro });
    if (e instanceof Recusa409) return json(409, { erro: e.erro, reason: e.reason });
    console.error(`[${ORIGEM}]`, e?.stack ?? e);
    return json(500, { erro: "Falha ao salvar o rascunho do relatório." });
  }

  // The stored instant, for the editor's "salvo às" line.
  let updatedAt: string | null = null;
  try {
    const u = (await refSemana.get()).get("updatedAt");
    if (u instanceof Timestamp) updatedAt = u.toDate().toISOString();
  } catch {
    // Display detail only; the draft is saved.
  }

  return json(200, { ok: true, athleteUid, week, ...resultado, updatedAt });
};
