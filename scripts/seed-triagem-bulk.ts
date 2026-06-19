import * as admin from 'firebase-admin';
import { faker } from '@faker-js/faker/locale/pt_BR';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'elite90-c716b.firebasestorage.app'
});

const db = admin.firestore();

function createConfluentLead(index: number) {
  const timestamp = admin.firestore.Timestamp.now();
  const profile = (index % 3 === 0) ? 'high' : (index % 3 === 1) ? 'medium' : 'low';

  return {
    nome: `${faker.person.firstName('male')} ${faker.person.lastName()} (MOCK #${String(index + 1).padStart(2, '0')})`,
    email: faker.internet.email().toLowerCase(),
    cpf: faker.helpers.replaceSymbols('###.###.###-##'),
    data_nascimento: "01/01/1990",
    altura: "1.80",
    peso: "85.0",
    objetivo: "Ganho de massa muscular",
    atividade_fisica: "Musculação",
    tempo_atividade: "2", // CORRIGIDO: Adicionado o campo faltante
    frequencia_semanal: "4",
    disponibilidade_diaria: "1.5",
    personal_trainer: "NÃO",
    competicao: "NÃO",
    conhece_coach: "SIM",
    medico_esporte: profile === 'high' ? "SIM" : "NÃO",
    trt: profile === 'high' ? "SIM" : "NÃO",
    diabetes: "NÃO",
    lesao: profile === 'medium' ? "SIM" : "NÃO",
    condicao_cardiaca: "Nenhuma",
    doenca_cronica: "Nenhuma",
    dieta: "Sim, com acompanhamento profissional",
    refeicoes_dia: "5",
    suplementos: "Whey, Creatina",
    agua_litros: "3.0",
    consentimento_saude: "true",
    status: "novo",
    createdAt: timestamp,
    fotos_paths: [
      `test_seed/${profile}/candidato_${profile === 'high' ? 3 : 1}_frente.webp`,
      `test_seed/${profile}/candidato_${profile === 'high' ? 3 : 1}_lado.webp`,
      `test_seed/${profile}/candidato_${profile === 'high' ? 3 : 1}_costas.webp`,
    ],
    fotos_upload_id: faker.string.uuid(),
    avaliacao_enviada: false
  };
}

async function runSeed() {
  const batch = db.batch();
  for (let i = 0; i < 90; i++) {
    const docRef = db.collection('leads').doc();
    batch.set(docRef, createConfluentLead(i));
  }
  await batch.commit();
  console.log("✅ 90 fichas injetadas. Paths puros e Tempo de Atividade incluído.");
}

runSeed().catch(console.error);