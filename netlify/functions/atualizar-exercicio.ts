// ELITE90 PRO · atualizar-exercicio
// Netlify Function: escrita da coleção exercises/ a partir da tela de catálogo.
//
// Segurança: requer Firebase ID token com custom claim admin:true, no mesmo
// padrão de delete-lead.ts e promote-lead.ts.
//
// POR QUE A ESCRITA NÃO PARTE DO NAVEGADOR
// (Decisão 1 da especificação, 24/08/2026.) O firestore.rules nega escrita
// direta em exercises/, e é assim que deve permanecer: qualquer pessoa consegue
// criar conta neste projeto — o provedor de e-mail/senha está aberto e a chave
// pública está no HTML —, então "autenticado" não é "autorizado". A autorização
// real é o claim admin, e quem o confere aqui é o Admin SDK, que ignora as
// regras por ser servidor.
//
// O QUE ESTA VERSÃO FAZ, E O QUE AINDA NÃO FAZ
// Passo 1 da ordem de execução: autenticação, `editar` e `revisar`. Ficam para
// os passos seguintes `revisar-lote`, `arquivar` e `criar`.
//
// SOBRE A CHEGADA AO PORTAL
// Nada aqui regenera arquivo nem dispara publicação, e isso é consequência da
// opção C escolhida em 25/08/2026: o build passa a ler o Firestore, com o
// arquivo commitado como reserva quando o banco não responde. Com isso a
// revisão alcança o portal na próxima publicação, seja ela qual for, sem que a
// função precise escrever no repositório nem acumular disparos. O gatilho de
// build com acúmulo continua desejável por prontidão — não por correção — e é
// item próprio.
//
// ENQUANTO A OPÇÃO C NÃO ESTIVER IMPLEMENTADA, o que esta função grava fica no
// banco e não chega ao portal. Ver o item aberto na especificação.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { CAMPOS_EDITAVEIS, validarCampos } from "./_vocabulario-exercicios";

const COLECAO = "exercises";

const json = (statusCode: number, corpo: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(corpo),
});

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Autenticação antes de qualquer leitura do corpo: requisição sem token não
  // merece nem o custo de analisar o JSON, e responder de forma diferente para
  // corpo inválido revelaria que o endpoint existe a quem não deveria saber.
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };

  let uid: string;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    // O uid real é o ponto da tela existir. Até aqui, revisão era carimbada em
    // bloco por script, com o sentinela 'coach:aprovacao-lote-NN', porque não
    // havia sessão autenticada do Coach em nenhum ponto do fluxo.
    uid = decoded.uid;
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo não é JSON válido." });
  }

  const { operacao, exerciseId, campos } = corpo;
  if (!exerciseId || typeof exerciseId !== "string") {
    return json(400, { erro: "exerciseId obrigatório." });
  }
  if (operacao !== "editar" && operacao !== "revisar") {
    return json(400, { erro: `Operação não reconhecida: ${String(operacao)}. Esta versão aceita 'editar' e 'revisar'.` });
  }

  try {
    const db = getFirestore();
    const ref = db.collection(COLECAO).doc(exerciseId);
    const doc = await ref.get();
    if (!doc.exists) return json(404, { erro: "Exercício não encontrado." });

    const agora = FieldValue.serverTimestamp();

    if (operacao === "editar") {
      if (!campos || typeof campos !== "object" || Array.isArray(campos)) {
        return json(400, { erro: "campos obrigatório para 'editar'." });
      }
      const chaves = Object.keys(campos);
      if (chaves.length === 0) return json(400, { erro: "Nenhum campo para alterar." });

      // Validação de servidor. A tela também valida, mas isso é conveniência —
      // a garantia é aqui. Ver o cabeçalho de _vocabulario-exercicios.ts.
      const erros = validarCampos(campos);
      if (erros.length) return json(422, { erro: "Campos inválidos.", detalhes: erros });

      const patch: Record<string, any> = {
        atualizadoPor: uid,
        atualizadoEm: agora,
      };
      for (const c of chaves) patch[c] = campos[c];

      // Editar NÃO aprova. Corrigir uma vírgula não é atestar que o exercício
      // está pronto para o atleta — a especificação separa os dois atos de
      // propósito, e por isso revisadoPor/revisadoEm não são tocados aqui.
      await ref.update(patch);

      return json(200, {
        ok: true,
        operacao: "editar",
        exerciseId,
        alterados: chaves,
        revisado: Boolean(doc.data()?.revisadoPor),
      });
    }

    // operacao === "revisar"
    const dados = doc.data() ?? {};
    if (dados.revisadoPor) {
      // Idempotente e explícito: repetir a revisão não reescreve quem revisou
      // nem quando. Devolve 200 para que a tela não trate reenvio como erro.
      return json(200, {
        ok: true,
        operacao: "revisar",
        exerciseId,
        jaEstavaRevisado: true,
        revisadoPor: dados.revisadoPor,
      });
    }

    await ref.update({
      revisadoPor: uid,
      revisadoEm: agora,
      atualizadoPor: uid,
      atualizadoEm: agora,
      // revisarMusculo NÃO é limpo aqui, de propósito. A marca diz "a
      // classificação de músculo veio da base de origem e merece um olhar";
      // revisar em bloco um grupo inteiro não é ter olhado músculo por músculo.
      // Limpar a marca junto apagaria em silêncio o único sinal de onde ainda
      // falta conferência. Quem confere, desmarca — pela operação 'editar'.
    });

    return json(200, { ok: true, operacao: "revisar", exerciseId, revisadoPor: uid });
  } catch (e: any) {
    console.error("[atualizar-exercicio]", e?.stack ?? e);
    return json(500, { erro: "Falha ao gravar o exercício." });
  }
};

// Reexportado para a tela montar o formulário a partir da mesma lista que o
// servidor aceita, em vez de manter a sua própria.
export { CAMPOS_EDITAVEIS };
