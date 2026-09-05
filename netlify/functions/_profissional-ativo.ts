// ELITE90 PRO · _profissional-ativo
// Módulo compartilhado da Fase 4-C do M2 — decisão AC-13 do Adendo 07.
//
// POR QUE ESTE MÓDULO EXISTE
//
// A reivindicação customizada do profissional é CACHE, não verdade. Um token de
// identidade já emitido continua válido até expirar: entre a desativação do
// cadastro e a expiração do token há uma janela em que o profissional desativado
// passaria por qualquer verificação que confie apenas no token. Revogar a
// reivindicação e derrubar as sessões — o que a desativação passou a fazer por
// AC-12 — REDUZ essa janela; não a fecha.
//
// O que a fecha é conferir o estado no documento. Por isso: toda função e toda
// projeção que sirvam a um profissional conferem
// `professionals/{professionalId}.active === true` no cadastro, e não no token.
//
// É a mesma escolha da AC-10, uma camada abaixo: garantia estrutural em vez de
// condicional. As regras do Firestore negam por padrão em vez de confiar em a
// interface nunca oferecer a opção; aqui a autorização consulta a fonte em vez
// de confiar em o token estar atualizado.
//
// POR QUE A ASSINATURA RECEBE O INSTANTÂNEO, E NÃO O IDENTIFICADOR
//
// A conferência precisa valer dentro e fora de transação. `atribuir-carteira.ts`
// já a fazia com `tx.get` — a leitura tem de participar da transação, ou a
// garantia se perde. Um módulo que buscasse o documento por conta própria
// obrigaria esse chamador a ler duas vezes, e a segunda leitura ficaria fora da
// transação, que é exatamente o que não se quer. Recebendo o instantâneo já
// lido, o módulo serve os dois casos sem ditar como buscar.
//
// A tipagem é estrutural de propósito: qualquer objeto com `exists` e `data()`
// serve, o que cobre o retorno de `tx.get` e o de `ref.get()` sem importar tipos
// do Firestore aqui.

export type VerdictoProfissional =
  | { ok: true; dados: Record<string, any> }
  | { ok: false; erro: string; reason: "nao-encontrado" | "inativo" };

interface InstantaneoLido {
  exists: boolean;
  data(): Record<string, any> | undefined;
}

/**
 * Verdito único sobre um cadastro profissional já lido.
 *
 * As mensagens são as que `atribuir-carteira.ts` já devolvia antes desta
 * extração, palavra por palavra: quem depende do texto da resposta não percebe
 * a mudança.
 */
export function conferirProfissionalAtivo(
  snap: InstantaneoLido,
): VerdictoProfissional {
  if (!snap.exists) {
    return {
      ok: false,
      erro: "Profissional não encontrado.",
      reason: "nao-encontrado",
    };
  }
  const dados = snap.data() ?? {};
  if (dados.active !== true) {
    return { ok: false, erro: "Profissional está inativo.", reason: "inativo" };
  }
  return { ok: true, dados };
}
