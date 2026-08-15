// ELITE 90 PRO · _firebase
// Módulo compartilhado: ÚNICA inicialização do Firebase Admin SDK.
// Importado por todas as Netlify Functions que falam com o Firestore, o
// Storage ou o Auth. O prefixo _ impede o Netlify de tratar este arquivo
// como endpoint (mesma convenção de _scoring.ts e _mailer.ts).
//
// Antes deste módulo, o mesmo bloco de inicialização existia copiado em OITO
// funções, e as cópias já haviam divergido entre si:
//   • duas (send-evaluation, resend-evaluation) não declaravam storageBucket;
//   • três declaravam o bucket sem valor de reserva, e três com;
//   • uma (get-foto-urls) não tinha a verificação final de private_key,
//     falhando mais adiante e com mensagem menos clara.
// A versão consolidada adota, em todos os casos, o comportamento mais completo
// que já existia em alguma das cópias.
//
// Sobre o tratamento da credencial: a variável FIREBASE_SERVICE_ACCOUNT_JSON
// carrega o JSON inteiro numa linha só. Plataformas de integração contínua às
// vezes envolvem esse valor em aspas ou escapam as aspas internas, por isso as
// duas tentativas de leitura. A troca de \n por quebra de linha real acontece
// DEPOIS da leitura e apenas sobre a chave criptográfica — fazê-la antes
// transformaria um JSON válido em inválido.

import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const BUCKET_PADRAO = "elite90-c716b.firebasestorage.app";

/** Nome do bucket de Storage. Passar explicitamente ao chamar .bucket(): a
 *  resolução implícita pelas opções do app já devolveu "bucket does not exist"
 *  mesmo com o valor correto configurado. */
export function storageBucketName(): string {
  return process.env.PUBLIC_FIREBASE_STORAGE_BUCKET ?? BUCKET_PADRAO;
}

function lerCredencial(): any {
  let saEnv: string = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "{}").trim();
  let serviceAccount: any = null;

  try {
    if (saEnv.startsWith('"') && saEnv.endsWith('"')) saEnv = saEnv.slice(1, -1);
    if (saEnv.startsWith("'") && saEnv.endsWith("'")) saEnv = saEnv.slice(1, -1);

    try {
      serviceAccount = JSON.parse(saEnv);
    } catch {
      serviceAccount = JSON.parse(saEnv.replace(/\\"/g, '"'));
    }

    if (serviceAccount?.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
  } catch (e: any) {
    console.error("FALHA CRÍTICA: FIREBASE_SERVICE_ACCOUNT_JSON inválido — verificar a variável de ambiente no Netlify.");
    throw new Error(`Erro no parse das credenciais do Firebase: ${e.message}`);
  }

  if (!serviceAccount?.private_key) {
    throw new Error("Credenciais do Firebase ausentes ou incompletas.");
  }

  return serviceAccount;
}

/** Aplicação Admin, inicializada uma única vez por ambiente de execução. */
export function getApp(): App {
  if (!getApps().length) {
    initializeApp({
      credential: cert(lerCredencial()),
      storageBucket: storageBucketName(),
    });
  }
  return getApps()[0];
}

/** Firestore. Garante que a inicialização aconteça antes de qualquer acesso —
 *  a ordem importa: getAuth() sobre um app inexistente lança exceção que se
 *  manifesta, no cliente, como um 401 "Invalid token" falso. */
export function getDb(): FirebaseFirestore.Firestore {
  getApp();
  return getFirestore();
}
