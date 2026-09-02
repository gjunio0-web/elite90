// tests/athlete-from-lead.test.js
// Cobre a conversão de tipos da Fase 2 do plano de persistência
// (Esquema v3, seção 5) no contrato lead -> documento de atleta.
//
// Foco: os dois campos com conversão de UNIDADE, não só de tipo —
// heightCm (metros -> centímetros) e dailyMinutes (horas -> minutos), este
// último o achado registrado em 02/09/2026: o campo chegava do lead em
// horas e o esquema pede minutos; sem a conversão explícita, o valor seria
// gravado como se já estivesse em minutos, dois onde deveriam ser cento e
// vinte. E o campo birthDate, que substitui a idade armazenada.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { athleteFromLead, parseBrDate } = require('../netlify/functions/_athlete-from-lead.js');

const LEAD_BASE = {
  id: 'lead-1',
  nome: 'Atleta de Teste',
  email: 'atleta@example.com',
  objetivo: 'Hipertrofia',
  peso: '82,5',
  altura: '1,78',
  tempo_atividade: '3',
  frequencia_semanal: '4',
  disponibilidade_diaria: '1,5',
  data_nascimento: '15/06/1990',
  score_flags: [],
};

const NOW = new Date(2026, 8, 2); // 02/09/2026, mês 0-indexado

test('dailyMinutes converte horas do lead para minutos (o achado da unidade)', () => {
  const doc = athleteFromLead(LEAD_BASE, null, { now: NOW });
  // disponibilidade_diaria = "1,5" horas -> 90 minutos, não 1.5.
  assert.equal(doc.dailyMinutes, 90);
});

test('heightCm converte metros do lead para centímetros', () => {
  const doc = athleteFromLead(LEAD_BASE, null, { now: NOW });
  // altura = "1,78" metros -> 178 cm.
  assert.equal(doc.heightCm, 178);
});

test('arredondamento de dailyMinutes e heightCm', () => {
  const doc = athleteFromLead(
    { ...LEAD_BASE, altura: '1,783', disponibilidade_diaria: '1,52' },
    null,
    { now: NOW }
  );
  // 1,783 m * 100 = 178,3 -> arredonda para 178.
  assert.equal(doc.heightCm, 178);
  // 1,52 h * 60 = 91,2 min -> arredonda para 91.
  assert.equal(doc.dailyMinutes, 91);
});

test('trainingYears e weeklyFrequency são renomeação pura, sem sufixo de texto', () => {
  const doc = athleteFromLead(LEAD_BASE, null, { now: NOW });
  assert.equal(doc.trainingYears, 3);
  assert.equal(doc.weeklyFrequency, 4);
  assert.equal(typeof doc.trainingYears, 'number');
  assert.equal(typeof doc.weeklyFrequency, 'number');
});

test('campos ausentes no lead viram null, não erro', () => {
  const leadIncompleto = { ...LEAD_BASE, altura: undefined, disponibilidade_diaria: undefined };
  const doc = athleteFromLead(leadIncompleto, null, { now: NOW });
  assert.equal(doc.heightCm, null);
  assert.equal(doc.dailyMinutes, null);
});

test('weightInitialKg e weightCurrentKg substituem weight_init/weight_now; weight_change não existe mais', () => {
  const doc = athleteFromLead(LEAD_BASE, null, { now: NOW });
  assert.equal(doc.weightInitialKg, 82.5);
  assert.equal(doc.weightCurrentKg, 82.5);
  assert.equal('weight_init' in doc, false);
  assert.equal('weight_now' in doc, false);
  assert.equal('weight_change' in doc, false);
});

test('birthDate substitui age; idade não é mais armazenada', () => {
  const doc = athleteFromLead(LEAD_BASE, null, { now: NOW });
  assert.ok(doc.birthDate instanceof Date);
  assert.equal(doc.birthDate.getFullYear(), 1990);
  assert.equal(doc.birthDate.getMonth(), 5); // junho, 0-indexado
  assert.equal(doc.birthDate.getDate(), 15);
  assert.equal('age' in doc, false);
});

test('birthDate no futuro é rejeitada (null)', () => {
  const doc = athleteFromLead({ ...LEAD_BASE, data_nascimento: '15/06/2030' }, null, { now: NOW });
  assert.equal(doc.birthDate, null);
});

test('birthDate implausivelmente antiga é rejeitada (null)', () => {
  const doc = athleteFromLead({ ...LEAD_BASE, data_nascimento: '15/06/1850' }, null, { now: NOW });
  assert.equal(doc.birthDate, null);
});

test('startDate: opts.startDate "DD/MM/AAAA" vira Date', () => {
  const doc = athleteFromLead(LEAD_BASE, null, { now: NOW, startDate: '10/09/2026' });
  assert.ok(doc.startDate instanceof Date);
  assert.equal(doc.startDate.getFullYear(), 2026);
  assert.equal(doc.startDate.getMonth(), 8);
  assert.equal(doc.startDate.getDate(), 10);
});

test('startDate ausente cai em now', () => {
  const doc = athleteFromLead(LEAD_BASE, null, { now: NOW });
  assert.equal(doc.startDate.getTime(), NOW.getTime());
});

test('startDate malformada lança erro (contrato assume validação prévia do chamador)', () => {
  assert.throws(() => {
    athleteFromLead(LEAD_BASE, null, { now: NOW, startDate: '31/02/2026' });
  }, /startDate inválida/);
});

test('createdAt e updatedAt são Date, não string ISO', () => {
  const doc = athleteFromLead(LEAD_BASE, null, { now: NOW });
  assert.ok(doc.createdAt instanceof Date);
  assert.ok(doc.updatedAt instanceof Date);
  assert.equal(doc.createdAt.getTime(), NOW.getTime());
});

test('parseBrDate: forma exportada, mesma validação de calendário que a interna', () => {
  assert.equal(parseBrDate('29/02/2024') instanceof Date, true); // 2024 é bissexto
  assert.equal(parseBrDate('29/02/2026'), null); // 2026 não é
  assert.equal(parseBrDate('não é data'), null);
  assert.equal(parseBrDate(''), null);
  assert.equal(parseBrDate(null), null);
});
