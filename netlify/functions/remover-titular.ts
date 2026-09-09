// ELITE90 PRO · remover-titular
// Netlify Function: remove o titular de uma especialidade, sem substituto.
//
// Adendo 09, AT-10 e AT-17.
//
// O QUE FAZ: apaga a chave da especialidade em `config/delegationDefaults`. A
// especialidade volta ao estado "sem titular", que é estado VÁLIDO (AT-08), e
// deixa de gerar vínculos nas promoções futuras (AT-04).
//
// O QUE ESTA FUNÇÃO NÃO FAZ, DELIBERADAMENTE: não encerra as atribuições de
// carteira do profissional. O precedente é do chat da Fase 4-C, para o caso
// irmão da desativação de cadastro, e vale por inteiro aqui:
//
//   "Não encerra as atribuições de carteira do profissional. Encerrar é ato
//    próprio, com motivo próprio ('professional_exit'), e vem na função de
//    carteira. Fazê-lo aqui, por dedução, gravaria eventos que ninguém pediu."
//
// OS VÍNCULOS PERMANECEM ATIVOS, e isso não é omissão. Os atletas continuam
// tendo profissional; o que deixou de existir é o padrão para os próximos. Quem
// quiser encerrá-los chama `encerrar-carteira.ts`, um por um, com o motivo que
// descreva o que realmente aconteceu.
//
// NÃO EXISTE "VOLTAR AO ANTERIOR" (AT-10). Quem remover e depois quiser outro
// titular define titular de novo, por `definir-titular.ts` — que aceitará a
// chamada justamente porque a chave não está mais lá.
//
// FUNÇÃO PRÓPRIA, E NÃO UM MODO DE `trocar-titular.ts` (AT-17). Substituir um
// titular e apagá-lo não têm as mesmas guardas nem as mesmas consequências:
// uma migra carteira e a outra não toca em vínculo algum. Fundi-las misturaria
// condições que precisam ficar legíveis em separado.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { validarSpecialty } from "./_m2-validacao";

const COLECAO_CONFIG = "config";
const DOC_DELEGACAO = "delegationDefaults";

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

class SemTitular extends Error {}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Identidade antes de qualquer leitura do Firestore (Adendo 09, seção 3.7).
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let ator: Extract<Ator, { tipo: "humano" }>;
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

  const { specialty } = corpo;

  const v = validarSpecialty(specialty);
  if (!v.ok) return json(400, { erro: v.erro });

  const db = getFirestore(app);
  const emHomologacao = process.env.CONTEXT !== "production";
  const configRef = db.collection(COLECAO_CONFIG).doc(DOC_DELEGACAO);

  let professionalIdRemovido = "";

  try {
    await db.runTransaction(async (tx) => {
      // -- LEITURA ANTES DA ESCRITA --
      const configSnap = await tx.get(configRef);
      const titular = configSnap.exists
        ? (configSnap.data() ?? {})[specialty]
        : undefined;

      // REMOVER O QUE NÃO EXISTE NÃO É SUCESSO SILENCIOSO. Sem esta guarda, a
      // chamada devolveria 200 tendo feito nada, e o evento de rastreabilidade
      // registraria uma decisão que ninguém tomou.
      if (!titular || !titular.professionalId) throw new SemTitular();
      professionalIdRemovido = String(titular.professionalId);

      // -- ESCRITA --
      // Apaga a CHAVE, e não o documento: a outra especialidade continua com o
      // titular dela. `FieldValue.delete()` com `merge: true` remove só o campo.
      tx.set(configRef, { [specialty]: FieldValue.delete() }, { merge: true });
    });
  } catch (e) {
    if (e instanceof SemTitular) {
      return json(409, {
        erro: "Esta especialidade não tem titular definido. Não há o que remover.",
      });
    }
    console.error("[remover-titular] falha ao gravar:", e);
    return json(500, { erro: "Não foi possível remover o titular." });
  }

  // MESMA AÇÃO DA DEFINIÇÃO E DA TROCA (AT-09). Não existe "titular removido":
  // o alvo é sempre o mesmo documento de configuração, e o histórico de quem foi
  // titular quando se lê pela sequência de eventos sobre ele.
  await registrar({
    acao: "titular.definido",
    ator,
    origem: "remover-titular",
    alvo: { colecao: COLECAO_CONFIG, id: DOC_DELEGACAO } as Alvo,
    detalhe: { specialty },
    _test: emHomologacao,
  });

  return json(200, {
    ok: true,
    specialty,
    professionalIdRemovido,
    // Dito explicitamente na resposta porque é o ponto que mais surpreende quem
    // chama: remover o titular NÃO encerra carteira alguma (AT-10).
    vinculosAlterados: 0,
  });
};
