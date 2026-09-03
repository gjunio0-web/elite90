// @elite90/situacao — situação de acompanhamento do atleta.
// ÚNICA FONTE para o painel (atletas.astro, via ?raw), funções Netlify e
// scripts. Este arquivo NÃO pode conter import/export: é injetado como
// script clássico em <script is:inline set:html={...}>, onde o navegador
// rejeita a sintaxe de módulo. index.js importa este arquivo e reexporta as
// funções a partir de globalThis.__elite90Situacao (ver abaixo). Mesmo
// arranjo de @elite90/busca — ver o cabeçalho de packages/busca/nucleo.js.
//
// Adendo 06 ao Esquema de Persistência do Módulo M2 — Situação de
// Acompanhamento do Atleta, versão 1.3. DA-01 a DA-06 e DA-08 é o que este
// arquivo implementa. Nada aqui é gravado: a situação é calculada a cada
// leitura (DA-01), nunca armazenada.

// DA-08: a virada é o fim da sexta-feira em horário de Brasília, corte único
// para todos os atletas, independente de onde estejam — não a hora de quem
// abre o painel. Brasil não observa horário de verão desde 2019: o
// deslocamento de Brasília em relação ao UTC é constante o ano inteiro, o
// que permite somar/subtrair semanas em milissegundos sem consultar tabela
// de transições (ver _proximoLimite abaixo).
var FUSO_VIRADA = 'America/Sao_Paulo';

var UMA_SEMANA_MS = 7 * 24 * 60 * 60 * 1000;

// DA-05: vocabulário fechado das quatro faixas, ordenadas por urgência.
var SITUACOES = ['recem-promovido', 'no-prazo', 'acima-7-dias', 'acima-14-dias'];

// Rótulo de exibição — texto de DA-05, mesmo padrão de FASE_LABEL em
// atletas.astro (Adendo 03, AF-10): o slug é o identificador estável para
// código e CSS; o texto ao lado é só para a tela.
var SITUACAO_LABEL = {
  'recem-promovido': 'Recém-promovido',
  'no-prazo': 'Check-in no prazo',
  'acima-7-dias': 'Check-in acima de 7 dias',
  'acima-14-dias': 'Check-in acima de 14 dias',
};

// Componentes de data civil (ano, mês, dia, dia da semana) na virada de
// Brasília, a partir de um instante. O timeZone é sempre explícito — nunca
// o fuso de quem executa o código — para que o resultado independa de onde
// o navegador do Coach está (critério de aceite 14 do Adendo 06).
function _civilBrasilia(instante) {
  var fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSO_VIRADA,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  var partes = {};
  fmt.formatToParts(instante).forEach(function (p) { partes[p.type] = p.value; });
  var DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    diaSemana: DIAS[partes.weekday],
  };
}

// Normaliza um trio ano/mês/dia que pode ter estourado o mês (ex.: dia 40)
// pela calculadora de calendário do próprio JS. Isto NÃO representa um
// instante real — é usado só como calculadora, nunca convertido de volta
// sem passar por _fimDoDiaBrasilia.
function _normalizarDiaCivil(ano, mes, dia) {
  var d = new Date(Date.UTC(ano, mes - 1, dia));
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

// Instante UTC correspondente a 23:59:59,999 de um dia civil em Brasília.
// 23:59:59,999 em UTC-3 é 02:59:59,999 do dia seguinte em UTC — Date.UTC
// normaliza a hora 26 para o dia seguinte automaticamente.
function _fimDoDiaBrasilia(ano, mes, dia) {
  return new Date(Date.UTC(ano, mes - 1, dia, 26, 59, 59, 999));
}

// Sexta-feira (fim do dia, Brasília) da semana que CONTÉM o instante dado.
function _sextaDaSemana(instante) {
  var c = _civilBrasilia(instante);
  var alvo = _normalizarDiaCivil(c.ano, c.mes, c.dia + (5 - c.diaSemana));
  return _fimDoDiaBrasilia(alvo.ano, alvo.mes, alvo.dia);
}

// DA-03: primeiro vencimento é a sexta-feira da semana SEGUINTE à da
// promoção — nunca a sexta da própria semana, mesmo que a promoção tenha
// sido numa segunda-feira. Somar 7 dias em milissegundos preserva o
// horário de Brasília do resultado porque não há horário de verão.
function _primeiroVencimento(createdAt) {
  return new Date(_sextaDaSemana(createdAt).getTime() + UMA_SEMANA_MS);
}

// O vencimento mais recente já passado (ou vigente, se hoje é sexta antes
// da virada), em relação ao instante `agora`.
function _corteMaisRecente(agora) {
  var c = _civilBrasilia(agora);
  var diasDesdeSexta = (c.diaSemana - 5 + 7) % 7;
  var alvo = _normalizarDiaCivil(c.ano, c.mes, c.dia - diasDesdeSexta);
  var corte = _fimDoDiaBrasilia(alvo.ano, alvo.mes, alvo.dia);
  // Hoje é sexta, mas a virada ainda não chegou: o corte vigente é o da
  // sexta anterior, não o de hoje.
  if (corte > agora) corte = new Date(corte.getTime() - UMA_SEMANA_MS);
  return corte;
}

/**
 * Deriva a situação de acompanhamento do atleta (Adendo 06, DA-01 a DA-06).
 * Nunca armazenada — calculada a cada leitura.
 *
 * @param {Date} createdAt - data de promoção (createdAt do documento do
 *   atleta). Referência do primeiro vencimento (DA-03), não startDate.
 * @param {Date|null} [ultimoCheckinEnviadoEm] - data do último check-in
 *   ENVIADO (DA-04, não o respondido). null/undefined antes da Fase 4 —
 *   ainda sem subcoleção — ou se o atleta nunca enviou nenhum (DA-06:
 *   derivação parcial aceita, contando sempre a partir da promoção).
 * @param {Date} [agora] - instante de referência. Parâmetro de teste;
 *   produção usa o relógio real por padrão.
 * @returns {string} um dos slugs de SITUACOES.
 */
function derivarSituacao(createdAt, ultimoCheckinEnviadoEm, agora) {
  agora = agora || new Date();
  var primeiroVencimento = _primeiroVencimento(createdAt);

  if (agora <= primeiroVencimento) return 'recem-promovido';

  var corteCorrente = _corteMaisRecente(agora);

  // O vencimento que o último envio cobre é a sexta da SEMANA DO ENVIO em
  // si (sem somar mais uma semana — essa regra é só para o primeiro
  // vencimento, DA-03). Sem envio algum, trata-se como se o único
  // vencimento coberto fosse o anterior ao primeiro (DA-06: contagem parte
  // da promoção).
  var vencimentoCoberto = (ultimoCheckinEnviadoEm != null)
    ? _sextaDaSemana(ultimoCheckinEnviadoEm)
    : new Date(primeiroVencimento.getTime() - UMA_SEMANA_MS);

  if (vencimentoCoberto >= corteCorrente) return 'no-prazo';

  var vencimentosPerdidos = Math.round(
    (corteCorrente.getTime() - vencimentoCoberto.getTime()) / UMA_SEMANA_MS
  );
  return vencimentosPerdidos >= 2 ? 'acima-14-dias' : 'acima-7-dias';
}

globalThis.__elite90Situacao = {
  FUSO_VIRADA: FUSO_VIRADA,
  SITUACOES: SITUACOES,
  SITUACAO_LABEL: SITUACAO_LABEL,
  derivarSituacao: derivarSituacao,
};
