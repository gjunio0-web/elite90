// ELITE90 PRO · limpar-homologacao
// -----------------------------------------------------------------------------
// Remove os registros sintéticos criados para avaliação interna: as fichas
// fictícias de seed-triagem-bulk.ts, os atletas promovidos a partir delas por
// promote-lead.ts, e as imagens compartilhadas de test_seed/ no Storage.
//
//   • ENSAIO EM SECO POR PADRÃO. Nada é gravado nem apagado sem --commit.
//   • RECUSA-SE A RODAR CONTRA PRODUÇÃO. A credencial é lida antes de qualquer
//     acesso e o project_id é comparado com a lista de projetos proibidos.
//   • NÃO APAGA NADA QUE NÃO ESTEJA MARCADO. Ficha só é candidata se o nome
//     casar com o padrão "(MOCK #NN)" gravado pelo semeador. Atleta só é
//     candidato se a ficha de origem for uma dessas, ou se o documento tiver
//     _mockPlan: true. Qualquer outro alvo exige --atleta=<uid> explícito.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUE ISTO EXISTE, SE JÁ HÁ delete-lead E clean-mock-leads
// ─────────────────────────────────────────────────────────────────────────────
// scripts/clean-mock-leads.ts lê a coleção leads inteira e apaga tudo, sem
// filtro nenhum. Contra o ambiente atual, que já tem fichas reais importadas da
// planilha de anamnese, ele destruiria dado de pessoa real. Não deve ser usado.
//
// netlify/functions/delete-lead.ts é correto e continua sendo o caminho certo
// para exclusão pontual pela tela, mas não serve para esta limpeza por dois
// motivos:
//
//   1. Ele apaga do Storage os arquivos listados em fotos_paths. Nas fichas
//      fictícias esses caminhos apontam para test_seed/{perfil}/candidato_N_*,
//      TRÊS ARQUIVOS POR PERFIL COMPARTILHADOS POR DEZENAS DE FICHAS. A
//      primeira exclusão levaria as imagens de todas as demais. Aqui o Storage
//      é alvo separado (--alvo=storage-seed), apagado uma vez só, ao final.
//   2. Ele devolve 409 para ficha com convertedAt — de propósito, porque as
//      fotos do Dia 1 do atleta são os mesmos arquivos da ficha. Este roteiro
//      trata o par ficha+atleta em conjunto, na ordem em que o elo permite.
//
// ─────────────────────────────────────────────────────────────────────────────
// ORDEM DE REMOÇÃO DO ATLETA, E POR QUE ELA É ESSA
// ─────────────────────────────────────────────────────────────────────────────
//   1. subcoleções de athletes/{uid} — o console do Firebase não as apaga junto
//      com o documento pai, e o esquema de persistência v3 prevê weights,
//      checkins e plans. Ficariam órfãs, invisíveis e cobradas.
//   2. o documento athletes/{uid}.
//   3. a conta de Auth. Se a conta tiver OUTRA claim além de athlete (admin,
//      por exemplo), o roteiro remove apenas a claim athlete e PRESERVA a
//      conta — promote-lead.ts reaproveita conta existente pelo e-mail, então
//      uma conta de atleta pode ser a mesma conta de outra pessoa do time.
//   4. os campos de elo na ficha de origem (convertedAt, convertedAthleteUid,
//      convertedBy, convertedByEmail). Sem isso a ficha continua bloqueada
//      para exclusão pela tela, e o painel continua exibindo-a como promovida.
//
// Só depois disso a ficha vira alvo elegível de --alvo=leads-mock.
//
// ─────────────────────────────────────────────────────────────────────────────
// ATENÇÃO — ARTEFATO DE HOMOLOGAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
// Este arquivo deve ser REMOVIDO no encerramento do projeto, junto com
// seed-triagem-bulk.ts, score-mocks.ts, clean-mock-leads.ts, emulate-fn08.js,
// patch-lead-email.js e ativar-planos-mock.js.
//
// Uso:
//   node scripts/limpar-homologacao.mjs --alvo=leads-mock
//   node scripts/limpar-homologacao.mjs --alvo=atletas
//   node scripts/limpar-homologacao.mjs --alvo=atletas --atleta=<uid>
//   node scripts/limpar-homologacao.mjs --alvo=storage-seed
//   node scripts/limpar-homologacao.mjs --alvo=atletas,leads-mock --commit
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// firebase-admin é carregado por import() DEPOIS das validações e da trava de
// ambiente, mais abaixo. Import estático é içado para o topo do módulo e
// rodaria antes de qualquer verificação — um roteiro de exclusão em massa não
// deve nem carregar o cliente do banco antes de saber contra qual projeto vai
// falar.

const AQUI = dirname(fileURLToPath(import.meta.url));

// Projetos onde este roteiro NUNCA roda, qualquer que seja o argumento.
const PROJETOS_PROIBIDOS = ['elite90-c716b'];

// O semeador grava o sufixo no campo nome (seed-triagem-bulk.ts, linha 95). O
// Firestore não tem operador "contém", então o filtro é aplicado em memória
// sobre a coleção lida — 90 documentos, custo irrelevante.
const PADRAO_MOCK = /\(MOCK #\d+\)/;

const PREFIXO_SEED = 'test_seed/';
const LOTE_MAXIMO = 400; // abaixo do teto de 500 operações por lote do Firestore

// ── Argumentos ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

const alvos = new Set(
  args
    .filter((a) => a.startsWith('--alvo='))
    .flatMap((a) => a.slice('--alvo='.length).split(','))
    .map((s) => s.trim())
    .filter(Boolean)
);

const UIDS_EXPLICITOS = args
  .filter((a) => a.startsWith('--atleta='))
  .map((a) => a.slice('--atleta='.length).trim())
  .filter(Boolean);

const ALVOS_VALIDOS = ['leads-mock', 'atletas', 'storage-seed'];

if (alvos.size === 0) {
  console.error(
    'Nenhum alvo declarado. Use --alvo= com um ou mais de: ' + ALVOS_VALIDOS.join(', ') + '\n' +
    'Sem alvo o roteiro não assume nada — apagar por omissão seria o erro que ele existe para evitar.'
  );
  process.exit(1);
}
for (const alvo of alvos) {
  if (!ALVOS_VALIDOS.includes(alvo)) {
    console.error(`Alvo desconhecido: "${alvo}". Válidos: ${ALVOS_VALIDOS.join(', ')}`);
    process.exit(1);
  }
}

// ── Credenciais (mesmo mecanismo de patch-lead-email.js) ─────────────────────
const envPath = resolve(AQUI, '../.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key.startsWith('#') || process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!saEnv) {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON ausente. Sem credencial declarada, o roteiro não executa.');
  process.exit(1);
}

let sa;
try {
  let raw = saEnv.trim();
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  if (raw.startsWith("'") && raw.endsWith("'")) raw = raw.slice(1, -1);
  try { sa = JSON.parse(raw); } catch { sa = JSON.parse(raw.replace(/\\"/g, '"')); }
  if (sa?.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
} catch (e) {
  console.error('Erro nas credenciais:', e.message);
  process.exit(1);
}

// ── TRAVA DE AMBIENTE ────────────────────────────────────────────────────────
// Vem ANTES de initializeApp: um roteiro de exclusão em massa não deve sequer
// abrir conexão com o projeto errado.
const projeto = sa?.project_id ?? '(desconhecido)';
if (PROJETOS_PROIBIDOS.includes(projeto)) {
  console.error(
    `RECUSADO: a credencial aponta para "${projeto}", que está na lista de projetos de produção.\n` +
    'Este roteiro apaga registros em massa e não roda contra produção em hipótese alguma.'
  );
  process.exit(1);
}

const bucketNome = process.env.PUBLIC_FIREBASE_STORAGE_BUCKET;
if (alvos.has('storage-seed') && !bucketNome) {
  console.error(
    'PUBLIC_FIREBASE_STORAGE_BUCKET ausente, e o alvo storage-seed precisa dela.\n' +
    'Não há valor padrão: assumir um bucket seria arriscar apagar no projeto errado.'
  );
  process.exit(1);
}

const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const { getAuth } = await import('firebase-admin/auth');
const { getStorage } = await import('firebase-admin/storage');

initializeApp(bucketNome ? { credential: cert(sa), storageBucket: bucketNome } : { credential: cert(sa) });
const db = getFirestore();
const auth = getAuth();

// ── Utilitários ──────────────────────────────────────────────────────────────
function seco(texto) { return COMMIT ? texto : `[ENSAIO] ${texto}`; }

async function apagarEmLotes(refs) {
  if (!COMMIT || refs.length === 0) return;
  for (let i = 0; i < refs.length; i += LOTE_MAXIMO) {
    const lote = db.batch();
    refs.slice(i, i + LOTE_MAXIMO).forEach((ref) => lote.delete(ref));
    await lote.commit();
  }
}

/** Apaga todas as subcoleções de um documento, em qualquer profundidade.
 *  listCollections() só existe no Admin SDK — é a razão de esta limpeza não
 *  poder ser feita pelo console nem pelo navegador. */
async function apagarSubcolecoes(docRef, trilha = []) {
  const subs = await docRef.listCollections();
  let total = 0;
  for (const sub of subs) {
    const snap = await sub.get();
    for (const doc of snap.docs) {
      total += await apagarSubcolecoes(doc.ref, [...trilha, sub.id, doc.id]);
    }
    console.log(seco(`    subcoleção ${sub.id}/ — ${snap.size} documento(s)`));
    await apagarEmLotes(snap.docs.map((d) => d.ref));
    total += snap.size;
  }
  return total;
}

// ── ALVO: atletas ────────────────────────────────────────────────────────────
async function limparAtletas() {
  console.log('\n═══ ATLETAS ═══');

  const snap = await db.collection('athletes').get();
  const candidatos = [];

  for (const doc of snap.docs) {
    const a = doc.data();

    if (UIDS_EXPLICITOS.includes(doc.id)) {
      candidatos.push({ doc, motivo: '--atleta declarado na linha de comando' });
      continue;
    }
    // Sem --atleta, só entram os que se identificam sozinhos. _test NÃO serve
    // como marcador: promote-lead.ts passa test: lead._test === true, e as
    // fichas do semeador não têm esse campo — logo os atletas promovidos delas
    // ficaram com _test: false. Marcador confiável é a ficha de origem.
    if (a._mockPlan === true) {
      candidatos.push({ doc, motivo: '_mockPlan: true (ativar-planos-mock.js)' });
      continue;
    }
    if (a.originLeadId) {
      const lead = await db.collection('leads').doc(String(a.originLeadId)).get();
      const nome = lead.exists ? String(lead.data().nome ?? '') : '';
      if (PADRAO_MOCK.test(nome)) {
        candidatos.push({ doc, motivo: `ficha de origem fictícia — ${nome}` });
      }
    }
  }

  const naoEncontrados = UIDS_EXPLICITOS.filter((uid) => !snap.docs.some((d) => d.id === uid));
  for (const uid of naoEncontrados) {
    console.log(`  ! ${uid} — declarado em --atleta, mas não existe em athletes/. Ignorado.`);
  }

  console.log(`Total na coleção: ${snap.size}. Candidatos: ${candidatos.length}.\n`);
  if (candidatos.length === 0) return;

  for (const { doc, motivo } of candidatos) {
    const a = doc.data();
    console.log(`• ${a.name ?? '(sem nome)'} — ${doc.id}`);
    console.log(`  motivo: ${motivo}`);

    // 1. subcoleções
    const subs = await apagarSubcolecoes(doc.ref);
    if (subs === 0) console.log('    subcoleções: nenhuma');

    // 2. documento
    console.log(seco('    documento athletes/' + doc.id));
    if (COMMIT) await doc.ref.delete();

    // 3. conta de Auth
    try {
      const conta = await auth.getUser(doc.id);
      const claims = conta.customClaims ?? {};
      const outras = Object.keys(claims).filter((k) => k !== 'athlete' && claims[k]);
      if (outras.length > 0) {
        console.log(seco(`    conta Auth PRESERVADA (tem também: ${outras.join(', ')}) — removida apenas a claim athlete`));
        if (COMMIT) {
          const { athlete, ...resto } = claims;
          await auth.setCustomUserClaims(doc.id, resto);
        }
      } else {
        console.log(seco(`    conta Auth ${conta.email ?? doc.id}`));
        if (COMMIT) await auth.deleteUser(doc.id);
      }
    } catch (e) {
      if (e?.code === 'auth/user-not-found') console.log('    conta Auth: já não existe');
      else console.log(`    conta Auth: erro — ${e?.message ?? e}`);
    }

    // 4. elo na ficha de origem
    if (a.originLeadId) {
      const leadRef = db.collection('leads').doc(String(a.originLeadId));
      const lead = await leadRef.get();
      if (lead.exists) {
        console.log(seco(`    elo desfeito na ficha ${a.originLeadId} (convertedAt, convertedAthleteUid, convertedBy, convertedByEmail)`));
        if (COMMIT) {
          await leadRef.update({
            convertedAt: FieldValue.delete(),
            convertedAthleteUid: FieldValue.delete(),
            convertedBy: FieldValue.delete(),
            convertedByEmail: FieldValue.delete(),
          });
        }
      } else {
        console.log(`    ficha de origem ${a.originLeadId} já não existe`);
      }
    }
    console.log('');
  }
}

// ── ALVO: leads-mock ─────────────────────────────────────────────────────────
async function limparLeadsMock() {
  console.log('\n═══ FICHAS FICTÍCIAS ═══');

  const snap = await db.collection('leads').get();
  const todas = snap.docs.filter((d) => PADRAO_MOCK.test(String(d.data().nome ?? '')));
  const promovidas = todas.filter((d) => d.data().convertedAt);
  const alvo = todas.filter((d) => !d.data().convertedAt);

  console.log(`Total na coleção: ${snap.size}. Fichas fictícias: ${todas.length}.`);
  if (promovidas.length > 0) {
    console.log(
      `\n  ${promovidas.length} ficha(s) ainda com convertedAt — PULADAS.\n` +
      '  São candidatos promovidos: rodar antes --alvo=atletas, que desfaz o elo.\n' +
      '  Apagar a ficha antes disso deixaria o atleta com baselinePhotos apontando\n' +
      '  para arquivos sem dono e sem nenhum registro que levasse de volta a eles.'
    );
    promovidas.forEach((d) => console.log(`    - ${d.data().nome} (${d.id})`));
  }
  console.log(`\nA apagar: ${alvo.length}.\n`);
  if (alvo.length === 0) return;

  // Avaliações vinculadas, pela mesma cascata de delete-lead.ts: o documento em
  // avaliacoes guarda nome, e-mail, o texto integral e o token que abre
  // /avaliacao/{token}, página pública sem autenticação. Apagar só a ficha
  // deixaria esse conjunto acessível a quem tivesse o link.
  const avaliacoesRefs = [];
  for (const doc of alvo) {
    const av = await db.collection('avaliacoes').where('leadId', '==', doc.id).get();
    av.docs.forEach((d) => avaliacoesRefs.push(d.ref));
  }

  console.log(seco(`${avaliacoesRefs.length} avaliação(ões) vinculada(s)`));
  console.log(seco(`${alvo.length} ficha(s) em leads/`));
  console.log(
    '\nAs fotos NÃO são tocadas aqui: fotos_paths destas fichas apontam para\n' +
    'test_seed/, compartilhado entre elas. Use --alvo=storage-seed, ao final.'
  );

  if (!COMMIT) {
    alvo.slice(0, 5).forEach((d) => console.log(`    - ${d.data().nome} (${d.id})`));
    if (alvo.length > 5) console.log(`    … e mais ${alvo.length - 5}`);
    return;
  }

  // Avaliações primeiro: se falhar, a ficha permanece e a operação pode ser
  // repetida. O inverso deixaria avaliação órfã. Mesma ordem de delete-lead.ts.
  await apagarEmLotes(avaliacoesRefs);
  await apagarEmLotes(alvo.map((d) => d.ref));
  console.log('\nConcluído.');
}

// ── ALVO: storage-seed ───────────────────────────────────────────────────────
async function limparStorageSeed() {
  console.log('\n═══ IMAGENS SINTÉTICAS (Storage) ═══');
  console.log(`Bucket: ${bucketNome}`);

  const bucket = getStorage().bucket(bucketNome);
  const [arquivos] = await bucket.getFiles({ prefix: PREFIXO_SEED });

  // Guarda: qualquer ficha ainda viva que aponte para test_seed/ perderia as
  // imagens agora. Este alvo é o último passo da limpeza, não o primeiro.
  const leads = await db.collection('leads').get();
  const dependentes = leads.docs.filter((d) => {
    const p = d.data().fotos_paths;
    return Array.isArray(p) && p.some((c) => String(c).startsWith(PREFIXO_SEED));
  });

  console.log(`Arquivos sob ${PREFIXO_SEED}: ${arquivos.length}`);
  if (dependentes.length > 0) {
    console.log(
      `\n  ATENÇÃO: ${dependentes.length} ficha(s) ainda apontam para estes arquivos.\n` +
      '  Apagá-los agora deixaria essas fichas exibindo imagem quebrada, e\n' +
      '  storage.rules nega escrita em test_seed/ — repor exigiria upload pelo\n' +
      '  Admin SDK. Rodar --alvo=leads-mock antes.'
    );
    if (COMMIT) {
      console.log('\nRECUSADO enquanto houver fichas dependentes.');
      return;
    }
  }
  if (arquivos.length === 0) return;

  console.log(seco(`apagar ${arquivos.length} arquivo(s)`));
  if (!COMMIT) {
    arquivos.slice(0, 6).forEach((f) => console.log(`    - ${f.name}`));
    if (arquivos.length > 6) console.log(`    … e mais ${arquivos.length - 6}`);
    return;
  }
  const erros = [];
  await Promise.all(arquivos.map((f) => f.delete().catch((e) => erros.push(`${f.name}: ${e.message}`))));
  console.log(`Apagados: ${arquivos.length - erros.length}. Falhas: ${erros.length}.`);
  erros.forEach((e) => console.log(`    ! ${e}`));

  // O bloco match /test_seed/{allPaths=**} de storage.rules, com allow read: if
  // true, deixa de ter objeto para proteger depois desta remoção. Ele está no
  // inventário de artefatos a remover no encerramento do projeto.
  console.log('\nLembrete: o bloco test_seed/ em storage.rules pode ser removido junto.');
}

// ── Execução ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('== LIMPEZA DE ARTEFATOS DE HOMOLOGAÇÃO ==');
  console.log(`Projeto:  ${projeto}`);
  console.log(`Alvos:    ${[...alvos].join(', ')}`);
  console.log(COMMIT ? 'Modo:     GRAVAÇÃO (--commit)' : 'Modo:     ENSAIO EM SECO (nada é apagado; use --commit)');

  // Ordem fixa, independente da ordem dos argumentos: o atleta libera a ficha,
  // e a ficha libera as imagens.
  if (alvos.has('atletas')) await limparAtletas();
  if (alvos.has('leads-mock')) await limparLeadsMock();
  if (alvos.has('storage-seed')) await limparStorageSeed();

  if (!COMMIT) console.log('\n(Ensaio em seco — nada foi alterado.)');
}

main().catch((e) => { console.error('\nErro:', e?.message ?? e); process.exit(1); });
