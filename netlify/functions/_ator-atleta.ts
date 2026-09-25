// ELITE90 PRO · _ator-atleta
// -----------------------------------------------------------------------------
// Single point where a write function decides whether the caller may act AS
// the athlete. Persistence plan, common rule 3 of Phases 3, 4 and 6.
//
// WHY THIS MODULE EXISTS
// Weight (Phase 3), check-in (Phase 4) and physical evaluation (Phase 6) are
// written by the athlete. The Athlete Portal does not exist yet, so the final
// form of the athlete's credential — own account, per-athlete token — is a
// decision of the Portal front (plan §7.3). If that form changes, THIS file
// changes and the write functions do not: that is what keeps the change from
// reopening those phases.
//
// THE RULE TODAY
// `promote-lead.ts` creates (or reuses) the Firebase Auth account of the
// athlete, stores the athlete document under that same uid, and sets the
// custom claim `athlete: true`. So the caller acts as the athlete when:
//   · the verified token carries `athlete === true`, AND
//   · the token uid is the athlete uid the request is about.
// Nothing else grants it. In particular `admin` does NOT: the Coach does not
// record data on the athlete's behalf (decision of 03/09/2026, restated in plan
// §4). A professional claim does not either.
//
// THE ACTOR RETURNED already follows D-AG (Addendum 04 §6.4): `email: null`.
// -----------------------------------------------------------------------------

import type { DecodedIdToken } from "firebase-admin/auth";
import type { Ator } from "./_rastreabilidade";

export type AtorAtleta = Extract<Ator, { papel: "athlete" }>;

export type VeredictoAtorAtleta =
  | { ok: true; ator: AtorAtleta }
  | { ok: false; status: 403; erro: string; reason: "sem-papel-atleta" | "outro-atleta" };

export function verificarAtorAtleta(
  decoded: DecodedIdToken,
  athleteUid: string,
): VeredictoAtorAtleta {
  if (decoded.athlete !== true) {
    return {
      ok: false,
      status: 403,
      erro: "Somente o próprio atleta pode fazer este registro.",
      reason: "sem-papel-atleta",
    };
  }
  if (decoded.uid !== athleteUid) {
    return {
      ok: false,
      status: 403,
      erro: "O atleta só pode fazer registros em nome próprio.",
      reason: "outro-atleta",
    };
  }
  return {
    ok: true,
    ator: { tipo: "humano", uid: decoded.uid, email: null, papel: "athlete" },
  };
}
