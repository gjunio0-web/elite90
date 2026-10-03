// ELITE90 PRO · _autoria
// -----------------------------------------------------------------------------
// Traduz o `criadoPor` gravado nos itens do catálogo (alimentos, exercícios) no
// texto que a tela mostra no bloco "Procedência".
//
// POR QUE ESTE MÓDULO EXISTE
// `criadoPor` guarda o uid de quem criou o item, e deve guardar: o uid não muda,
// o nome e o e-mail mudam. Mas a tela exibia o valor gravado como estava, e um
// código como "PgKI9HMv…" não diz ao Coach quem propôs o item. A tradução
// acontece aqui, na LEITURA, e nunca na gravação: o documento continua com o
// identificador estável, e o nome é o de hoje.
//
// DE ONDE VEM O NOME (nesta ordem)
//   1. Conta com `professionalId` nas reivindicações → `professionals/{id}.name`,
//      o nome com que o profissional foi cadastrado.
//   2. `displayName` da conta (é o caso do Coach, que não tem cadastro de
//      profissional).
//   3. E-mail da conta. Só sai para o Coach: as listagens que chamam este módulo
//      exigem a reivindicação `admin`.
//   4. Nada resolvido (conta removida, falha de leitura) → null, e a tela mostra
//      o uid, como antes. Melhor o identificador que um nome inventado.
//
// BEST-EFFORT: falha aqui nunca derruba a listagem; o catálogo continua legível
// com o uid, que é o comportamento anterior.
// -----------------------------------------------------------------------------

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const COLECAO_PROFISSIONAIS = "professionals";
const LOTE_AUTH = 100; // limite de getUsers

/** Valor gravado pelos scripts de carga em lote (carregar-alimentos/-exercicios). */
export const AUTOR_SISTEMA = "sistema:carga-inicial";
export const ROTULO_AUTOR_SISTEMA = "Carga inicial do sistema";

export type ContaResolvida = {
  professionalId?: string | null;
  nomeProfissional?: string | null;
  displayName?: string | null;
  email?: string | null;
};

const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * Regra de escolha do rótulo. Pura, para ser testada sem Firebase.
 * Devolve null quando não há o que mostrar além do uid.
 */
export function rotuloDoAutor(uid: unknown, conta: ContaResolvida | null | undefined): string | null {
  if (uid === AUTOR_SISTEMA) return ROTULO_AUTOR_SISTEMA;
  if (!conta) return null;
  return texto(conta.nomeProfissional) ?? texto(conta.displayName) ?? texto(conta.email);
}

/**
 * Resolve os uids distintos recebidos. Devolve um mapa uid → rótulo, só com os
 * que foram resolvidos; o chamador usa o uid para os demais.
 */
export async function resolverAutores(app: any, uids: Array<unknown>): Promise<Map<string, string>> {
  const saida = new Map<string, string>();
  const unicos = [...new Set(uids.filter((u): u is string => typeof u === "string" && u.length > 0))];

  const reais: string[] = [];
  for (const u of unicos) {
    if (u === AUTOR_SISTEMA) saida.set(u, ROTULO_AUTOR_SISTEMA);
    else if (/^[a-z]+:/.test(u)) continue; // outro marcador de sistema: não é conta
    else reais.push(u);
  }
  if (!reais.length) return saida;

  try {
    const auth = getAuth(app);
    const db = getFirestore(app);
    const contas = new Map<string, ContaResolvida>();

    for (let i = 0; i < reais.length; i += LOTE_AUTH) {
      const r = await auth.getUsers(reais.slice(i, i + LOTE_AUTH).map((uid) => ({ uid })));
      for (const u of r.users) {
        const idProf = (u.customClaims as Record<string, unknown> | undefined)?.professionalId;
        contas.set(u.uid, {
          professionalId: typeof idProf === "string" ? idProf : null,
          displayName: u.displayName ?? null,
          email: u.email ?? null,
        });
      }
    }

    const ids = [...new Set([...contas.values()].map((c) => c.professionalId).filter((x): x is string => !!x))];
    if (ids.length) {
      const refs = ids.map((id) => db.collection(COLECAO_PROFISSIONAIS).doc(id));
      const snaps = await db.getAll(...refs);
      const nomes = new Map<string, string | null>();
      snaps.forEach((s: any, i: number) => nomes.set(ids[i], s.exists ? texto(s.get("name")) : null));
      for (const c of contas.values()) {
        if (c.professionalId) c.nomeProfissional = nomes.get(c.professionalId) ?? null;
      }
    }

    for (const [uid, conta] of contas) {
      const r = rotuloDoAutor(uid, conta);
      if (r) saida.set(uid, r);
    }
  } catch (e: any) {
    console.warn("[autoria] nomes não resolvidos (a tela mostra o uid):", e?.message ?? e);
  }
  return saida;
}
