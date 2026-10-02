// ELITE90 PRO · publicar-relatorio
// -----------------------------------------------------------------------------
// Netlify Function: publishes one week's evolution report, or corrects a report
// already published — M2 Phase 6 (persistence plan v5.26; schema v3, section 9,
// with its update note; Addendum 04 v1.12, §6.2 and §6.3; Addendum 10 v1.4).
//
// WHO CALLS IT
// The Coach (`admin` claim), from the Evolução tab in /admin/atletas.
// Publication is always an act of the Coach (schema §11): no AI exists in this
// phase, and the report is born `generatedBy: "coach"`.
//
// CONTRACT
//   POST, `Authorization: Bearer <admin ID token>`
//   { athleteUid, week: "wNN", diagnosis?, trainingAdjustments?,
//     nutritionAdjustments?, causalLinks?, idempotencyKey? }
//   200 { ok, athleteUid, week, publicou, corrigiu, semAlteracao, duplicado,
//         publishedAt, updatedAt }
//   400 malformed, no text at all, text over 4,000 characters, a server-only
//       field in the body, week in the future (O9)
//   401 no/invalid token   403 not admin   404 athlete not found   405 method
//   409 no start date
//
// FIRST PUBLICATION vs CORRECTION (O7) — decided from the document's state at
// write time, never from earlier events:
//   · no document, or a draft → `status: "published"`, `publishedAt` (server)
//     and `publishedBy: { uid, role }` (O8 — no e-mail, no name), the texts,
//     `updatedAt`. Event 'relatorio.publicado'.
//   · already published, different text → the texts and `updatedAt` change;
//     `publishedAt` and `publishedBy` keep the first publication. Event
//     'relatorio.corrigido'.
//   · already published, identical text → nothing is written, nothing emitted.
// A report created here directly (no draft saved before) is born with every
// field of the structured layer and the provenance, like a draft (RP-1).
//
// THE ATHLETE DOES NOT READ IT YET
// Reading the published report and notifying the athlete belong to the Athlete
// Portal front (plan §7.3). Publishing here notifies no one.
//
// TRACEABILITY (Addendum 04 v1.12, §6.3; D-AR)
// After the transaction, best-effort (DR-06). Actor `{ tipo: "humano", uid,
// email, papel: "admin" }` (DR-09). Target `{ colecao: "weeklyReports",
// id: "<athlete uid>/wNN" }` (§6.5, CE-10). No `detalhe`: the texts are free
// text about the athlete (DR-04, R2).
// -----------------------------------------------------------------------------

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator } from "./_rastreabilidade";
import {
  validarUid,
  validarSemanaId,
  validarChaveIdempotencia,
  validarTextosRelatorio,
  temAlgumTexto,
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
const ORIGEM = "publicar-relatorio";

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

type Resultado = { publicou: boolean; corrigiu: boolean; semAlteracao: boolean; duplicado: boolean };

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

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
  if (!temAlgumTexto(textos)) {
    return json(400, { erro: "O relatório precisa de ao menos um texto para ser publicado." });
  }

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
      const A = semanaDoCiclo(inicio, dataCivilReferencia(agora));
      if (!semanaDoRelatorioPermitida(numeroDaSemana(week) as number, A)) {
        throw new Recusa400(`A semana ${week} ainda não aconteceu (semana do ciclo: ${A}).`);
      }

      if (snap.exists && typeof idempotencyKey === "string" && snap.get("lastIdempotencyKey") === idempotencyKey) {
        return { publicou: false, corrigiu: false, semAlteracao: false, duplicado: true };
      }

      const chave = idempotencyKey ? { lastIdempotencyKey: idempotencyKey } : {};
      const publicacao = {
        status: "published",
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: { uid, role: "admin" },
      };

      if (!snap.exists) {
        tx.set(refSemana, {
          cycleWeek: numeroDaSemana(week),
          ...textos,
          ...camposIniciaisRelatorio(),
          ...publicacao,
          updatedAt: FieldValue.serverTimestamp(),
          ...chave,
          _test: emHomologacao,
        });
        return { publicou: true, corrigiu: false, semAlteracao: false, duplicado: false };
      }

      if (snap.get("status") !== "published") {
        tx.update(refSemana, { ...textos, ...publicacao, updatedAt: FieldValue.serverTimestamp(), ...chave });
        return { publicou: true, corrigiu: false, semAlteracao: false, duplicado: false };
      }

      if (textosIguais(snap.data(), textos)) {
        return { publicou: false, corrigiu: false, semAlteracao: true, duplicado: false };
      }
      tx.update(refSemana, { ...textos, updatedAt: FieldValue.serverTimestamp(), ...chave });
      return { publicou: false, corrigiu: true, semAlteracao: false, duplicado: false };
    });
  } catch (e: any) {
    if (e instanceof AtletaNaoEncontrado) return json(404, { erro: "Atleta não encontrado." });
    if (e instanceof Recusa400) return json(400, { erro: e.erro });
    if (e instanceof Recusa409) return json(409, { erro: e.erro, reason: e.reason });
    console.error(`[${ORIGEM}]`, e?.stack ?? e);
    return json(500, { erro: "Falha ao publicar o relatório." });
  }

  if (resultado.publicou || resultado.corrigiu) {
    const ator: Ator = { tipo: "humano", uid, email, papel: "admin" };
    await registrar({
      acao: resultado.corrigiu ? "relatorio.corrigido" : "relatorio.publicado",
      ator,
      // D-AR: the athlete uid in the target, because the actor is the Coach.
      alvo: { colecao: SUBCOLECAO_RELATORIOS, id: `${athleteUid}/${week}` },
      origem: ORIGEM,
      ...(emHomologacao ? { _test: true } : {}),
    });
  }

  // The stored instants, for the panel's "publicado em" line.
  let publishedAt: string | null = null;
  let updatedAt: string | null = null;
  try {
    const d = await refSemana.get();
    const p = d.get("publishedAt");
    const u = d.get("updatedAt");
    if (p instanceof Timestamp) publishedAt = p.toDate().toISOString();
    if (u instanceof Timestamp) updatedAt = u.toDate().toISOString();
  } catch {
    // Display detail only; the report is published.
  }

  return json(200, { ok: true, athleteUid, week, ...resultado, publishedAt, updatedAt });
};
