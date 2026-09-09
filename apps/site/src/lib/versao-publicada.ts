// ELITE90 PRO · apps/site/src/lib/versao-publicada.ts
// Módulo compartilhado: a lógica de leitura da última versão publicada, AC-27
// do Adendo 07 — separada do handler HTTP para servir DOIS consumidores por
// DOIS protocolos diferentes, sem duplicar a consulta.
//
// POR QUE MORA EM apps/site/src/lib, E NÃO EM netlify/functions
//
// A primeira tentativa pôs este módulo em `netlify/functions/_buscar-versao-
// publicada.ts`, com `plano/[token].astro` importando-o por caminho relativo.
// `astro check` recusou: `apps/site/tsconfig.json` declara `include: ["**/*"]`
// — SEM prefixo de diretório —, o que o TypeScript resolve como "tudo dentro
// de apps/site/", não "tudo no repositório". Um arquivo fora dali, mesmo com
// caminho relativo válido no sistema de arquivos, fica invisível para aquele
// projeto de tipos.
//
// A direção inversa funciona: `apps/site/src/lib/` já é lido por este
// tsconfig — é onde `plano-documento.ts` mora, e esta mesma página já o
// importa de lá. `netlify/functions/*.ts`, empacotadas por esbuild
// (`@netlify/zip-it-and-ship-it`), resolvem imports relativos livremente,
// sem a mesma restrição de `include` — confirmado por `zipFunctions()` depois
// desta mudança.
//
// POR QUE UM MÓDULO SÓ, E NÃO DOIS
//
// Os dois consumidores não falam a mesma língua de transporte:
//
//   - A gaveta do Coach roda no NAVEGADOR e chama por `fetch`, como qualquer
//     outra função — usa o handler HTTP em `netlify/functions/buscar-versao-
//     publicada.ts`, que importa este módulo.
//   - `plano/[token].astro` roda em SSR, no MESMO PROCESSO de servidor que
//     executaria a função HTTP. Fazer um `fetch` dali para uma função irmã
//     seria uma chamada de rede que sai do servidor e volta para ele, sem
//     necessidade — latência e ponto de falha a mais, para o mesmo processo
//     conversar consigo mesmo. Importa esta função diretamente.
//
// A lógica mora aqui uma vez só; os dois protocolos de acesso são casca fina
// por cima dela. Isso cumpre a CA-68 no que importa — a CONSULTA não se
// duplica — sem forçar SSR a fazer HTTP interno.
//
// SEM GUARDA DE AUTORIZAÇÃO AQUI DENTRO — MAS OS DOIS CONSUMIDORES PRECISAM
// DA SUA PRÓPRIA (CORREÇÃO DE SEGURANÇA NA REVISÃO DO AC-27)
//
// Este módulo não decide quem pode chamá-lo — cada consumidor decide isso por
// si, pela razão de sempre (esta função nem tem acesso a headers HTTP). O
// engano da primeira versão foi supor que NENHUM dos dois precisa negar
// nada, por analogia com a página pública: lá, o "token" que autoriza é
// aleatório e de uso único (compartilhar-plano.ts, randomBytes) — não o
// athleteUid, que é identificador de documento comum, já devolvido ao
// cliente do profissional em toda projeção (D-14, nível 1 incluído). O
// handler HTTP (buscar-versao-publicada.ts) RECEBE athleteUid, não um token
// de capacidade, e por isso precisa conferir quem está perguntando — vê o
// cabeçalho dele para a guarda (Coach, ou profissional com atribuição ativa
// no par). Só o consumidor SSR (`plano/[token].astro`) segue sem guarda
// própria aqui: a AUTORIZAÇÃO dele já aconteceu antes de chegar a esta
// função — resolver o atleta pelo token aleatório da URL.

import { getFirestore, type Firestore } from "firebase-admin/firestore";

const COLECAO_ATLETAS = "athletes";

export type VersaoPublicada = {
  id: string;
  content: Record<string, unknown> | null;
  originatedBy: Record<string, unknown> | null;
  publishedBy: Record<string, unknown> | null;
  publishedAt: string | null;
};

export type ResultadoBusca =
  | { existe: true; versao: VersaoPublicada }
  | { existe: false; versao: null };

/**
 * A mesma consulta que `publicar-plano-direto.ts` e `aprovar-sugestao.ts` usam
 * para numerar a próxima versão: `orderBy("__name__", "desc").limit(1)`. Exige
 * o índice declarado em `firestore.indexes.json` para a coleção `versions`.
 */
export async function buscarVersaoPublicada(
  db: Firestore,
  athleteUid: string,
  planType: string,
): Promise<ResultadoBusca> {
  const refVersoes = db
    .collection(COLECAO_ATLETAS).doc(athleteUid)
    .collection("plans").doc(planType)
    .collection("versions");

  const snap = await refVersoes.orderBy("__name__", "desc").limit(1).get();

  if (snap.empty) {
    return { existe: false, versao: null };
  }

  const doc = snap.docs[0];
  const dados = doc.data();

  return {
    existe: true,
    versao: {
      id: doc.id,
      content: dados.content ?? null,
      originatedBy: dados.originatedBy ?? null,
      publishedBy: dados.publishedBy ?? null,
      // Timestamp do servidor não serializa para JSON sem conversão explícita
      // — necessário para o handler HTTP; inofensivo para o consumidor SSR,
      // que também prefere string a lidar com o tipo do Admin SDK na marcação.
      publishedAt: dados.publishedAt?.toDate
        ? dados.publishedAt.toDate().toISOString()
        : null,
    },
  };
}
