// ELITE90 PRO · _avisos
// -----------------------------------------------------------------------------
// Silencia, e só ele, o aviso de depreciação DEP0040 ("The `punycode` module is
// deprecated"), que enchia os registros das funções.
//
// DE ONDE VEM (06/10/2026)
// firebase-admin → @google-cloud/firestore → google-gax → node-fetch@2 →
// whatwg-url@5 → tr46 → `require("punycode")`. O Node 21+ avisa quando o módulo
// embutido é carregado, o que acontece na PRIMEIRA chamada de rede ao Firestore
// de cada instância — por isso uma linha por partida a frio. O Node escreve o
// aviso na saída de erro, e o Netlify o mostra como ERROR, embora nada tenha
// falhado: quem lê o registro procurando um erro real perde tempo com ele.
//
// POR QUE NÃO CORRIGIR NA ORIGEM: a dependência é transitiva e está fixada por
// versões do firebase-admin; trocá-la não cabe aqui. Quando uma atualização do
// firebase-admin deixar de puxar `punycode`, este módulo pode ser removido, e o
// teste em tests/avisos.test.js avisa se ele passar a não ter mais efeito
// algum (a importação em _firebase.ts é a única).
//
// ESCOPO: filtra por CÓDIGO, não por texto, e deixa passar todo o resto —
// inclusive outras depreciações, que continuam sendo informação útil.
// -----------------------------------------------------------------------------

export const CODIGOS_SILENCIADOS: ReadonlySet<string> = new Set(["DEP0040"]);

/** Código do aviso, nas duas formas de chamada de process.emitWarning. */
export function codigoDoAviso(args: unknown[]): string | undefined {
  const [, tipoOuOpcoes, codigo] = args;
  if (tipoOuOpcoes && typeof tipoOuOpcoes === "object") {
    const c = (tipoOuOpcoes as { code?: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return typeof codigo === "string" ? codigo : undefined;
}

const MARCA = Symbol.for("elite90.avisos.instalado");

export function silenciarAvisosConhecidos(): void {
  const p = process as any;
  if (p[MARCA]) return; // idempotente: o módulo pode ser empacotado em mais de uma função
  const original = p.emitWarning;
  p.emitWarning = function (...args: unknown[]) {
    const codigo = codigoDoAviso(args);
    if (codigo && CODIGOS_SILENCIADOS.has(codigo)) return;
    return original.apply(this, args);
  };
  p[MARCA] = true;
}

silenciarAvisosConhecidos();
