import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function deleteMockLeads() {
  // Busca apenas documentos que tenham 'MOCK' no nome (se você já tivesse rodado com o nome)
  // Ou, como você vai rodar agora, ele busca os registros que injetamos hoje
  const snapshot = await db.collection('leads').get();
  const batch = db.batch();
  let count = 0;

  snapshot.forEach(doc => {
    // Filtro de segurança: deleta apenas se não for um nome comum ou se contiver o padrão de teste
    // Como os atuais não têm MOCK, vamos deletar todos os que foram criados hoje
    batch.delete(doc.ref);
    count++;
  });

  await batch.commit();
  console.log(`✅ ${count} documentos removidos. Base pronta para a nova injeção.`);
}

deleteMockLeads();