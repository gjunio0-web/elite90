// ELITE90 PRO · _congelamento-nutricional
// Módulo compartilhado: retrato de alimento no instante da publicação.
//
// AC-43 (Adendo 07 v1.50), DV-6. Extraído de `publicar-plano-direto.ts`, que
// era o ÚNICO caminho de publicação que congelava alimento — `aprovar-
// sugestao.ts` gravava o conteúdo da sugestão tal como o profissional
// enviou, sem `snapshot` nem `congeladoEm`. `submeter-sugestao.ts` já
// documentava a divisão de responsabilidade ("`snapshot` e `congeladoEm` são
// produzidos na publicação, nunca vêm do profissional") — só que um dos dois
// lugares que publicam não cumpria a parte dele. CA-175: um módulo só, para
// os dois caminhos nunca divergirem de novo como divergiram desta vez.
//
// `Timestamp`, não `FieldValue.serverTimestamp()`: os itens vivem dentro de
// `meals[]` e `foods[]`, e o Firestore recusa serverTimestamp() dentro de
// array ("cannot be used inside of an array"). O carimbo é o relógio da
// função — ainda do servidor, nunca do navegador — e é o mesmo para todos os
// itens de uma publicação.

import { Timestamp } from "firebase-admin/firestore";

function congelarItemNoServidor(f: any, congeladoEm: Timestamp): Record<string, unknown> {
  const b = f?.base ?? {};
  return {
    foodId: f?.foodId ?? b.id ?? null,
    quantidadeG: f?.qty ?? null,
    nomeSnapshot: f?.name ?? null,
    medidaCaseiraSnapshot: b.medidaCaseira ?? null,
    macrosSnapshot: {
      kcal: b.kcal || 0,
      p: b.p || 0,
      c: b.c || 0,
      g: b.g || 0,
    },
    fonteSnapshot: b.categoria ? { base: "foods", categoria: b.categoria } : { base: "foods" },
    congeladoEm,
  };
}

/**
 * Congela um plano nutricional inteiro — todo alimento de toda refeição de
 * todo dia recebe `snapshot`, com o mesmo `congeladoEm` para os itens de uma
 * mesma publicação.
 *
 * Devolve um plano NOVO em vez de alterar `plano` no lugar: em
 * `publicar-plano-direto.ts` o objeto recebido é o corpo da requisição; em
 * `aprovar-sugestao.ts` é o `content` já gravado da sugestão — mutar entrada
 * não é hábito desta função, em nenhum dos dois chamadores.
 */
export function congelarPlanoNutricional(plano: any): Record<string, unknown> {
  const congeladoEm = Timestamp.now();
  const dias: Record<string, unknown> = {};
  for (const dk of Object.keys(plano?.days ?? {})) {
    const dia = plano.days[dk];
    dias[dk] = {
      ...dia,
      meals: (dia.meals ?? []).map((meal: any) => ({
        ...meal,
        foods: (meal.foods ?? []).map((f: any) => ({
          ...f,
          snapshot: congelarItemNoServidor(f, congeladoEm),
        })),
      })),
    };
  }
  return { ...plano, days: dias };
}
