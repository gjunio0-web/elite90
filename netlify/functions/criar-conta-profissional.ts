// ELITE90 PRO · criar-conta-profissional
// Netlify Function: primeira entrega do Bloco 1 da Fase 4-C do plano de
// persistência do M2 — decisões AC-01 e AC-02 do Adendo 07.
//
// Cria a CONTA DE AUTENTICAÇÃO de um profissional JÁ CADASTRADO em
// `professionals/{professionalId}`, e atribui a reivindicação customizada que
// dá acesso à tela restrita.
//
// O QUE ESTA FUNÇÃO NÃO FAZ, DELIBERADAMENTE
//
// Não cadastra. O cadastro é `cadastrar-profissional.ts`, e é ele quem valida a
// carga, guarda a unicidade do endereço e registra `profissional.cadastrado`.
// Aqui o cadastro é premissa, não produto: sem documento, não há conta.
//
// Não reemite `profissional.cadastrado`. Registra `profissional.acesso-concedido`
// (AC-11), que é ação própria porque o ato é próprio: o Coach pode cadastrar hoje
// quem só começa a trabalhar no mês seguinte. Reemitir a ação de cadastro poria
// dois nascimentos no histórico de uma pessoa só.
//
// Não grava `detalhe` no evento. Ausente, não `{}`. O alvo já identifica o
// profissional, e a única informação que um `detalhe` guardaria — se a conta era
// nova ou reaproveitada — descreveria um estado perigoso que a recusa da AC-14
// torna impossível. Guarda que impede, não campo que documenta.
//
// NÃO GERA SENHA ALEATÓRIA DESCARTADA (Adendo 07, AC-30). Até 11/09/2026, uma
// conta nova nascia com senha que ninguém via e ninguém usava — o acesso
// dependia inteiramente de o Coach "avisar por fora", e nada neste sistema
// entregava ao profissional um jeito de entrar. AC-30 substitui isso por um
// LINK DE DEFINIÇÃO DE SENHA, gerado por `generatePasswordResetLink` e
// enviado por e-mail automático — mesma infraestrutura de promote-lead.ts
// (`_mailer.ts`, `sendMail`, `isMailerConfigured`).
//
// A CHAMADA NÃO PASSA `ActionCodeSettings` (Adendo 07, v1.20 — correção sobre
// as versões 1.18/1.19). `handleCodeInApp: true` era especificação anterior,
// verificada contra a documentação oficial da Firebase só depois da primeira
// execução real em homologação — e a verificação mostrou que a flag é
// mecanismo de APP MÓVEL (Universal Link/Android App Link), exige `iOS`/
// `android` no objeto para funcionar, e nunca foi o caminho certo para um
// fluxo puramente web. O erro era do documento normativo, não da
// implementação anterior, que seguiu a especificação corretamente.
//
// O DESTINO DO LINK É CONFIGURAÇÃO DE CONSOLE, NÃO PARÂMETRO DE CHAMADA —
// Authentication → Templates → "customize action URL", em cada projeto
// Firebase, apontando para /definir-senha. Feito uma vez por projeto, vale
// para todos os modelos de e-mail dali em diante (CA-89, pré-requisito de
// infraestrutura, não verificável por leitura de código). Sem essa
// configuração, o link abre a página padrão hospedada pelo próprio Firebase,
// não a nossa — mesmo com a chamada já simplificada.
//
// SEMPRE AUTOMÁTICO, SEM PARÂMETRO QUE DESATIVE. Diferente do e-mail de
// boas-vindas do atleta, que é escolha do Coach por promoção — aqui conceder
// acesso é ato administrativo, não momento de decisão caso a caso.
//
// ENVIADO NOS DOIS CAMINHOS — conta nova E conta reaproveitada. O propósito
// deste botão é garantir que a pessoa CONSIGA entrar, não só que a conta
// exista; uma conta reaproveitada pode ser, ela mesma, uma conta presa pelo
// mesmo defeito que esta versão corrige.
//
// FALHA NO ENVIO NÃO DESFAZ A CONCESSÃO. É reportada na resposta
// (`acessoEnviado`/`acessoErro`), mesmo padrão de `welcomeSent`/`welcomeError`
// em promote-lead.ts — a conta e a reivindicação já existem quando chegamos
// ao envio; um e-mail que falha não é motivo para desfazer as duas.
//
// Não escreve nada em `professionals/{professionalId}`. O elo de volta, do
// cadastro para a conta, é o endereço de correio, que já é único por guarda
// transacional do cadastro. Acrescentar aqui um campo com o identificador da
// conta criaria segunda fonte para a mesma relação, e nenhum documento a pede.
//
// Não revoga. A revogação é da desativação (AC-12), em função própria.
//
// A LÓGICA VIVE EXPORTADA, NÃO SÓ NO HANDLER HTTP (Adendo 07, AC-31). A partir
// de 11/09/2026, `cadastrar-profissional.ts` chama `concederAcesso` NO MESMO
// PROCESSO, logo após criar o documento — sequencial, não atômico, dois
// sistemas diferentes (Firestore e Firebase Auth) sem transação que cubra os
// dois. Se esta etapa falhar, o cadastro permanece; o botão "Conceder acesso"
// que já existe na tela é a recuperação, sem lógica nova — o mesmo estado
// "cadastrado, sem acesso" já precisava ser coberto para os casos de espera
// deliberada (início futuro, documentação pendente). Não é chamada HTTP a si
// mesma: é função compartilhada, para não duplicar sete guardas em dois lugares.

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "./_firebase";
import { registrar, type Ator, type Alvo } from "./_rastreabilidade";
import { CLASSIFICATIONS, type Classification } from "./_m2-validacao";
import { conferirProfissionalAtivo } from "./_profissional-ativo";
import { sendMail, isMailerConfigured } from "./_mailer";
import { EMAIL_BASE_CSS, emailHeader } from "./_email-header";
import { emblemaAttachment } from "./_email-emblema";

const COLECAO = "professionals";

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * O que este arquivo exportava só como efeito do handler HTTP, agora como
 * função — chamada por ela mesma (o handler abaixo) e por
 * `cadastrar-profissional.ts` (AC-31), no mesmo processo.
 *
 * NUNCA LANÇA. Toda falha — guarda de negócio ou exceção do Firebase — volta
 * como `{ ok: false, status, erro, reason? }`, para o chamador decidir o que
 * fazer sem precisar de try/catch em volta. `ator` é sempre de quem CHAMOU
 * (o Coach, nos dois casos de uso — clique direto ou cadastro que encadeia).
 */
export type ResultadoConcessao =
  | { ok: true; uid: string; contaCriada: boolean; acessoEnviado: boolean; acessoErro: string | null }
  | { ok: false; status: number; erro: string; reason?: string };

export async function concederAcesso(
  app: ReturnType<typeof getApp>,
  professionalId: string,
  ator: Ator & { tipo: "humano" },
): Promise<ResultadoConcessao> {
  const db = getFirestore(app);
  const snap = await db.collection(COLECAO).doc(professionalId).get();

  // AC-13 · conferência única, no módulo compartilhado. Aqui ela impede
  // CONCEDER acesso a cadastro inativo; a desativação é que revoga o já
  // concedido (AC-12). Duas coisas distintas, e nenhuma dispensa a outra.
  const verdicto = conferirProfissionalAtivo(snap);
  if (!verdicto.ok) {
    return {
      ok: false,
      status: verdicto.reason === "nao-encontrado" ? 404 : 409,
      erro:
        verdicto.reason === "inativo"
          ? "Profissional desativado. Reative o cadastro antes de conceder o acesso."
          : verdicto.erro,
      reason: verdicto.reason,
    };
  }
  const prof = verdicto.dados;

  const email = typeof prof.email === "string" ? prof.email.trim().toLowerCase() : "";
  if (!email) {
    return { ok: false, status: 409, erro: "Cadastro sem endereço de correio." };
  }

  // `classification` vem do CADASTRO, nunca do corpo da requisição: o corpo é do
  // navegador, e aceitar de lá o valor que decide nível de projeção (D-04) e se
  // o delegado vê nome ou rótulo do atleta (D-14) deixaria quem chama escolher
  // o próprio escopo de leitura.
  const classification = prof.classification as Classification;
  if (!CLASSIFICATIONS.includes(classification)) {
    return { ok: false, status: 409, erro: "Cadastro com classification inválida." };
  }

  const auth = getAuth(app);

  let uid: string;
  let contaCriada = false;
  try {
    uid = (await auth.getUserByEmail(email)).uid;
  } catch {
    const criada = await auth.createUser({
      email,
      emailVerified: false,
      displayName: String(prof.name ?? "").trim() || undefined,
      // Senha ALEATÓRIA MESMO ASSIM — a conta do Firebase Auth exige alguma
      // senha para nascer, e esta nunca é usada: o acesso de verdade vem do
      // link de definição, gerado e enviado logo abaixo (AC-30). É diferente
      // do arranjo anterior a 11/09/2026, que também gerava senha aleatória
      // mas PARAVA AÍ — sem entregar nada ao profissional.
      password: `E90-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
    });
    uid = criada.uid;
    contaCriada = true;
  }

  const claimsAtuais = (await auth.getUser(uid)).customClaims ?? {};

  // AC-14 · A combinação de papéis é RECUSADA. Esta é a razão pela qual a conta
  // é localizada pelo endereço antes de qualquer atribuição: um profissional que
  // também seja atleta do programa — hipótese nada remota entre os internos —
  // terminaria com `athlete: true` e `professional: true` no mesmo token, e o
  // redirecionamento de três ramos da AC-03 não prevê a combinação. Essa pessoa
  // iria para a tela restrita e ficaria sem caminho para o próprio
  // acompanhamento. O profissional que também for atleta usa CONTA SEPARADA.
  //
  // Recusa distinta da de cadastro inativo, logo acima, e da de conta já
  // vinculada, logo abaixo. Três recusas, três razões, nenhuma substitui outra.
  if (claimsAtuais.athlete === true) {
    return {
      ok: false,
      status: 409,
      erro:
        "Esta conta já é de um atleta do programa. O profissional que também for " +
        "atleta precisa de uma conta separada, com outro endereço de e-mail.",
      reason: "combinacao-de-papeis",
    };
  }

  // Guarda de conta já vinculada. Simétrica à guarda de colisão de e-mail do
  // cadastro: aquela pergunta "este endereço já é de outro profissional?"; esta
  // pergunta "esta CONTA já responde por outro cadastro?". Sem ela, reapontar a
  // reivindicação trocaria em silêncio o cadastro que a pessoa representa, e
  // todas as atribuições de carteira do vínculo anterior deixariam de aparecer
  // para ela sem que nada falhasse.
  const vinculoAtual = claimsAtuais.professionalId;
  if (typeof vinculoAtual === "string" && vinculoAtual !== professionalId) {
    return {
      ok: false,
      status: 409,
      erro: "Esta conta já está vinculada a outro cadastro profissional.",
      reason: "conta-ja-vinculada",
    };
  }

  // Preserva as reivindicações existentes — a conta pode acumular papéis. É o
  // mesmo padrão de promote-lead.ts (Adendo 07, F-2), sem desvio: substituir o
  // objeto inteiro apagaria `admin` de quem o tenha. Depois da recusa acima,
  // `athlete` já não está entre os papéis possíveis aqui.
  await auth.setCustomUserClaims(uid, {
    ...claimsAtuais,
    professional: true,
    professionalId,
    classification,
  });

  // AC-11 · `profissional.acesso-concedido`, alvo no cadastro, ator `admin`,
  // SEM `detalhe`. Gravado nos dois caminhos — conta criada e conta reaproveitada
  // —, porque o ato registrado é a concessão, não a criação (CA-45).
  await registrar({
    acao: "profissional.acesso-concedido",
    ator,
    origem: "criar-conta-profissional",
    alvo: { colecao: COLECAO, id: professionalId } as Alvo,
    _test: process.env.CONTEXT !== "production",
  });

  // A reivindicação só chega ao navegador em token novo. Quem já estiver
  // autenticado precisa de `getIdTokenResult(true)` ou de entrar de novo — é a
  // mesma condição que a CA-38 descreve para a mudança de `classification`.
  //
  // E ela é CACHE, não verdade (AC-13): quem for autorizar este profissional
  // adiante confere `professionals/{professionalId}.active` no documento, e não
  // o token.
  // -- Link de definição de senha, sempre, nos dois caminhos (AC-30) --
  // Não-fatal: a conta e a reivindicação já foram gravadas. Falha no envio
  // não desfaz a concessão — é reportada, e o Coach pode repetir o clique de
  // "Conceder acesso" depois, que gera e envia um link novo (o antigo, se
  // existir, expira sozinho pelo próprio Firebase).
  let acessoEnviado = false;
  let acessoErro: string | null = null;
  try {
    // URL FIXA POR AMBIENTE, NÃO DINÂMICA (Adendo 07, AC-30, v1.19). O link
    // tem que apontar para o MESMO projeto Firebase que gerou o oobCode — um
    // link de homologação abrindo o site de produção falha na validação,
    // mesmo com o domínio autorizado (CA-87), porque tentaria verificar o
    // código contra o Firebase errado.
    //
    // NÃO É `process.env.URL`: essa variável é a única disponível em runtime
    // de função (confirmado contra a documentação oficial da Netlify —
    // `DEPLOY_URL`, que varia por branch, só existe em build), mas descreve o
    // ENDEREÇO PRINCIPAL DO SITE — a homologação é branch deploy do MESMO
    // site que a produção, então essa variável resolveria sempre para
    // coachruiz.com.br, não para o domínio da branch. Por isso dois valores
    // FIXOS, escolhidos por `CONTEXT` — o mesmo mecanismo de `emHomologacao`,
    // já usado em toda esta fase.
    //
    // Sem segundo argumento, de propósito (v1.20). O destino é decidido pela
    // configuração de console (CA-89), não por `ActionCodeSettings` — ver o
    // cabeçalho deste arquivo para o raciocínio completo.
    const link = await auth.generatePasswordResetLink(email);
    if (!isMailerConfigured()) {
      acessoErro = "Envio de e-mail não configurado no ambiente.";
    } else {
      await sendMail({
        to: email,
        subject: "Defina sua senha — ELITE 90 PRO",
        html: buildAcessoEmail(String(prof.name ?? ""), link),
        attachments: [emblemaAttachment()],
      });
      acessoEnviado = true;
    }
  } catch (e: any) {
    acessoErro = e?.message ?? "Falha ao gerar ou enviar o link de acesso.";
    console.error("[criar-conta-profissional] Link de acesso não enviado (não-fatal):", acessoErro);
  }

  return { ok: true, uid, contaCriada, acessoEnviado, acessoErro };
}

// ── HANDLER HTTP — o botão "Conceder acesso" da tela chama isto direto.
// Só autentica, valida o corpo, e traduz ResultadoConcessao para HTTP. Toda a
// lógica de negócio está em concederAcesso(), acima, para ser idêntica quando
// cadastrar-profissional.ts chama a mesma função no mesmo processo (AC-31).
export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const app = getApp();

  // Autenticação antes de ler o corpo, no padrão das demais funções da fase:
  // requisição sem token não merece nem o custo de analisar o JSON.
  const authHeader = event.headers["authorization"] ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return { statusCode: 401, body: "Missing token" };

  let ator: Ator & { tipo: "humano" };
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    // Só o Coach concede acesso a profissional (AC-02). `professional: true` no
    // token de quem chama não basta — um profissional não se promove nem promove
    // um colega. Não existe autocadastro nem autoconcessão.
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

  const professionalId =
    typeof corpo.professionalId === "string" ? corpo.professionalId.trim() : "";
  if (!professionalId) {
    return json(400, { erro: "professionalId ausente." });
  }

  const resultado = await concederAcesso(app, professionalId, ator);
  if (!resultado.ok) {
    return json(resultado.status, { erro: resultado.erro, reason: resultado.reason });
  }
  return json(200, resultado);
};

function buildAcessoEmail(nome: string, link: string): string {
  const firstName = String(nome || "").split(" ")[0] || "";
  const saudacao = firstName ? `${firstName}, bem-vindo` : "Bem-vindo";
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<meta name="supported-color-schemes" content="dark"/>
<title>ELITE 90 PRO — Defina sua senha</title>
<style>
${EMAIL_BASE_CSS}
  h1{font-size:22px;font-weight:700;color:#FFFFFF;text-transform:uppercase;letter-spacing:.04em;margin:0 0 16px;}
  p{font-size:15px;line-height:1.7;margin:0 0 16px;color:#CCCCCC !important;}
  .highlight{color:#A6C300;font-weight:700;}
  .btn{display:inline-block;background:#A6C300;color:#0D0D0D !important;font-weight:700;text-decoration:none;
       padding:14px 28px;border-radius:6px;text-transform:uppercase;letter-spacing:.04em;font-size:14px;margin:8px 0 24px;}
  .fallback{font-size:12px;color:#888;word-break:break-all;margin-top:8px;}
  .fallback a{color:#888 !important;text-decoration:underline;}
</style>
</head>
<body>
<div class="wrap">
${emailHeader("Acesso ao Portal do Profissional")}
  <h1>${saudacao} ao ELITE 90 PRO.</h1>
  <p>
    Você foi cadastrado como profissional no <span class="highlight">ELITE 90 PRO</span>.
    Para acessar o portal, defina sua senha pelo botão abaixo.
  </p>
  <p><a class="btn" href="${link}">Definir minha senha</a></p>
  <p class="fallback">Se o botão não funcionar, copie e cole este endereço no navegador:<br/><a href="${link}" style="color:#888 !important;">${link}</a></p>
  <p>Este link expira em algumas horas. Se expirar, peça ao Coach para gerar um novo.</p>
</div>
</body>
</html>`;
}
