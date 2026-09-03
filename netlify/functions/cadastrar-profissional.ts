// ELITE90 PRO · cadastrar-profissional
// Netlify Function: primeira escrita da Fase 4-B do plano de persistência do M2.
//
// Grava o cadastro do profissional em `professionals/{professionalId}`, conforme
// a seção 4.1 do Adendo 02 — Delegação.
//
// POR QUE A ESCRITA NÃO PARTE DO NAVEGADOR
// Mesmo motivo de salvar-rascunho-plano.ts e promote-lead.ts: o provedor de
// e-mail/senha está aberto e a chave pública está no HTML, então qualquer pessoa
// consegue criar conta neste projeto. "Autenticado" não é "autorizado". A
// autorização real é o claim admin, conferido aqui pelo Admin SDK.
//
// O QUE ESTA FUNÇÃO NÃO FAZ, DELIBERADAMENTE
//
// Não edita nem desativa. São atos próprios, com ações próprias de rastreabilidade
// (`profissional.editado` e `profissional.desativado`), e a desativação está parada
// até a forma do `detalhe` dela ser fixada no adendo.
//
// Não aceita `active` na carga. Quem cadastra cria ativo; nascer inativo é estado
// que não serve a nada. A desativação é operação separada (AD-13).
//
// Não normaliza o telefone para E.164. O conversor vive dentro de
// _athlete-from-lead.js, privado àquele módulo, e duplicá-lo aqui criaria segunda
// fonte para a mesma regra. O campo é gravado como recebido, com espaços aparados.
// Quando o conversor for extraído para módulo próprio, este ponto passa a usá-lo.
//
// Não atribui carteira. Atribuir é a função seguinte da fase, e o Adendo 02 diz na
// pós-condição do UC-DEL-01 que o profissional nasce sem atleta nenhum.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import {
  validarProfissional,
  type CargaProfissional,
} from "./_m2-validacao";

const COLECAO = "professionals";

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Sentinela de colisão, para distinguir a recusa de negócio de uma falha real. */
class ColisaoEmail extends Error {}

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
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let ator: Ator & { tipo: "humano" };
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.admin) return { statusCode: 403, body: "Acesso não autorizado" };
    ator = {
      tipo: "humano",
      uid: decoded.uid,
      email: decoded.email ?? null,
      papel: "admin",
    };
  } catch {
    return { statusCode: 401, body: "Invalid token" };
  }

  let corpo: Record<string, any>;
  try {
    corpo = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { erro: "Corpo inválido." });
  }

  const carga: CargaProfissional = {
    name: typeof corpo.name === "string" ? corpo.name.trim() : corpo.name,
    // Minúsculas por decisão do adendo (seção 4.1). A normalização acontece antes
    // da validação para que a guarda de colisão compare o mesmo que se grava.
    email:
      typeof corpo.email === "string" ? corpo.email.trim().toLowerCase() : corpo.email,
    phone: typeof corpo.phone === "string" ? corpo.phone.trim() || null : null,
    council: corpo.council,
    councilNumber:
      typeof corpo.councilNumber === "string"
        ? corpo.councilNumber.trim()
        : corpo.councilNumber,
    councilState:
      typeof corpo.councilState === "string"
        ? corpo.councilState.trim().toUpperCase() || null
        : null,
    classification: corpo.classification,
    specialties: corpo.specialties,
  };

  const v = validarProfissional(carga);
  if (!v.ok) return json(400, { erro: v.erro });

  const db = getFirestore(app);
  const ref = db.collection(COLECAO).doc();

  // O documento de homologação nasce marcado, para que a varredura final seja uma
  // consulta e não uma inspeção (P7 do esquema; critério CA-24 do Adendo 02). O
  // ambiente é o mesmo sinal que o módulo de rastreabilidade usa.
  const emHomologacao = process.env.CONTEXT !== "production";

  try {
    // A unicidade do endereço é conferida DENTRO da transação, e não antes dela.
    // Consultar e depois gravar em dois passos deixa uma janela entre os dois em
    // que dois cadastros com o mesmo endereço passam — foi exatamente assim que
    // dois atletas com o mesmo e-mail entraram na base em agosto.
    await db.runTransaction(async (tx) => {
      const duplicado = await tx.get(
        db.collection(COLECAO).where("email", "==", carga.email).limit(1),
      );
      if (!duplicado.empty) throw new ColisaoEmail();

      tx.create(ref, {
        ...carga,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        _test: emHomologacao,
      });
    });
  } catch (e) {
    if (e instanceof ColisaoEmail) {
      return json(409, { erro: "Já existe profissional cadastrado com este e-mail." });
    }
    // Mensagem sem detalhe interno para quem chama; o rastro fica no servidor.
    console.error("[cadastrar-profissional] falha ao gravar:", e);
    return json(500, { erro: "Não foi possível cadastrar o profissional." });
  }

  // Evento DEPOIS da gravação e FORA da transação (DR-06): descreve fato consumado.
  // Sem `detalhe`, conforme a seção 7.3 do Adendo 02 — o alvo já diz qual documento
  // nasceu, e repetir os valores aqui poria nome e e-mail do profissional numa
  // coleção com retenção de vinte e quatro meses.
  await registrar({
    acao: "profissional.cadastrado",
    ator,
    origem: "cadastrar-profissional",
    alvo: { colecao: COLECAO, id: ref.id } as Alvo,
    _test: emHomologacao,
  });

  return json(200, { ok: true, professionalId: ref.id });
};
