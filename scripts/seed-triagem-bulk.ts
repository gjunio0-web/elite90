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
  const pick = <T>(arr: T[]): T => faker.helpers.arrayElement(arr);

  // Campos aleatorizados por perfil para gerar dispersão real de scores:
  //   high   → score 76–90 → "alta"
  //   medium → score 45–78 → "média" (maioria)
  //   low    → score  0–52 → "fora_do_perfil" / "baixa"
  const pd = profile === 'high' ? {
    data_nascimento:        '15/03/1978',
    objetivo:               'Preparação para competição',
    atividade_fisica:       'Musculação',
    tempo_atividade:        pick(['4', '5', '6', '8', '10']),
    frequencia_semanal:     pick(['3', '4', '4', '5', '5']),
    dieta:                  pick(['Sim, com acompanhamento profissional', 'Sim, com acompanhamento profissional', 'Sim, faço dieta própria']),
    suplementos:            'SIM',
    disponibilidade_diaria: pick(['1.5', '2', '2']),
    refeicoes_dia:          pick(['5', '5', '6']),
    agua_litros:            pick(['2.5', '3', '4', '4']),
    competicao:             'SIM',
    conhece_coach:          'SIM',
    medico_esporte:         'SIM',
    personal_trainer:       'NÃO',
    trt:                    'SIM',
    lesao:                  pick(['NÃO', 'NÃO', 'NÃO', 'SIM']),
    condicao_cardiaca:      'Nenhuma',
    diabetes:               'NÃO',
    doenca_cronica:         'Nenhuma',
  } : profile === 'medium' ? {
    data_nascimento:        '20/07/1983',
    objetivo:               pick(['Ganho de massa muscular', 'Ganho de massa muscular', 'Definição e perda de gordura']),
    atividade_fisica:       'Musculação',
    tempo_atividade:        pick(['2', '3', '4', '5']),
    frequencia_semanal:     pick(['3', '3', '4', '4']),
    dieta:                  pick(['Não sigo dieta específica', 'Sim, faço dieta própria', 'Sim, faço dieta própria', 'Sim, com acompanhamento profissional']),
    suplementos:            pick(['NÃO', 'SIM', 'SIM']),
    disponibilidade_diaria: pick(['1', '1.5', '1.5']),
    refeicoes_dia:          pick(['3', '4', '4', '5']),
    agua_litros:            pick(['2', '2.5', '3']),
    competicao:             'NÃO',
    conhece_coach:          'SIM',
    medico_esporte:         pick(['NÃO', 'NÃO', 'SIM']),
    personal_trainer:       pick(['NÃO', 'SIM']),
    trt:                    'NÃO',
    lesao:                  pick(['NÃO', 'SIM', 'SIM']),
    condicao_cardiaca:      'Nenhuma',
    diabetes:               'NÃO',
    doenca_cronica:         'Nenhuma',
  } : {
    data_nascimento:        pick(['05/11/2000', '20/03/1996', '22/08/1990', '10/06/1984']),
    objetivo:               pick(['Saúde e qualidade de vida', 'Saúde e qualidade de vida', 'Definição e perda de gordura', 'Performance e longevidade']),
    atividade_fisica:       pick(['Caminhada', 'Natação', 'Corrida']),
    tempo_atividade:        pick(['0.5', '1', '1', '2']),
    frequencia_semanal:     pick(['1', '2', '3']),
    dieta:                  pick(['Não sigo dieta específica', 'Não sigo dieta específica', 'Sim, faço dieta própria']),
    suplementos:            'NÃO',
    disponibilidade_diaria: pick(['0.5', '1', '1.5']),
    refeicoes_dia:          pick(['3', '3', '4']),
    agua_litros:            pick(['1', '1.5', '2', '2.5']),
    competicao:             'NÃO',
    conhece_coach:          pick(['NÃO', 'NÃO', 'SIM']),
    medico_esporte:         'NÃO',
    personal_trainer:       pick(['NÃO', 'SIM']),
    trt:                    'NÃO',
    lesao:                  pick(['NÃO', 'SIM', 'SIM']),
    condicao_cardiaca:      pick(['Nenhuma', 'Nenhuma', 'Hipertensão controlada']),
    diabetes:               pick(['NÃO', 'NÃO', 'SIM']),
    doenca_cronica:         'Nenhuma',
  };

  return {
    nome: `${faker.person.firstName('male')} ${faker.person.lastName()} (MOCK #${String(index + 1).padStart(2, '0')})`,
    email: 'gjunio0@gmail.com',
    cpf: faker.helpers.replaceSymbols('###.###.###-##'),
    altura: '1.80',
    peso: '85.0',
    consentimento_saude: 'true',
    status: 'novo',
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
  console.log("✅ 90 fichas injetadas. Scores esperados: high 76–90 | medium 45–78 | low 0–52.");
}

runSeed().catch(console.error);