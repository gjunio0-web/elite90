// --- ELITE90 PRO · expurgar-rastreabilidade
// Netlify Scheduled Function: retenção dos eventos de rastreabilidade.
//
// POLÍTICA (decisão DR-07, 28/08/2026, especificação RASTREABILIDADE v1.1)
//   Eventos da coleção `rastreabilidade` são removidos 24 meses após
//   `ocorridoEm`.
//
// POR QUE 24 MESES
// O prazo precisa ser maior que a janela em que uma pergunta sobre um ato ainda
// pode ser feita, e menor que o infinito. O ciclo comercial do produto é de 90
// dias, e uma homologação de base clínica — que exercício um atleta pode
// executar, que alimento entra em um plano — pode ser questionada bem depois do
// ciclo em que foi aplicada, inclusive por um dos profissionais que assinam
// tecnicamente pelo conteúdo. Vinte e quatro meses cobrem oito ciclos
// completos. O limite superior existe por custo de leitura e armazenamento, e
// pelo princípio de minimização: registro guardado além da finalidade que o
// justifica não é prudência, é passivo.
//
// ESTA É A ÚNICA REMOÇÃO ADMITIDA NA COLEÇÃO
// _rastreabilidade.ts exporta apenas `registrar`, sem edição nem exclusão — um
// registro editável não é registro (seção 5.3 da especificação). A exceção é
// aqui, e é deliberadamente uma rotina separada, agendada, que apaga por
// critério de idade e por nada mais. Não recebe corpo, não aceita filtro, não
// tem endereço público útil: não existe caminho por onde alguém escolha QUAL
// evento apagar.
//
// NÃO GRAVA EVENTO DE RASTREABILIDADE (seção 10 da especificação)
// Registrar a remoção de registros criaria uma coleção que cresce exatamente na
// medida em que tenta encolher, e o evento resultante não responde a nenhuma
// pergunta útil — ninguém pergunta quem rodou o expurgo automático. A execução
// fica no log da função, como a das demais rotinas agendadas.
//
// RELAÇÃO COM purge-rejected-leads.ts
// Rotinas independentes, com prazos e propósitos distintos: aquela apaga dados
// pessoais de candidatos recusados aos 90 dias (LGPD, Art. 16); esta apaga
// registros de operação do sistema aos 24 meses. Um evento que referencia um
// lead já expurgado PERMANECE até completar o próprio prazo (DR-08) — ele não
// contém dado pessoal, e o registro de que uma exclusão ocorreu é justamente o
// que não pode desaparecer junto com o que foi excluído.
//
// ARTEFATO DURÁVEL.

import { schedule } from "@netlify/functions";
import { Timestamp } from "firebase-admin/firestore";
import { getDb } from "./_firebase";

const RETENTION_MONTHS = 24;

/**
 * Teto de remoções por execução. O limite de um lote do Firestore é 500, e a
 * função tem tempo de execução limitado; varrer uma coleção grande de uma vez
 * arriscaria estourar os dois. Sobra fica para a execução seguinte — a rotina
 * é diária, e atraso de um dia num expurgo de 24 meses não é atraso.
 */
const MAX_POR_EXECUCAO = 500;

const handlerFn = async () => {
  const db = getDb();

  const corte = new Date();
  corte.setMonth(corte.getMonth() - RETENTION_MONTHS);
  const corteTs = Timestamp.fromDate(corte);

  try {
    // Ordenado por `ocorridoEm` para que o teto por execução remova sempre os
    // mais antigos primeiro. Sem a ordenação, uma coleção acima do teto poderia
    // deixar para trás indefinidamente os mesmos documentos.
    const snap = await db
      .collection("rastreabilidade")
      .where("ocorridoEm", "<=", corteTs)
      .orderBy("ocorridoEm", "asc")
      .limit(MAX_POR_EXECUCAO)
      .get();

    let removidos = 0;
    if (!snap.empty) {
      const lote = db.batch();
      snap.docs.forEach((d) => lote.delete(d.ref));
      await lote.commit();
      removidos = snap.size;
    }

    const resumo = {
      success: true,
      removidos,
      retencaoMeses: RETENTION_MONTHS,
      corte: corte.toISOString(),
      // Verdadeiro quando a execução bateu no teto: ainda há elegíveis, e a
      // execução de amanhã continua de onde esta parou.
      restaMais: removidos === MAX_POR_EXECUCAO,
      ranAt: new Date().toISOString(),
    };

    console.log("[expurgar-rastreabilidade]", JSON.stringify(resumo));

    return { statusCode: 200, body: JSON.stringify(resumo) };
  } catch (err: any) {
    console.error("[expurgar-rastreabilidade] erro:", err?.message ?? err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err?.message ?? "Erro interno no expurgo de rastreabilidade." }),
    };
  }
};

// Agendamento: diariamente às 03:30 UTC. Meia hora depois de
// purge-rejected-leads (03:00) de propósito — as duas varrem coleções
// diferentes e não competem, mas separá-las mantém os registros de execução
// legíveis quando algo falhar.
export const handler = schedule("30 3 * * *", handlerFn);
