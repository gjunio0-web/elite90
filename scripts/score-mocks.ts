// ELITE 90 PRO · score-mocks
// Calcula e grava o score de triagem de todas as fichas sintéticas (MOCK) no Firestore.
// Uso: npx ts-node scripts/score-mocks.ts

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'elite90-c716b.firebasestorage.app',
});

const db = admin.firestore();

// ── Helpers (idênticos a generate-triage-score.ts) ───────────────────────────

function calcularIdade(dataNascimento: string): number | null {
  const m = dataNascimento.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const nasc = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (isNaN(nasc.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const diff = hoje.getMonth() - nasc.getMonth();
  if (diff < 0 || (diff === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

function num(v: any, fallback = 0): number {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return isNaN(n) ? fallback : n;
}

function isAfirmativo(v: any): boolean {
  return ['sim', 'SIM', 'Sim', 'yes', 'YES'].includes(String(v ?? '').trim());
}

function indicaCondicao(v: any): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s !== '' && s !== 'nenhuma' && s !== 'não' && s !== 'nao' && s !== 'no';
}

// ── Dimensões ─────────────────────────────────────────────────────────────────

function d1_demografico(lead: Record<string, any>): number {
  const idade = calcularIdade(lead.data_nascimento ?? '');
  if (idade === null) return 5;
  if (idade >= 35 && idade <= 55) return 15;
  if ((idade >= 28 && idade <= 34) || (idade >= 56 && idade <= 62)) return 8;
  return 0;
}

function d2_objetivo(lead: Record<string, any>): number {
  const obj = String(lead.objetivo ?? '').toLowerCase();
  if (obj.includes('competição') || obj.includes('competicao') || obj.includes('competi')) return 20;
  if (obj.includes('massa') || obj.includes('bulking')) return 16;
  if (obj.includes('defin') || obj.includes('gordura') || obj.includes('cutting')) return 12;
  if (obj.includes('performance') || obj.includes('longevidade')) return 8;
  if (obj.includes('saúde') || obj.includes('saude') || obj.includes('qualidade')) return 4;
  return 6;
}

function d3_maturidade(lead: Record<string, any>): number {
  let pts = 0;
  const ativ = String(lead.atividade_fisica ?? '').toLowerCase();
  if (ativ.includes('musculação') || ativ.includes('musculacao')) pts += 8;
  else if (ativ.includes('cross') || ativ.includes('funcional') || ativ.includes('powerlifting')) pts += 5;
  else if (ativ.length > 0) pts += 2;
  const anos = num(lead.tempo_atividade);
  if (anos > 5) pts += 8;
  else if (anos >= 2) pts += 5;
  else if (anos >= 1) pts += 2;
  const freq = num(lead.frequencia_semanal);
  if (freq >= 5) pts += 4;
  else if (freq >= 4) pts += 3;
  else if (freq >= 3) pts += 1;
  return pts;
}

function d4_comprometimento(lead: Record<string, any>): number {
  let pts = 0;
  const dieta = String(lead.dieta ?? '').toLowerCase();
  if (dieta.includes('acompanhamento') || dieta.includes('profissional')) pts += 5;
  else if (dieta.includes('sim') || dieta.includes('segue') || dieta.includes('própria') || dieta.includes('propria')) pts += 3;
  if (isAfirmativo(lead.suplementos)) pts += 3;
  const disp = num(lead.disponibilidade_diaria);
  if (disp >= 2) pts += 4;
  else if (disp >= 1.5) pts += 3;
  else if (disp >= 1) pts += 2;
  const ref = num(lead.refeicoes_dia);
  if (ref >= 5) pts += 4;
  else if (ref >= 4) pts += 2;
  const agua = num(lead.agua_litros);
  if (agua >= 4) pts += 4;
  else if (agua >= 2.5) pts += 2;
  return pts;
}

function d5_motivacao(lead: Record<string, any>): number {
  let pts = 0;
  if (isAfirmativo(lead.competicao))       pts += 8;
  if (isAfirmativo(lead.conhece_coach))    pts += 5;
  if (isAfirmativo(lead.medico_esporte))   pts += 4;
  if (isAfirmativo(lead.personal_trainer)) pts += 2;
  return Math.min(pts, 15);
}

function d6_riscos(lead: Record<string, any>): { desconto: number; flags: string[] } {
  let desconto = 0;
  const flags: string[] = [];
  if (indicaCondicao(lead.condicao_cardiaca)) { desconto += 8; flags.push('CARDIO'); }
  if (isAfirmativo(lead.diabetes))            { desconto += 5; if (!flags.includes('SAUDE')) flags.push('SAUDE'); }
  if (indicaCondicao(lead.doenca_cronica))    { desconto += 5; if (!flags.includes('SAUDE')) flags.push('SAUDE'); }
  if (isAfirmativo(lead.lesao))               { desconto += 3; flags.push('LESAO'); }
  if (isAfirmativo(lead.trt) && !isAfirmativo(lead.medico_esporte)) {
    desconto += 5;
    flags.push('TRT_SEM_MEDICO');
  }
  if (flags.length >= 2) flags.push('RISCO_MULTIPLO');
  return { desconto, flags };
}

function calcularScoreBase(lead: Record<string, any>): { base: number; flags: string[] } {
  const demo  = d1_demografico(lead);
  const obj   = d2_objetivo(lead);
  const matur = d3_maturidade(lead);
  const comp  = d4_comprometimento(lead);
  const motiv = d5_motivacao(lead);
  const { desconto, flags } = d6_riscos(lead);
  const base = Math.max(0, Math.min(90, demo + obj + matur + comp + motiv - desconto));
  return { base, flags };
}

async function ajusteIA(lead: Record<string, any>): Promise<{ ajuste: number; justificativa: string }> {
  const geminiKey = process.env.GOOGLE_GEMINI_KEY;
  if (!geminiKey) return { ajuste: 0, justificativa: 'GOOGLE_GEMINI_KEY não configurada.' };

  const camposTexto = [
    lead.objetivo_outro      ? `Objetivo (texto livre): ${lead.objetivo_outro}` : null,
    lead.trt_detalhe         ? `Detalhe TRT: ${lead.trt_detalhe}` : null,
    lead.competicao_detalhe  ? `Detalhe competição: ${lead.competicao_detalhe}` : null,
    lead.lesao_detalhe       ? `Detalhe lesão: ${lead.lesao_detalhe}` : null,
    lead.suplementos_detalhe ? `Detalhe suplementação: ${lead.suplementos_detalhe}` : null,
  ].filter(Boolean) as string[];

  if (camposTexto.length === 0) {
    return { ajuste: 0, justificativa: 'Sem campos de texto livre para análise qualitativa.' };
  }

  const prompt = `Você é um assistente de triagem do Coach Ruiz, especialista em fisiculturismo de alto nível.

Analise os campos abaixo de um candidato ao Programa ELITE 90 PRO e retorne um ajuste de pontuação entre -10 e +10, acompanhado de uma justificativa objetiva de até 2 linhas.

Critérios de ajuste POSITIVO: protocolo de TRT detalhado e clinicamente coerente, histórico competitivo relevante (Classic Physique, Men's Physique ou categorias similares), stack de suplementação sofisticado, lesão resolvida com tratamento documentado.

Critérios de ajuste NEGATIVO: protocolo de TRT vago ou incoerente (risco clínico não gerenciado), objetivo "Outro" incompatível com a metodologia ELITE 90 PRO, lesão grave recente sem indicação de tratamento, suplementação inexistente apesar de declarar SIM.

CAMPOS PARA ANÁLISE:
${camposTexto.join('\n')}

Retorne JSON estrito: {"ajuste": número_inteiro_entre_-10_e_10, "justificativa": "texto de até 2 linhas"}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 256,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                ajuste:        { type: 'INTEGER' },
                justificativa: { type: 'STRING' },
              },
              required: ['ajuste', 'justificativa'],
            },
          },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json() as any;
    const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const parsed = JSON.parse(raw);
    const ajuste = Math.max(-10, Math.min(10, Number(parsed.ajuste ?? 0)));
    return { ajuste, justificativa: String(parsed.justificativa ?? '') };
  } catch (e: any) {
    console.warn(`  ⚠ Ajuste IA falhou: ${e.message}`);
    return { ajuste: 0, justificativa: 'Ajuste qualitativo indisponível.' };
  }
}

function classificarPrioridade(score: number): 'alta' | 'media' | 'baixa' | 'fora_do_perfil' {
  if (score >= 80) return 'alta';
  if (score >= 60) return 'media';
  if (score >= 40) return 'baixa';
  return 'fora_do_perfil';
}

// ── Processamento ─────────────────────────────────────────────────────────────

const PRIO_ICON: Record<string, string> = {
  alta: '🟢', media: '🟡', baixa: '🟠', fora_do_perfil: '🔴',
};

async function processarLead(doc: admin.firestore.QueryDocumentSnapshot): Promise<void> {
  const lead = doc.data();
  const { base, flags }           = calcularScoreBase(lead);
  const { ajuste, justificativa } = await ajusteIA(lead);
  const scoreFinal  = Math.max(0, Math.min(100, base + ajuste));
  const prioridade  = classificarPrioridade(scoreFinal);

  await db.collection('leads').doc(doc.id).update({
    score:               scoreFinal,
    score_base:          base,
    score_ajuste_ia:     ajuste,
    prioridade,
    score_flags:         flags,
    score_justificativa: justificativa,
    score_gerado_em:     admin.firestore.FieldValue.serverTimestamp(),
  });

  const ajusteStr = ajuste > 0 ? `+${ajuste}` : String(ajuste);
  console.log(
    `${PRIO_ICON[prioridade]} ${lead.nome.padEnd(45)} score=${String(scoreFinal).padStart(3)}  (base=${base}, ia=${ajusteStr})`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Buscando fichas MOCK no Firestore...');

  const snap  = await db.collection('leads').get();
  const mocks = snap.docs.filter(d => String(d.data().nome ?? '').includes('(MOCK'));

  if (mocks.length === 0) {
    console.log('Nenhuma ficha MOCK encontrada. Execute o seed antes de rodar este script.');
    process.exit(0);
  }

  console.log(`${mocks.length} fichas encontradas. Calculando scores...\n`);

  const CONCURRENCY = 5;
  let processadas = 0;
  let erros = 0;

  for (let i = 0; i < mocks.length; i += CONCURRENCY) {
    const lote = mocks.slice(i, i + CONCURRENCY);
    await Promise.all(lote.map(async (doc) => {
      try {
        await processarLead(doc);
        processadas++;
      } catch (err: any) {
        console.error(`  ✗ Erro em ${doc.id}: ${err.message}`);
        erros++;
      }
    }));
  }

  console.log(`\n✅ Concluído — ${processadas} processadas, ${erros} erro(s).`);
  process.exit(0);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
