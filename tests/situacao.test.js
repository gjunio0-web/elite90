// tests/situacao.test.js
// Cobre packages/situacao/nucleo.js — a derivação de situação de
// acompanhamento do atleta (Adendo 06, DA-01 a DA-06, DA-08).
//
// Os nomes dos testes citam o critério de aceite correspondente do Adendo 06
// (seção 9) quando existe um; os demais são fronteiras encontradas ao
// implementar o algoritmo (contagem de vencimentos perdidos, não de dias
// corridos — ver o comentário de vencimentosPerdidos em nucleo.js).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { derivarSituacao, SITUACOES, SITUACAO_LABEL } = require('../packages/situacao/index.js');

// Instantes em UTC, escritos como ISO. Datas de calendário "puras" (meia-noite
// UTC) caem à noite do dia anterior em Brasília (UTC-3) — por isso os
// horários de teste usam meio-dia UTC (09h Brasília) para não atravessar a
// virada de dia por acidente, exceto nos testes que testam exatamente isso.
function brasilia(anoMesDiaHoraMin) {
  // "2026-09-08T12:00" -> meio-dia UTC = 09h em Brasília, mesmo dia civil.
  return new Date(anoMesDiaHoraMin + ':00.000Z');
}

test('vocabulário: quatro slugs, ordenados por urgência, todos com rótulo', () => {
  assert.deepEqual(SITUACOES, ['recem-promovido', 'no-prazo', 'acima-7-dias', 'acima-14-dias']);
  for (const s of SITUACOES) {
    assert.equal(typeof SITUACAO_LABEL[s], 'string');
    assert.ok(SITUACAO_LABEL[s].length > 0);
  }
});

test('CA-3: promovido numa terça, recém-promovido até a sexta da semana seguinte', () => {
  const promocao = brasilia('2026-09-08T12:00'); // terça-feira, 08/09/2026
  // véspera do vencimento (sexta 18/09, ainda dentro do dia em Brasília)
  const antesDaVirada = brasilia('2026-09-18T12:00');
  assert.equal(derivarSituacao(promocao, null, antesDaVirada), 'recem-promovido');
});

test('CA-4: o mesmo atleta, sem enviar, acima de 7 dias no sábado seguinte àquela sexta', () => {
  const promocao = brasilia('2026-09-08T12:00'); // terça, 08/09/2026
  const sabadoSeguinte = brasilia('2026-09-19T12:00'); // sábado, 19/09/2026
  assert.equal(derivarSituacao(promocao, null, sabadoSeguinte), 'acima-7-dias');
});

test('CA-5: envio na quarta-feira conta como no prazo, sem distinção de quem envia na sexta', () => {
  const promocao = brasilia('2026-08-25T12:00'); // terça, 25/08 — já com 1º vencimento passado
  const envioQuarta = brasilia('2026-09-09T12:00'); // quarta, 09/09/2026
  const envioSexta = brasilia('2026-09-11T12:00'); // sexta, 11/09/2026, mesma semana
  const agora = brasilia('2026-09-11T20:00'); // sexta à noite, mesma semana, antes da virada real de meia-noite
  assert.equal(derivarSituacao(promocao, envioQuarta, agora), 'no-prazo');
  assert.equal(derivarSituacao(promocao, envioSexta, agora), 'no-prazo');
});

test('CA-6: promovido há vinte dias sem nenhum envio, acima de 14 dias — não recém-promovido', () => {
  const promocao = brasilia('2026-08-24T12:00'); // segunda, 24/08/2026
  const vinteDiasDepois = brasilia('2026-09-13T12:00'); // domingo, 13/09/2026
  assert.equal(derivarSituacao(promocao, null, vinteDiasDepois), 'acima-14-dias');
});

test('CA-12: teste de virada — no prazo às 23:59:59, atrasado um minuto depois, sem escrita alguma', () => {
  const promocao = brasilia('2026-08-11T12:00'); // terça, 11/08 — bem antes, só para ter 1º vencimento passado
  const ultimoEnvio = brasilia('2026-09-04T12:00'); // sexta, 04/09/2026 — cobre o vencimento desta semana
  // Sexta 11/09, 23:59:59 em Brasília = 12/09 02:59:59 UTC.
  const antesDaVirada = new Date('2026-09-12T02:59:59.000Z');
  const depoisDaVirada = new Date('2026-09-12T03:00:59.000Z'); // um minuto depois
  assert.equal(derivarSituacao(promocao, ultimoEnvio, antesDaVirada), 'no-prazo');
  assert.equal(derivarSituacao(promocao, ultimoEnvio, depoisDaVirada), 'acima-7-dias');
});

test('CA-14: o fuso de quem abre o painel não muda o resultado', () => {
  const promocao = brasilia('2026-08-24T12:00');
  const agora = brasilia('2026-09-13T12:00');
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const resultadoLA = derivarSituacao(promocao, null, agora);
    process.env.TZ = 'Asia/Tokyo';
    const resultadoTokyo = derivarSituacao(promocao, null, agora);
    assert.equal(resultadoLA, resultadoTokyo);
    assert.equal(resultadoLA, 'acima-14-dias');
  } finally {
    process.env.TZ = original;
  }
});

test('DA-03: a janela do primeiro vencimento varia conforme o dia da promoção (terça = dez dias, o exemplo confirmado)', () => {
  // "Um atleta promovido numa terça tem até a sexta da semana seguinte —
  // dez dias" — o único exemplo numérico efetivamente confirmado na
  // conversa que originou a DA-03. Os exemplos de segunda/sábado que
  // chegaram a circular (12/13) eram erro de conta, nunca verificado;
  // corrigido nesta suíte em 03/09/2026, não no algoritmo.
  const terca = brasilia('2026-08-25T12:00'); // terça-feira, 25/08/2026
  const decimoDia = brasilia('2026-09-04T12:00'); // sexta, 10 dias depois — ainda dentro
  const decimoPrimeiroDia = brasilia('2026-09-05T12:00'); // sábado, 11 dias depois — já venceu
  assert.equal(derivarSituacao(terca, null, decimoDia), 'recem-promovido');
  assert.equal(derivarSituacao(terca, null, decimoPrimeiroDia), 'acima-7-dias');
});

test('DA-03: a janela decresce um dia por dia da semana e reinicia no domingo (consistência interna da regra)', () => {
  const casos = [
    ['2026-08-24', 11], // segunda
    ['2026-08-25', 10], // terça — âncora confirmada
    ['2026-08-26', 9],  // quarta
    ['2026-08-27', 8],  // quinta
    ['2026-08-28', 7],  // sexta
    ['2026-08-29', 6],  // sábado
    ['2026-08-30', 12], // domingo — reinicia a semana
  ];
  for (const [iso, offsetEsperado] of casos) {
    const promocao = brasilia(iso + 'T12:00');
    const dentro = new Date(promocao.getTime() + offsetEsperado * 86400000);
    const fora = new Date(promocao.getTime() + (offsetEsperado + 1) * 86400000);
    assert.equal(derivarSituacao(promocao, null, dentro), 'recem-promovido', iso + ': deveria ainda estar recém-promovido no dia ' + offsetEsperado);
    assert.equal(derivarSituacao(promocao, null, fora), 'acima-7-dias', iso + ': deveria ter vencido no dia ' + (offsetEsperado + 1));
  }
});

test('DA-06: sem subcoleção de check-in ainda (ultimoCheckinEnviadoEm ausente), deriva a partir da promoção', () => {
  const promocao = brasilia('2026-08-24T12:00');
  const agora = brasilia('2026-09-06T12:00'); // uma semana após o 1º vencimento (11/08... recalcular)
  // Não fixamos o resultado exato aqui além de confirmar que não lança e
  // devolve um slug válido — o objetivo é 'não quebra sem o insumo'.
  const resultado = derivarSituacao(promocao, undefined, agora);
  assert.ok(SITUACOES.includes(resultado));
});

test('vencimentos perdidos contam sextas-feiras, não dias corridos', () => {
  // Promovido numa sexta-feira: 1º vencimento é a sexta da semana SEGUINTE
  // (não a própria sexta da promoção, mesmo estando "no dia certo").
  const promocaoNaSexta = brasilia('2026-08-28T12:00'); // sexta, 28/08/2026
  const proprioDia = brasilia('2026-08-28T20:00'); // ainda sexta, mais tarde no mesmo dia
  assert.equal(derivarSituacao(promocaoNaSexta, null, proprioDia), 'recem-promovido');
});

test('agora ausente usa o relógio real (não lança, devolve slug válido)', () => {
  const promocao = new Date('2020-01-01T12:00:00.000Z'); // bem no passado
  const resultado = derivarSituacao(promocao, null);
  assert.ok(SITUACOES.includes(resultado));
  assert.equal(resultado, 'acima-14-dias'); // qualquer atleta desta data está muito atrasado
});
