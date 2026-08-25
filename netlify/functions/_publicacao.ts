// ELITE90 PRO · _publicacao
// -----------------------------------------------------------------------------
// Marca uma base de domínio como tendo alteração pendente de publicação. Lido
// por publicar-bases-pendentes.ts, a função agendada que decide quando acionar
// o build hook do Netlify.
//
// POR QUE ISTO EXISTE (26/08/2026)
// A opção C (scripts/gerar-base.mjs --se-possivel) resolveu a metade "o build
// lê o Firestore" da decisão 11 da especificação do catálogo. Ela não resolve
// a outra metade: algo precisa CAUSAR um build depois de uma revisão pura, sem
// código mudando junto — sem isso, a revisão fica no banco e nunca alcança o
// atleta. Ver o cabeçalho de atualizar-exercicio.ts, "SOBRE A CHEGADA AO
// PORTAL", para o raciocínio completo.
//
// POR QUE UM CARIMBO NO FIRESTORE, E NÃO ESTADO EM MEMÓRIA
// Netlify Functions não garantem processo vivo entre invocações — um debounce
// com setTimeout morreria com o container assim que a função retornasse. O
// carimbo sobrevive porque mora no banco: cada gravação da tela avança
// `ultimaAlteracaoEm`, e a função agendada (que roda em processo à parte, sem
// relação com o daquela gravação) decide, ao acordar, se já passou tempo
// suficiente desde o último avanço.
//
// POR QUE `chave === baseId` DA TABELA DE gerar-base.mjs
// Generaliza para qualquer base de domínio, não só exercícios — o mesmo
// raciocínio de "uma tabela, não uma cópia por base" que já vale para
// filtrar-bases.mjs e gerar-base.mjs. Hoje só `atualizar-exercicio.ts` chama
// isto, com baseId 'exercicios'; quando alimentos ganhar função de escrita
// própria, ela chama a MESMA função, com 'alimentos'.
//
// ARTEFATO DURÁVEL.
// -----------------------------------------------------------------------------

import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "./_firebase";

const COLECAO = "_publicacao";

/**
 * Avança `ultimaAlteracaoEm` da base. Best-effort: uma falha aqui NÃO deve
 * derrubar a operação que a chamou — a gravação principal (editar, revisar,
 * criar...) já aconteceu e já é verdadeira; perder o sinal de "publique depois"
 * é pior sorte, não motivo para responder erro a uma escrita que deu certo.
 */
export async function marcarPendente(baseId: string): Promise<void> {
  try {
    await getDb().collection(COLECAO).doc(baseId).set(
      { ultimaAlteracaoEm: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch (e: any) {
    console.error(`[_publicacao] falha ao marcar "${baseId}" como pendente — a gravação principal seguiu normalmente:`, e?.stack ?? e);
  }
}
