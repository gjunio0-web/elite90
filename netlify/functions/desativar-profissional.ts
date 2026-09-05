// ELITE90 PRO · desativar-profissional
// Netlify Function: desativação do cadastro do profissional, Fase 4-B do M2.
//
// Grava `active: false` em `professionals/{professionalId}`, REVOGA o acesso da
// conta de autenticação correspondente (AC-12 do Adendo 07) e emite
// `profissional.desativado` (Adendo 02, seção 7.3).
//
// POR QUE DESATIVAR NÃO É APAGAR
// AD-13: o cadastro nunca é apagado, porque a autoria histórica das versões
// publicadas aponta para ele. Apagar quebraria a leitura do histórico. Este é o
// oposto do tratamento das demais coleções da delegação, e a distinção alcança o
// item de exclusão em cascata da Fase 8.
//
// POR QUE A REVOGAÇÃO ENTROU, E POR QUE SÓ AGORA
// Até a Fase 4-C não existia reivindicação de profissional: `active: false` no
// documento bastava, porque nada dependia de reivindicação para dar acesso. Com
// a concessão de acesso implementada, deixou de bastar — a reivindicação vive no
// token, e desativar o cadastro não a alcançava. Era uma decisão de segurança
// inócua por não haver papel a revogar, e que volta a ter efeito no dia em que o
// papel existe.
//
// E A REVOGAÇÃO NÃO É A GARANTIA (AC-13)
// Remover a reivindicação e derrubar as sessões NÃO invalida o token já emitido,
// que vale até expirar. Isto reduz a janela; quem a fecha é a conferência de
// `active` no documento, em `_profissional-ativo.ts`, feita por toda função que
// sirva a um profissional.
//
// O QUE ESTA FUNÇÃO NÃO FAZ, DELIBERADAMENTE
//
// Não emite ação de rastreabilidade nova para a revogação. Revogar é
// CONSEQUÊNCIA de desativar, não ato independente: `profissional.desativado` já
// registra o ato (AD-15). Dar duas ações a um ato repetiria, invertido, o
// problema que `profissional.acesso-concedido` corrige do outro lado.
//
// Não reativa. Reativar é edição do campo `active` — e a função de edição, hoje,
// não aceita esse campo, de propósito. A reativação fica apontada como decisão a
// tomar, não implementada por analogia. Consequência a registrar: quando ela for
// implementada, precisará RECONCEDER o acesso, e não apenas voltar `active` a
// true, porque esta função o revogou.
//
// Não encerra as atribuições de carteira do profissional. Encerrar é ato próprio,
// com motivo próprio (`professional_exit`), e vem na função de carteira. Fazê-lo
// aqui, por dedução, gravaria eventos que ninguém pediu.

import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { validarIdDocumento } from "./_m2-validacao";

const COLECAO = "professionals";

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

class NaoEncontrado extends Error {}
class JaInativo extends Error {}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

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

  const idValido = validarIdDocumento(corpo.professionalId, "professionalId");
  if (!idValido.ok) return json(400, { erro: idValido.erro });

  const db = getFirestore(app);
  const ref = db.collection(COLECAO).doc(String(corpo.professionalId));
  const emHomologacao = process.env.CONTEXT !== "production";

  // O endereço, capturado DENTRO da transação: é por ele que a conta de
  // autenticação é localizada adiante, e reler o documento depois abriria espaço
  // para outra escrita entre uma leitura e a outra.
  let emailCadastro: string | null = null;

  try {
    await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      if (!atual.exists) throw new NaoEncontrado();
      // Recusa quando já está inativo: gravar transição que não houve poria no
      // evento um `de: true` falso.
      if (atual.get("active") !== true) throw new JaInativo();

      const bruto = atual.get("email");
      emailCadastro = typeof bruto === "string" ? bruto.trim().toLowerCase() : null;

      tx.update(ref, { active: false, updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (e) {
    if (e instanceof NaoEncontrado) {
      return json(404, { erro: "Profissional não encontrado." });
    }
    if (e instanceof JaInativo) {
      return json(409, { erro: "Profissional já está inativo." });
    }
    console.error("[desativar-profissional] falha ao gravar:", e);
    return json(500, { erro: "Não foi possível desativar o profissional." });
  }

  // Forma da transição conforme a correção publicada na versão 1.5 do Adendo 02:
  // o nome do campo em chave própria, e `de`/`para` com os VALORES dos dois lados —
  // que é como as chamadas de atualizar-alimento.ts e atualizar-exercicio.ts já
  // registram transição.
  await registrar({
    acao: "profissional.desativado",
    ator,
    origem: "desativar-profissional",
    alvo: { colecao: COLECAO, id: ref.id } as Alvo,
    detalhe: { campo: "active", de: true, para: false },
    _test: emHomologacao,
  });

  // AC-12 · A revogação. Roda DEPOIS do evento, pela mesma razão da rotina de
  // reatribuição em `atualizar-profissional.ts`: a desativação aconteceu e ficou
  // registrada, e a auditoria não pode passar a negá-la porque um efeito
  // posterior falhou. Falhar aqui não desfaz nada, e o resultado volta na
  // resposta para que a interface avise em vez de supor.
  //
  // Nenhuma ação de rastreabilidade é emitida (AD-15). Ver o cabeçalho.
  let acessoRevogado: boolean | null = null;
  if (emailCadastro) {
    acessoRevogado = false;
    try {
      const auth = getAuth(app);
      const usuario = await auth.getUserByEmail(emailCadastro);
      const claimsAtuais: Record<string, any> = usuario.customClaims ?? {};

      // Só revoga em conta que responde por ESTE cadastro. Conta sem
      // reivindicação de profissional nunca recebeu acesso, e conta vinculada a
      // outro cadastro não é desta pessoa — mexer nela derrubaria o acesso de um
      // terceiro por causa de um endereço reaproveitado.
      if (claimsAtuais.professionalId === ref.id) {
        // Remove apenas os três campos do papel profissional e PRESERVA os
        // demais, no mesmo padrão de `promote-lead.ts`. Substituir o objeto
        // inteiro apagaria `admin` de quem o tenha. `athlete` não convive com
        // `professional` por força da AC-14, mas a preservação não depende disso.
        const restantes = { ...claimsAtuais };
        delete restantes.professional;
        delete restantes.professionalId;
        delete restantes.classification;
        await auth.setCustomUserClaims(usuario.uid, restantes);

        // Derruba as sessões em circulação. Não invalida o token de identidade
        // já emitido — ver AC-13 no cabeçalho.
        await auth.revokeRefreshTokens(usuario.uid);
        acessoRevogado = true;
      }
    } catch (e) {
      // Conta inexistente é o caso comum, não exceção: profissional cadastrado
      // que nunca recebeu acesso. Não vira ruído no log.
      if ((e as any)?.code !== "auth/user-not-found") {
        console.error("[desativar-profissional] falha ao revogar acesso:", e);
      }
    }
  }

  return json(200, { ok: true, professionalId: ref.id, active: false, acessoRevogado });
};
