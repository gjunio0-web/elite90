// ELITE90 PRO · _diagnostico-sugestoes
// -----------------------------------------------------------------------------
// Módulo compartilhado por diagnosticar-sugestao-orfa.mjs e
// limpar-sugestoes-orfas.mjs: a MESMA consulta e o MESMO critério de "órfã"
// nos dois roteiros, para que apagar nunca use uma régua diferente da que
// apontou o problema.
//
// CRITÉRIO DE ÓRFÃ: athleteUid não corresponde a documento em athletes/, ou
// professionalId não corresponde a documento em professionals/ (ou os dois).
// É exatamente essa checagem que aprovar-sugestao.ts (e, para o aviso por
// e-mail, devolver-sugestao.ts/recusar-sugestao.ts) fazem antes de agir.
// -----------------------------------------------------------------------------

export const COLECAO_SUGESTOES = 'suggestions';
export const COLECAO_ATLETAS = 'athletes';
export const COLECAO_PROFISSIONAIS = 'professionals';

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {{ todas?: boolean }} opcoes `todas: true` inclui qualquer status;
 *   por padrão só `pending` (o que /admin/aprovacoes mostra hoje).
 */
export async function listarSugestoesComDiagnostico(db, { todas = false } = {}) {
  let query = db.collection(COLECAO_SUGESTOES);
  if (!todas) query = query.where('status', '==', 'pending');
  const snap = await query.get();
  if (snap.empty) return [];

  const athleteUids = [...new Set(snap.docs.map((d) => d.get('athleteUid')).filter(Boolean))];
  const professionalIds = [...new Set(snap.docs.map((d) => d.get('professionalId')).filter(Boolean))];

  const [athleteDocs, profDocs] = await Promise.all([
    athleteUids.length
      ? db.getAll(...athleteUids.map((uid) => db.collection(COLECAO_ATLETAS).doc(uid)))
      : Promise.resolve([]),
    professionalIds.length
      ? db.getAll(...professionalIds.map((id) => db.collection(COLECAO_PROFISSIONAIS).doc(id)))
      : Promise.resolve([]),
  ]);
  const atletas = new Map(athleteDocs.map((d) => [d.id, d.exists ? d.data() : null]));
  const profissionais = new Map(profDocs.map((d) => [d.id, d.exists ? d.data() : null]));

  return snap.docs.map((doc) => {
    const d = doc.data();
    const atleta = d.athleteUid ? atletas.get(d.athleteUid) : null;
    const prof = d.professionalId ? profissionais.get(d.professionalId) : null;
    const athleteOk = !!atleta;
    const professionalOk = !!prof;
    return {
      id: doc.id,
      status: d.status ?? null,
      planType: d.planType ?? null,
      submittedAt: d.submittedAt?.toDate?.() ?? null,
      athleteUid: d.athleteUid ?? null,
      athleteOk,
      athleteName: atleta?.name ?? null,
      professionalId: d.professionalId ?? null,
      professionalOk,
      professionalName: prof?.name ?? null,
      professionalActive: professionalOk ? prof.active !== false : null,
      orfa: !athleteOk || !professionalOk,
    };
  });
}
