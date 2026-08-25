// ELITE90 PRO · publicar-bases-pendentes
// -----------------------------------------------------------------------------
// Netlify Scheduled Function (ver netlify.toml). Fecha a parte da decisão 11 da
// especificação do catálogo que a opção C não cobria: opção C garante que um
// build, quando acontece, lê o Firestore fresco; esta função garante que um
// build ACONTEÇA depois de uma revisão pura, sem nenhum código mudando junto.
//
// Ver o cabeçalho de atualizar-exercicio.ts ("SOBRE A CHEGADA AO PORTAL") para
// o raciocínio completo, e _publicacao.ts para quem grava o carimbo que esta
// função lê.
//
// ACÚMULO (decisão 12) — E POR QUE NÃO É UM setTimeout
// Netlify Functions não garantem processo vivo entre invocações; um debounce
// de verdade precisa de estado que sobreviva fora do processo. Por isso o
// acúmulo mora no Firestore: cada gravação da tela AVANÇA `ultimaAlteracaoEm`
// (nunca a atrasa), e esta função, rodando em processo à parte a cada
// DEBOUNCE_MS, decide se já passou tempo suficiente desde o ÚLTIMO avanço.
// Revisar oito grupos em sequência empurra o carimbo oito vezes e produz UM
// build, não oito — exatamente o "atraso curto após a última alteração" que a
// decisão 12 pede.
//
// POR QUE O VALOR MARCADO COMO PUBLICADO É O CAPTURADO, NUNCA "AGORA"
// Entre o instante em que esta função decide publicar e o instante em que ela
// grava `publicadoEm`, uma edição nova pode chegar e avançar `ultimaAlteracaoEm`
// de novo. Se gravássemos "agora" ali, essa edição nova ficaria marcada como
// já coberta por um build que pode não tê-la capturado. Por isso o valor
// gravado é o MESMO que foi lido na decisão — e a transação abaixo confere,
// antes de gravar, que ninguém escreveu por cima nesse intervalo; se escreveu,
// esta rodada não marca nada, e a próxima checagem decide de novo, com o
// atraso contado a partir da edição nova. Pior caso: um build redundante, que é
// barato. O que este desenho evita é o caso caro — uma revisão que nunca
// alcança o build hook porque ficou marcada como "já publicada" sem ter sido.
//
// ARTEFATO DURÁVEL.
// -----------------------------------------------------------------------------

import { Timestamp } from "firebase-admin/firestore";
import { getDb } from "./_firebase";

const COLECAO = "_publicacao";

// "Atraso curto" da decisão 12. Mesmo valor do intervalo de checagem no
// netlify.toml — não precisam ser iguais, mas casar os dois evita o caso de a
// função acordar bem antes do carimbo assentar e gastar uma invocação à toa.
const DEBOUNCE_MS = 5 * 60 * 1000;

export const handler = async () => {
  const hookUrl = (process.env.NETLIFY_BUILD_HOOK_URL ?? "").trim();
  if (!hookUrl) {
    // Sem o segredo configurado, esta função não tem o que fazer. Aviso, não
    // erro: um deploy novo, antes de alguém cadastrar o build hook no painel
    // da Netlify, não deveria aparecer como falha nos logs.
    console.warn("[publicar-bases-pendentes] NETLIFY_BUILD_HOOK_URL ausente — nada a fazer.");
    return { statusCode: 200, body: "sem gatilho configurado" };
  }

  const db = getDb();
  const snap = await db.collection(COLECAO).get();
  if (snap.empty) return { statusCode: 200, body: "nenhuma base com registro de publicação" };

  const agora = Date.now();
  const devidas: { id: string; ref: FirebaseFirestore.DocumentReference; capturado: Timestamp }[] = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    const ultima: Timestamp | undefined = d.ultimaAlteracaoEm;
    if (!ultima) continue; // nunca alterada, ou carimbo antigo sem esse campo

    const publicado: Timestamp | undefined = d.publicadoEm;
    if (publicado && publicado.toMillis() >= ultima.toMillis()) continue; // já coberta

    if (agora - ultima.toMillis() < DEBOUNCE_MS) continue; // ainda assentando

    devidas.push({ id: doc.id, ref: doc.ref, capturado: ultima });
  }

  if (!devidas.length) return { statusCode: 200, body: "nada pendente além do período de acúmulo" };

  let resp: Response;
  try {
    resp = await fetch(hookUrl, { method: "POST" });
  } catch (e: any) {
    console.error("[publicar-bases-pendentes] falha de rede ao acionar o build hook:", e?.message ?? e);
    return { statusCode: 502, body: "falha de rede ao acionar o build hook" };
  }
  if (!resp.ok) {
    console.error(`[publicar-bases-pendentes] build hook recusado: HTTP ${resp.status}`);
    // Nada marcado como publicado — a próxima checagem tenta de novo.
    return { statusCode: 502, body: `build hook recusado: HTTP ${resp.status}` };
  }

  // Uma publicação regenera TODAS as bases (gerar-base.mjs sem --base), então
  // um único POST cobre todas as `devidas` — o que resta é registrar, por
  // base, que esta rodada de alteração foi coberta.
  const marcadas: string[] = [];
  await Promise.all(devidas.map(async ({ id, ref, capturado }) => {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      const atual: Timestamp | undefined = fresh.data()?.ultimaAlteracaoEm;
      if (!atual || atual.toMillis() !== capturado.toMillis()) return; // avançou nesse meio-tempo — não marca
      tx.set(ref, { publicadoEm: capturado }, { merge: true });
      marcadas.push(id);
    });
  }));

  console.log(`[publicar-bases-pendentes] build acionado — bases cobertas: ${marcadas.join(", ") || "(nenhuma confirmada, ver corrida acima)"}`);
  return { statusCode: 200, body: `build acionado — ${devidas.length} base(s) devida(s), ${marcadas.length} confirmada(s)` };
};
