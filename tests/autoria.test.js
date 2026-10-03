// tests/autoria.test.js
// Name of the author shown in the catalogue's "Procedência" block. The item keeps
// the stable uid in `criadoPor`; the listing resolves the name on read
// (netlify/functions/_autoria.ts). Firebase is replaced by stubs.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarTs } = require('./_carregar-ts.js');

const UID_PROF = 'uidProf1';
const UID_COACH = 'uidCoach1';
const UID_SEM_NOME = 'uidSemNome';
const UID_SUMIDO = 'uidSumido';

function instalarStubs(t, { usuarios, profissionais, falhaAuth = false }) {
  const chamadas = { getUsers: [], getAll: [] };
  globalThis.__e90Stubs = {
    'firebase-admin/auth': {
      getAuth: () => ({
        async getUsers(ids) {
          chamadas.getUsers.push(ids.map((i) => i.uid));
          if (falhaAuth) throw new Error('auth indisponível');
          return { users: ids.map((i) => usuarios[i.uid]).filter(Boolean), notFound: [] };
        },
      }),
    },
    'firebase-admin/firestore': {
      getFirestore: () => ({
        collection: (nome) => ({ doc: (id) => ({ nome, id }) }),
        async getAll(...refs) {
          chamadas.getAll.push(refs.map((r) => `${r.nome}/${r.id}`));
          return refs.map((r) => {
            const d = profissionais[r.id];
            return { exists: !!d, get: (c) => (d ? d[c] : undefined) };
          });
        },
      }),
    },
  };
  t.after(() => { delete globalThis.__e90Stubs; });
  return chamadas;
}

const USUARIOS = {
  [UID_PROF]: { uid: UID_PROF, displayName: 'Conta Prof', email: 'prof@x.com', customClaims: { professional: true, professionalId: 'p1' } },
  [UID_COACH]: { uid: UID_COACH, displayName: 'Coach Ruiz', email: 'coach@x.com', customClaims: { admin: true } },
  [UID_SEM_NOME]: { uid: UID_SEM_NOME, email: 'so-email@x.com', customClaims: {} },
};

test('rotuloDoAutor: marcador do sistema vira texto legível, mesmo sem conta', async () => {
  const { rotuloDoAutor } = await carregarTs('netlify/functions/_autoria.ts');
  assert.equal(rotuloDoAutor('sistema:carga-inicial', null), 'Carga inicial do sistema');
});

test('rotuloDoAutor: prefere o nome do cadastro profissional, depois displayName, depois e-mail', async () => {
  const { rotuloDoAutor } = await carregarTs('netlify/functions/_autoria.ts');
  assert.equal(rotuloDoAutor('u', { nomeProfissional: 'Dra. Ana', displayName: 'X', email: 'a@b.com' }), 'Dra. Ana');
  assert.equal(rotuloDoAutor('u', { nomeProfissional: '  ', displayName: 'Coach Ruiz', email: 'a@b.com' }), 'Coach Ruiz');
  assert.equal(rotuloDoAutor('u', { displayName: null, email: 'a@b.com' }), 'a@b.com');
  assert.equal(rotuloDoAutor('u', {}), null);
  assert.equal(rotuloDoAutor('u', null), null);
});

test('resolverAutores: profissional pelo cadastro, Coach pelo displayName, sem nome pelo e-mail', async (t) => {
  const chamadas = instalarStubs(t, { usuarios: USUARIOS, profissionais: { p1: { name: 'Dra. Ana Souza' } } });
  const { resolverAutores } = await carregarTs('netlify/functions/_autoria.ts');
  const m = await resolverAutores({}, [UID_PROF, UID_COACH, UID_SEM_NOME, UID_PROF]);
  assert.equal(m.get(UID_PROF), 'Dra. Ana Souza');
  assert.equal(m.get(UID_COACH), 'Coach Ruiz');
  assert.equal(m.get(UID_SEM_NOME), 'so-email@x.com');
  assert.equal(chamadas.getUsers.length, 1, 'uma chamada em lote');
  assert.deepEqual(chamadas.getUsers[0].sort(), [UID_COACH, UID_PROF, UID_SEM_NOME].sort(), 'uids repetidos consultados uma vez');
  assert.deepEqual(chamadas.getAll, [['professionals/p1']]);
});

test('resolverAutores: cadastro profissional sem nome cai no displayName da conta', async (t) => {
  instalarStubs(t, { usuarios: USUARIOS, profissionais: { p1: {} } });
  const { resolverAutores } = await carregarTs('netlify/functions/_autoria.ts');
  assert.equal((await resolverAutores({}, [UID_PROF])).get(UID_PROF), 'Conta Prof');
});

test('resolverAutores: conta removida não entra no mapa (a tela mostra o uid)', async (t) => {
  instalarStubs(t, { usuarios: USUARIOS, profissionais: {} });
  const { resolverAutores } = await carregarTs('netlify/functions/_autoria.ts');
  const m = await resolverAutores({}, [UID_SUMIDO]);
  assert.equal(m.has(UID_SUMIDO), false);
});

test('resolverAutores: sistema não consulta Firebase; null, vazio e outros marcadores são ignorados', async (t) => {
  const chamadas = instalarStubs(t, { usuarios: USUARIOS, profissionais: {} });
  const { resolverAutores } = await carregarTs('netlify/functions/_autoria.ts');
  const m = await resolverAutores({}, ['sistema:carga-inicial', null, undefined, '', 'coach:aprovacao-lote-03', 42]);
  assert.equal(m.get('sistema:carga-inicial'), 'Carga inicial do sistema');
  assert.equal(m.size, 1);
  assert.equal(chamadas.getUsers.length, 0);
});

test('resolverAutores: falha do Auth não propaga (best-effort), mantém o que não depende dele', async (t) => {
  instalarStubs(t, { usuarios: USUARIOS, profissionais: {}, falhaAuth: true });
  const { resolverAutores } = await carregarTs('netlify/functions/_autoria.ts');
  const m = await resolverAutores({}, ['sistema:carga-inicial', UID_PROF]);
  assert.equal(m.get('sistema:carga-inicial'), 'Carga inicial do sistema');
  assert.equal(m.has(UID_PROF), false);
});

test('resolverAutores: mais de 100 uids viram lotes de 100', async (t) => {
  const chamadas = instalarStubs(t, { usuarios: {}, profissionais: {} });
  const { resolverAutores } = await carregarTs('netlify/functions/_autoria.ts');
  await resolverAutores({}, Array.from({ length: 230 }, (_, i) => `u${i}`));
  assert.deepEqual(chamadas.getUsers.map((l) => l.length), [100, 100, 30]);
});
