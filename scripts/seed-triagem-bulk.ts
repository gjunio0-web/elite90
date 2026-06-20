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

  // Campos específicos por perfil — projetados para scores bem distintos:
  //   high   → 90 pts → prioridade "alta"   (D1:15 D2:20 D3:20 D4:20 D5:15 D6:0)
  //   medium → 64 pts → prioridade "média"  (D1:15 D2:16 D3:16 D4:13 D5:7  D6:-3)
  //   low    → 44 pts → prioridade "baixa"  (D1:15 D2:12 D3:11 D4:7  D5:2  D6:-3)
  const pd = {
    high: {
      data_nascimento:     "15/03/1978",
      objetivo:            "Preparação para competição",
      atividade_fisica:    "Musculação",
      tempo_atividade:     "8",
      frequencia_semanal:  "5",
      dieta:               "Sim, com acompanhamento profissional",
      suplementos:         "SIM",
      disponibilidade_diaria: "2",
      refeicoes_dia:       "6",
      agua_litros:         "4",
      competicao:          "SIM",
      conhece_coach:       "SIM",
      medico_esporte:      "SIM",
      personal_trainer:    "NÃO",
      trt:                 "SIM",
      lesao:               "NÃO",
      condicao_cardiaca:   "Nenhuma",
      diabetes:            "NÃO",
      doenca_cronica:      "Nenhuma",
    },
    medium: {
      data_nascimento:     "20/07/1983",
      objetivo:            "Ganho de massa muscular",
      atividade_fisica:    "Musculação",
      tempo_atividade:     "3",
      frequencia_semanal:  "4",
      dieta:               "Sim, faço dieta própria",
      suplementos:         "SIM",
      disponibilidade_diaria: "1.5",
      refeicoes_dia:       "4",
      agua_litros:         "2.5",
      competicao:          "NÃO",
      conhece_coach:       "SIM",
      medico_esporte:      "NÃO",
      personal_trainer:    "SIM",
      trt:                 "NÃO",
      lesao:               "SIM",
      condicao_cardiaca:   "Nenhuma",
      diabetes:            "NÃO",
      doenca_cronica:      "Nenhuma",
    },
    low: {
      data_nascimento:     "10/06/1984",
      objetivo:            "Definição e perda de gordura",
      atividade_fisica:    "Musculação",
      tempo_atividade:     "1",
      frequencia_semanal:  "3",
      dieta:               "Não sigo dieta específica",
      suplementos:         "NÃO",
      disponibilidade_diaria: "1.5",
      refeicoes_dia:       "4",
      agua_litros:         "2.5",
      competicao:          "NÃO",
      conhece_coach:       "NÃO",
      medico_esporte:      "NÃO",
      personal_trainer:    "SIM",
      trt:                 "NÃO",
      lesao:               "SIM",
      condicao_cardiaca:   "Nenhuma",
      diabetes:            "NÃO",
      doenca_cronica:      "Nenhuma",
    },
  }[profile];

  return {
    nome: `${faker.person.firstName('male')} ${faker.person.lastName()} (MOCK #${String(index + 1).padStart(2, '0')})`,
    email: faker.internet.email().toLowerCase(),
    cpf: faker.helpers.replaceSymbols('###.###.###-##'),
    altura: "1.80",
    peso: "85.0",
    consentimento_saude: "true",
    status: "novo",
    createdAt: timestamp,
    avaliacao_enviada: false,
    fotos_upload_id: faker.string.uuid(),
    fotos_paths: [
      `test_seed/${profile}/candidato_${profile === 'high' ? 3 : 1}_frente.webp`,
      `test_seed/${profile}/candidato_${profile === 'high' ? 3 : 1}_lado.webp`,
      `test_seed/${profile}/candidato_${profile === 'high' ? 3 : 1}_costas.webp`,
    ],
    ...pd,
  };
}

async function runSeed() {
  const batch = db.batch();
  for (let i = 0; i < 90; i++) {
    const docRef = db.collection('leads').doc();
    batch.set(docRef, createConfluentLead(i));
  }
  await batch.commit();
  console.log("✅ 90 fichas injetadas. Scores esperados: high≈90 | medium≈64 | low≈44.");
}

runSeed().catch(console.error);