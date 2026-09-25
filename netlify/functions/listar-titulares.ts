// ELITE90 PRO · listar-titulares
// Netlify Function: leitura do estado de titularidade por especialidade, para a
// tela administrativa da Fase 4-D.
//
// Adendo 09, AT-19 — e a peça sem a qual dois dos três estados que a AT-08
// manda declarar não seriam sequer possíveis.
//
// POR QUE ESTA FUNÇÃO EXISTE
// Cinco funções tocam `config/delegationDefaults` — definir-titular.ts,
// trocar-titular.ts, remover-titular.ts, promote-lead.ts e o comentário de
// _rastreabilidade.ts —, e TODAS escrevem ou leem internamente para decidir:
// nenhuma devolve o estado ao navegador. E as regras fecham a coleção ao
// cliente (AT-11), sem exceção para admin. Sem esta função, a tela não teria
// como saber quem é titular.
//
// POR QUE NÃO AMPLIAR `listar-profissionais.ts`
// Aquele arquivo se declara, no próprio cabeçalho, contrato provisório da Fase
// 4-B — "DECISÃO DE FORMA desta fase, não leitura de norma". Misturar
// titularidade ali alteraria um contrato que outra fase assumiu como seu, e
// obrigaria a tela a desmontar uma resposta servindo a dois propósitos.
//
// ISTO NÃO REABRE A AT-11. A configuração continua fechada ao navegador; o que
// muda é que passa a existir uma função de servidor que a lê e devolve o que a
// tela precisa — que é exatamente o padrão que a AT-11 determina.
//
// ┌── AS DUAS PERGUNTAS TÊM CUSTO MUITO DIFERENTE ─────────────────────────────┐
// │                                                                            │
// │ "QUEM É TITULAR" é leitura de UM documento, mais um `getAll` de no máximo  │
// │ dois profissionais. Barata, sempre, em qualquer tamanho de base.           │
// │                                                                            │
// │ "QUANTOS ATLETAS SEM VÍNCULO" exige ler `athletes` e `assignments`         │
// │ INTEIRAS e cruzar em memória — o Firestore não tem consulta nativa de      │
// │ "documento sem vínculo correspondente". É a mesma junção que               │
// │ definir-titular.ts já faz internamente, pela mesma razão.                  │
// │                                                                            │
// │ NÃO É CARO NA BASE DE HOJE. Se um dia for, O QUE SE CORTA É A CONTAGEM —   │
// │ por paginação, cache ou contador mantido na escrita —, NÃO A FUNÇÃO        │
// │ INTEIRA. A metade barata continuaria barata. Este parágrafo existe para    │
// │ que essa decisão futura não sacrifique as duas por precaução com uma.      │
// └────────────────────────────────────────────────────────────────────────────┘
//
// A AMOSTRA DE ATLETAS, E POR QUE NÃO A LISTA COMPLETA
// A resposta traz a contagem e os primeiros `LIMITE_AMOSTRA` atletas sem
// vínculo, com `haMais` indicando se ficaram outros de fora. A amostra sai de
// graça: os documentos já foram lidos para a contagem, e devolvê-los é só não
// descartá-los. Mas a LISTA COMPLETA não é oferecida de propósito — atribuir
// carteira a partir dela é a ADM-14, que o §9 do adendo põe fora do escopo
// desta fase, e um contrato de listagem completa criaria promessa que a
// paginação futura teria de honrar.
//
// SEM EVENTO DE RASTREABILIDADE
// Leitura não é fato que a rastreabilidade exista para preservar (Adendo 02,
// seção 7.3) — mesma razão registrada em listar-profissionais.ts.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { SPECIALTIES } from "./_m2-validacao";

const COLECAO_ATLETAS = "athletes";
const COLECAO_ASSIGNMENTS = "assignments";
const COLECAO_PROFISSIONAIS = "professionals";
const COLECAO_CONFIG = "config";
const DOC_DELEGACAO = "delegationDefaults";

/**
 * Quantos atletas sem vínculo acompanham a contagem.
 *
 * Vinte é o bastante para a tela mostrar quem são ao clicar na contagem, sem
 * transformar a resposta em listagem. Acima disso, `haMais` fica verdadeiro e a
 * tela diz que há mais — não paginamos aqui, porque paginação sem tela que a
 * consuma é contrato sem consumidor.
 */
const LIMITE_AMOSTRA = 20;

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

/** O estado do titular de uma especialidade, do ponto de vista da tela. */
type EstadoTitular = {
  specialty: string;
  /** `null` quando a especialidade não tem titular — estado VÁLIDO (AT-08). */
  titular: {
    professionalId: string;
    name: string | null;
    /**
     * O `active` lido do CADASTRO, não da configuração. É este cruzamento que
     * produz o estado "titular desativado" que a AT-08 manda sinalizar: a
     * configuração registra a decisão de quem é titular, e o cadastro é a
     * verdade sobre o profissional (AC-13).
     */
    active: boolean;
    /** Verdadeiro quando o cadastro do titular não existe mais. */
    ausente: boolean;
    definedAt: string | null;
  } | null;
  /** Atletas sem vínculo ativo NESTA especialidade. */
  atletasSemProfissional: {
    total: number;
    amostra: { athleteUid: string; name: string | null }[];
    haMais: boolean;
  };
  /**
   * Atletas com vínculo ativo NESTA especialidade, mas cujo profissional
   * responsável está desativado (ou o cadastro não existe mais). O vínculo em
   * si continua com `endedAt: null` — não é "sem profissional" (AT-08) —, mas
   * na prática ninguém responde por aquele atleta ali, e isso ficava invisível
   * para o Coach: nem a contagem de "sem profissional" pega esse caso (o
   * atleta TEM vínculo), nem a carteira do profissional desativado aparece em
   * destaque na tela para alguém pensar em conferir.
   */
  atletasComProfissionalInativo: {
    total: number;
    amostra: { athleteUid: string; name: string | null; professionalId: string; professionalName: string | null }[];
    haMais: boolean;
  };
};

/** Carimbo do Firestore vira ISO; a tela só precisa exibir. */
function isoOuNulo(v: unknown): string | null {
  if (v && typeof (v as any).toDate === "function") {
    return (v as { toDate(): Date }).toDate().toISOString();
  }
  return null;
}

/**
 * Monta o estado de uma especialidade a partir do que já foi lido. Pura de
 * propósito, como `filtrar` em listar-profissionais.ts: testável sem Firestore
 * nem token.
 */
export function montarEstado(
  specialty: string,
  titularBruto: { professionalId?: unknown; definedAt?: unknown } | undefined,
  cadastros: Map<string, { name?: unknown; active?: unknown }>,
  atletas: { athleteUid: string; name: string | null }[],
  vinculoAtivoPor: Map<string, string>,
): EstadoTitular {
  const professionalId = titularBruto?.professionalId
    ? String(titularBruto.professionalId)
    : null;

  let titular: EstadoTitular["titular"] = null;
  if (professionalId) {
    const cadastro = cadastros.get(professionalId);
    titular = {
      professionalId,
      name: cadastro?.name ? String(cadastro.name) : null,
      // Cadastro ausente conta como inativo: a tela não deve exibir como ativo
      // um titular cujo documento não existe mais.
      active: cadastro ? cadastro.active === true : false,
      ausente: !cadastro,
      definedAt: isoOuNulo(titularBruto?.definedAt),
    };
  }

  const sem = atletas.filter((a) => !vinculoAtivoPor.has(a.athleteUid));

  // Mesmo cruzamento cadastro-vs-configuração do titular (AC-13, comentário
  // acima): o vínculo registra QUEM foi atribuído, o cadastro do profissional
  // é a verdade sobre se ele responde por alguém hoje.
  const comInativo = atletas
    .map((a) => ({ atleta: a, professionalId: vinculoAtivoPor.get(a.athleteUid) }))
    .filter((x): x is { atleta: typeof x.atleta; professionalId: string } => {
      if (!x.professionalId) return false;
      const cadastro = cadastros.get(x.professionalId);
      return !cadastro || cadastro.active !== true;
    })
    .map((x) => ({
      athleteUid: x.atleta.athleteUid,
      name: x.atleta.name,
      professionalId: x.professionalId,
      professionalName: cadastros.get(x.professionalId)?.name
        ? String(cadastros.get(x.professionalId)!.name)
        : null,
    }));

  return {
    specialty,
    titular,
    atletasSemProfissional: {
      total: sem.length,
      amostra: sem.slice(0, LIMITE_AMOSTRA),
      haMais: sem.length > LIMITE_AMOSTRA,
    },
    atletasComProfissionalInativo: {
      total: comInativo.length,
      amostra: comInativo.slice(0, LIMITE_AMOSTRA),
      haMais: comInativo.length > LIMITE_AMOSTRA,
    },
  };
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

  const db = getFirestore(app);

  try {
    // -- A metade barata (config) e a metade cara (as duas coleções inteiras),
    // em paralelo: nenhuma depende do resultado da outra até o cruzamento. --
    const [configSnap, atletasSnap, ativosSnap] = await Promise.all([
      db.collection(COLECAO_CONFIG).doc(DOC_DELEGACAO).get(),
      db.collection(COLECAO_ATLETAS).get(),
      db.collection(COLECAO_ASSIGNMENTS).where("endedAt", "==", null).get(),
    ]);
    const config = configSnap.exists ? (configSnap.data() ?? {}) : {};

    const idsTitulares = SPECIALTIES.map((s) => (config as any)[s]?.professionalId).filter(Boolean).map(String);
    // Além dos titulares, todo profissional com vínculo ativo agora — é
    // contra ESTE cadastro que atletasComProfissionalInativo se decide, não só
    // contra quem está configurado como titular.
    const idsComVinculo = ativosSnap.docs.map((d) => String(d.get("professionalId"))).filter(Boolean);
    const idsProfissionais = [...new Set([...idsTitulares, ...idsComVinculo])];

    const cadastros = new Map<string, { name?: unknown; active?: unknown }>();
    if (idsProfissionais.length) {
      const refs = idsProfissionais.map((id) => db.collection(COLECAO_PROFISSIONAIS).doc(id));
      const snaps = await db.getAll(...refs);
      for (const s of snaps) {
        if (s.exists) cadastros.set(s.id, s.data() as any);
      }
    }

    const atletas = atletasSnap.docs.map((d) => ({
      athleteUid: d.id,
      name: (d.data() ?? {}).name ? String((d.data() as any).name) : null,
    }));

    // Um mapa athleteUid → professionalId por especialidade (RN-10: no máximo
    // um vínculo ativo por par atleta+especialidade, então não há ambiguidade
    // em guardar só o último visto), para não varrer os vínculos duas vezes.
    const porEspecialidade = new Map<string, Map<string, string>>();
    for (const s of SPECIALTIES) porEspecialidade.set(s, new Map<string, string>());
    for (const d of ativosSnap.docs) {
      const mapa = porEspecialidade.get(String(d.get("specialty")));
      if (mapa) mapa.set(String(d.get("athleteUid")), String(d.get("professionalId")));
    }

    const estados = SPECIALTIES.map((s) =>
      montarEstado(
        s,
        (config as any)[s],
        cadastros,
        atletas,
        porEspecialidade.get(s) ?? new Map<string, string>(),
      ),
    );

    return json(200, {
      especialidades: estados,
      totalAtletas: atletas.length,
      limiteAmostra: LIMITE_AMOSTRA,
    });
  } catch (e) {
    console.error("[listar-titulares] falha ao ler:", e);
    return json(500, { erro: "Não foi possível ler o estado de titularidade." });
  }
};
