// ELITE90 PRO · atualizar-alimento
// Netlify Function: escrita da coleção foods/ a partir da tela de curadoria.
//
// Segurança: requer Firebase ID token com custom claim admin:true, mesmo
// padrão de atualizar-exercicio.ts, que este arquivo espelha — "espelhe, não
// redesenhe" (repasse "tela de revisão da base de alimentos", 26/08/2026).
//
// POR QUE A ESCRITA NÃO PARTE DO NAVEGADOR
// Mesmo motivo de atualizar-exercicio.ts: o firestore.rules nega escrita
// direta em foods/, e "autenticado" não é "autorizado" — a autorização real é
// o claim admin, conferido aqui pelo Admin SDK, que ignora as regras por ser
// servidor.
//
// OPERAÇÕES NESTA RODADA: `editar`, `revisar`, `desrevisar`.
// A especificação (seção 6) prevê oito operações, iguais às de exercícios:
// criar, editar, revisar, desrevisar, revisar-lote, desrevisar-lote, arquivar,
// desarquivar. A ordem de execução (seção 8) deliberadamente adia cinco delas:
// revisar-lote/desrevisar-lote (passo 4), arquivar/desarquivar (passo 7) e
// criar (passo 9, com a validação de coerência calórica). Incluí desrevisar
// já nesta rodada, um passo à frente do texto literal do passo 2 — sem ela a
// gaveta ficaria com "marcar como revisado" mas sem desfazer, e as duas
// operações de exercícios sempre andaram juntas por serem a mesma decisão.
//
// A DIFERENÇA REAL EM RELAÇÃO A atualizar-exercicio.ts
// validarCampos aqui recebe a fonte do documento (ver _vocabulario-alimentos.ts):
// macros só é gravável em item de curadoria própria. Como `criar` ainda não
// existe, todo documento hoje tem fonte === FONTE_TACO, e editar macros é
// sempre recusado nesta rodada — o que é o comportamento correto até o passo 9
// existir.
//
// nomeBusca É RECALCULADO AQUI, NÃO SÓ POR scripts/carregar-alimentos.mjs
// Editar nomeExibicao sem atualizar nomeBusca deixaria o catálogo publicado
// (que lê nomeBusca do documento, sem recalcular) buscando pelo nome antigo.
// Ver normalizarNomeBusca em _vocabulario-alimentos.ts.
//
// SOBRE A CHEGADA AO PORTAL
// Mesmo mecanismo de exercícios: nada aqui regenera arquivo nem publica
// diretamente. Todo build já lê o Firestore direto (opção C, generalizada em
// scripts/gerar-base.mjs), e toda gravação real chama
// marcarPendente("alimentos") — a mesma função genérica que exercícios usa,
// como o próprio cabeçalho de _publicacao.ts já antecipava.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { CAMPOS_EDITAVEIS, validarCampos, normalizarNomeBusca } from "./_vocabulario-alimentos";
import { marcarPendente } from "./_publicacao";

const COLECAO = "foods";

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

  // Autenticação antes de qualquer leitura do corpo — mesma razão do
  // cabeçalho de atualizar-exercicio.ts.
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Unauthorized" };

  let uid: string;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
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

  const { operacao, foodId, campos } = corpo;

  const OPERACOES_NESTA_RODADA = ["editar", "revisar", "desrevisar"];
  if (!OPERACOES_NESTA_RODADA.includes(operacao)) {
    return json(400, {
      erro: `Operação não reconhecida ou ainda não implementada: ${String(operacao)}. Aceitas nesta rodada: 'editar', 'revisar', 'desrevisar'.`,
    });
  }
  if (!foodId || typeof foodId !== "string") {
    return json(400, { erro: "foodId obrigatório." });
  }

  try {
    const db = getFirestore();
    const ref = db.collection(COLECAO).doc(foodId);
    const doc = await ref.get();
    if (!doc.exists) return json(404, { erro: "Alimento não encontrado." });

    const dados = doc.data() ?? {};
    const agora = FieldValue.serverTimestamp();

    if (operacao === "editar") {
      if (!campos || typeof campos !== "object" || Array.isArray(campos)) {
        return json(400, { erro: "campos obrigatório para 'editar'." });
      }
      const chaves = Object.keys(campos);
      if (chaves.length === 0) return json(400, { erro: "Nenhum campo para alterar." });

      // Validação de servidor — a tela também valida, mas isso é conveniência.
      // Ver o cabeçalho de _vocabulario-alimentos.ts sobre por que a fonte do
      // documento entra na validação.
      const erros = validarCampos(campos, String(dados.fonte ?? ""));
      if (erros.length) return json(422, { erro: "Campos inválidos.", detalhes: erros });

      const patch: Record<string, any> = {
        atualizadoPor: uid,
        atualizadoEm: agora,
      };
      for (const c of chaves) patch[c] = campos[c];
      if ("nomeExibicao" in patch) patch.nomeBusca = normalizarNomeBusca(patch.nomeExibicao);

      // Editar NÃO aprova — mesma separação de atos de exercícios: corrigir
      // uma medida caseira não é atestar que o alimento está pronto para o
      // atleta. revisadoPor/revisadoEm não são tocados aqui.
      await ref.update(patch);
      await marcarPendente("alimentos");

      return json(200, {
        ok: true,
        operacao: "editar",
        foodId,
        alterados: chaves,
        revisado: Boolean(dados.revisadoPor),
      });
    }

    if (operacao === "desrevisar") {
      if (!dados.revisadoPor) {
        return json(200, { ok: true, operacao: "desrevisar", foodId, jaEstavaPendente: true });
      }
      await ref.update({
        revisadoPor: null,
        revisadoEm: null,
        atualizadoPor: uid,
        atualizadoEm: agora,
      });
      await marcarPendente("alimentos");
      return json(200, { ok: true, operacao: "desrevisar", foodId, revisadoPorAnterior: dados.revisadoPor });
    }

    // operacao === "revisar"
    if (dados.revisadoPor) {
      // Idempotente e explícito: repetir a revisão não reescreve quem revisou
      // nem quando. Devolve 200 para que a tela não trate reenvio como erro.
      return json(200, {
        ok: true,
        operacao: "revisar",
        foodId,
        jaEstavaRevisado: true,
        revisadoPor: dados.revisadoPor,
      });
    }

    await ref.update({
      revisadoPor: uid,
      revisadoEm: agora,
      atualizadoPor: uid,
      atualizadoEm: agora,
    });
    await marcarPendente("alimentos");

    return json(200, { ok: true, operacao: "revisar", foodId, revisadoPor: uid });
  } catch (e: any) {
    console.error("[atualizar-alimento]", e?.stack ?? e);
    return json(500, { erro: "Falha ao gravar o alimento." });
  }
};

// Reexportado para a tela montar o formulário a partir da mesma lista que o
// servidor aceita, em vez de manter a sua própria.
export { CAMPOS_EDITAVEIS };
