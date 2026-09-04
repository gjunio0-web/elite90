// ELITE90 PRO · listar-profissionais
// Netlify Function: leitura da coleção professionals/, Fase 4-B do M2.
//
// PROCEDÊNCIA DESTA FUNÇÃO — DIFERENTE DAS OUTRAS DUAS LEITURAS DO REPOSITÓRIO
// listar-alimentos.ts e listar-exercicios.ts nasceram de telas já
// especificadas, com estados de curadoria definidos em documento próprio. Não
// há tela especificada para o cadastro profissional nesta fase: o Adendo 02 —
// Delegação, seção 1, põe a interface no M4, ainda em fe:0/be:0 (backlog,
// surface DEL, sprint S9). Esta função existe para permitir a averiguação da
// Fase 4-B e o trabalho de quem vier a atribuir carteira, sem esperar pelo M4.
// O contrato abaixo — dois filtros opcionais, sem paginação, sem busca
// textual — é DECISÃO DE FORMA desta fase, não leitura de norma. Quando o M4
// especificar a tela, este contrato pode precisar mudar para atendê-la.
//
// Segurança: requer Firebase ID token com custom claim admin:true, no mesmo
// padrão de cadastrar-profissional.ts.
//
// SOBRE LER A COLEÇÃO INTEIRA
// Mesma escolha de listar-alimentos.ts e listar-exercicios.ts, por razão mais
// forte aqui: a equipe do Coach é de poucas pessoas, e filtro de igualdade por
// `active` ou por item de `specialties` no Firestore exigiria índice composto
// para um volume que não o justifica. Ver o comentário equivalente naqueles
// dois arquivos se este ponto precisar ser revisitado.
//
// SEM EVENTO DE RASTREABILIDADE
// Leitura não é fato que a rastreabilidade exista para preservar (Adendo 02,
// seção 7.3) — só os três atos que alteram o cadastro geram evento.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { SPECIALTIES, type Specialty } from "./_m2-validacao";

const COLECAO = "professionals";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

/**
 * Cadastro como esta função o devolve. Lista de PERMITIDOS: um campo novo no
 * documento fica de fora até que alguém o inclua aqui de propósito.
 */
export type ProfissionalListado = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  council: string;
  councilNumber: string;
  councilState: string | null;
  classification: string;
  specialties: string[];
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

/** Carimbo do Firestore vira ISO; a tela só precisa exibir. */
function isoOuNulo(v: unknown): string | null {
  if (v && typeof (v as any).toDate === "function") {
    return (v as { toDate(): Date }).toDate().toISOString();
  }
  return null;
}

/**
 * Recorta a coleção conforme os filtros. Pura de propósito, como a função
 * equivalente em listar-exercicios.ts: testável sem Firestore nem token.
 */
export function filtrar(
  todos: ProfissionalListado[],
  o: { active?: boolean; specialty?: Specialty },
): ProfissionalListado[] {
  let itens = todos;
  if (o.active !== undefined) itens = itens.filter((p) => p.active === o.active);
  if (o.specialty) itens = itens.filter((p) => p.specialties.includes(o.specialty!));
  return [...itens].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };
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
    return json(400, { erro: "Corpo não é JSON válido." });
  }

  let active: boolean | undefined;
  if (corpo.active !== undefined) {
    if (typeof corpo.active !== "boolean") {
      return json(400, { erro: "active, se enviado, precisa ser booleano." });
    }
    active = corpo.active;
  }

  let specialty: Specialty | undefined;
  if (corpo.specialty !== undefined) {
    if (!SPECIALTIES.includes(corpo.specialty)) {
      return json(400, {
        erro: `specialty fora do vocabulário. Esperado um de: ${SPECIALTIES.join(", ")}.`,
      });
    }
    specialty = corpo.specialty;
  }

  try {
    const db = getFirestore(app);
    const snap = await db.collection(COLECAO).get();

    const todos: ProfissionalListado[] = snap.docs.map((d) => {
      const x = d.data() as Record<string, any>;
      return {
        id: d.id,
        name: x.name,
        email: x.email,
        phone: x.phone ?? null,
        council: x.council,
        councilNumber: x.councilNumber,
        councilState: x.councilState ?? null,
        classification: x.classification,
        specialties: Array.isArray(x.specialties) ? x.specialties : [],
        active: x.active === true,
        createdAt: isoOuNulo(x.createdAt),
        updatedAt: isoOuNulo(x.updatedAt),
      };
    });

    const itens = filtrar(todos, { active, specialty });
    return json(200, { itens, encontrados: itens.length });
  } catch (e) {
    console.error("[listar-profissionais] falha ao ler:", e);
    return json(500, { erro: "Não foi possível listar os profissionais." });
  }
};
