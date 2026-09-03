// _athlete-from-lead.js
// Contrato de mapeamento Lead (M1) -> Documento de Atleta (M2).
//
// Função PURA, sem dependências externas. O runner de emulação
// (scripts/emulate-fn08.js) e o futuro FN-08 (stripe-webhook) importam a MESMA
// função, de modo que a emulação valide o contrato de verdade — e não uma
// tradução paralela que depois divergiria do webhook real.
//
// O prefixo "_" segue a convenção de _scoring.ts: arquivos assim NÃO são
// tratados como endpoint de Netlify Function, apenas como módulo compartilhado.
//
// Campos de SAÍDA ancorados no que /admin/atletas (atletas.astro) de fato lê.
// Levantamento exaustivo dos acessos athlete.* / a.* no arquivo:
//
//   LISTA (tabela + KPIs + CSV)
//   - name, email (status SAIU — Adendo 06, DA-01: derivado na leitura,
//     nunca gravado; ver @elite90/situacao)
//   - phone -> NÃO lido pelo M2 hoje; existe para o compartilhamento de plano
//             por mensagem. Normalizado em E.164 sem "+" (ver toPhoneE164).
//   - startDate  -> Date. Era string "DD/MM/YYYY" (Esquema v3, seção 5); a
//                   interface formata na leitura, e o cálculo de dia/semana
//                   do ciclo em promote-lead.ts segue lendo o parâmetro de
//                   entrada, que continua string — a conversão é só na saída.
//   - phase ("Bulking"|"Cutting"|"Diet Break") — week e day SAÍRAM
//     (Esquema v3, seção 5: deriváveis de startDate)
//   - weightInitialKg, weightCurrentKg -> renomeação pura de weight_init/
//     weight_now. weight_change SAIU do contrato (Esquema v3, seção 5: é
//     campo que deixa de existir, derivado de inicial e atual na leitura).
//
//   DRAWER > VISÃO GERAL > "Perfil do Atleta"  (openAthleteDrawer, ~l.2285)
//   TIPOS NATIVOS (Esquema v3, seção 5; conversão de tipos da Fase 2 do plano
//   de persistência). Idade deixou de ser gravada — é derivada de birthDate
//   na leitura (princípio P3: o que pode ser derivado não é armazenado).
//   - birthDate        -> Date | null. A interface formata e deriva a idade.
//   - heightCm         -> number | null. Metros * 100, arredondado.
//   - trainingYears    -> number | null. Renomeação pura de years_active.
//   - weeklyFrequency  -> number | null. Renomeação de freq, sem sufixo de texto.
//   - dailyMinutes     -> number | null. Horas * 60, arredondado — o campo
//                         chegava do lead em horas; o esquema pede minutos.
//   - goal             -> string | null. Sem mudança.
//   - flags            -> array de códigos; o M2 filtra por FLAG_META
//                         (CARDIO | SAUDE | LESAO | TRT_SEM_MEDICO)
//
//   OUTRAS ABAS
//   - checkin (null até o 1º check-in), prev, avaliacao, baselinePhotos, planStatus
//
//   RÓTULO EXTERNO (Adendo 02 — Delegação, seção 5.1, AD-03/AD-04)
//   - externalLabel -> "ATL-" + 4 símbolos, sorteado, imutável. Recebido por
//                      parâmetro, como `genero`: quem chama sorteia e confere
//                      colisão no banco (promote-lead.ts); este contrato é puro
//                      e só grava o que recebe. Forma em _external-label.js.
//
// ATENÇÃO ao idioma das chaves: o lead do M1 usa pt-BR (nome, objetivo,
// altura...), o documento de atleta do M2 usa en (name, goal, height...).
// A tradução acontece AQUI — e é a razão de ser deste contrato.
//
// Os campos originLeadId, evaluationToken e payment são de rastreabilidade:
// acompanham o documento para auditoria e para o FN-08 real, mesmo sem leitura
// pelo M2 hoje.

'use strict';

/**
 * Converte "1,75" ou "1.75" (ou número) em Number. Retorna null se inválido.
 * O TriageModal normaliza os campos *_visual em campos ocultos, mas aceitamos
 * as duas grafias por segurança.
 * @param {*} v
 * @returns {number|null}
 */
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Converte "DD/MM/AAAA" em Date. Retorna null se ausente, malformada, ou se
 * a data não existir no calendário (ex.: 31/02/2026) — mesma checagem de
 * isValidBrDate em promote-lead.ts, aqui devolvendo o valor em vez de um
 * booleano.
 * @param {*} str
 * @returns {Date|null}
 */
function parseBrDate(str) {
  if (!str || typeof str !== 'string') return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(+yyyy, +mm - 1, +dd);
  const valida = d.getFullYear() === +yyyy && d.getMonth() + 1 === +mm && d.getDate() === +dd;
  return valida ? d : null;
}

/**
 * Normaliza o celular do lead para E.164 SEM o sinal de mais (ex.: 5511999999999),
 * que é o formato esperado por links de mensagem e por futuras integrações.
 *
 * O campo chega em DOIS formatos, porque o TriageModal tem duas variantes:
 *   - pt-BR: máscara "(11) 99999-9999". A validação aceita 10 dígitos (fixo com
 *     DDD) ou 11 (celular com DDD), e o campo NÃO comporta código de país — a
 *     máscara descarta qualquer dígito além do 11º. Logo, o 55 é DEDUZIDO.
 *     Não é dado do formulário: é o que a própria validação pressupõe. Um
 *     número estrangeiro digitado na ficha em português sairia errado daqui.
 *   - en: exige começar com "+" e ter de 8 a 15 dígitos, com espaçamento livre.
 *     O código de país JÁ vem incluído, então nada é acrescentado.
 *
 * Fora dessas faixas (inclusive nas fichas importadas da planilha de anamnese,
 * que não passaram pela máscara), devolve null em vez de adivinhar o país.
 *
 * @param {*} celular - lead.celular
 * @param {*} idioma  - lead.idioma ("pt-br" | "en"); ausente é tratado como pt-BR
 * @returns {string|null}
 */
function toPhoneE164(celular, idioma) {
  if (celular === null || celular === undefined) return null;
  const d = String(celular).replace(/\D/g, '');
  if (!d) return null;
  if (idioma === 'en') {
    return d.length >= 8 && d.length <= 15 ? d : null;
  }
  return d.length === 10 || d.length === 11 ? `55${d}` : null;
}

/**
 * Data de nascimento a partir de data_nascimento no formato DD/MM/AAAA
 * (formato do TriageModal). Substitui ageFromDob: o Esquema v3 (seção 5)
 * grava a data de nascimento, não a idade — idade é derivada na leitura,
 * nunca armazenada (princípio P3). Retorna null se ausente, malformada, no
 * futuro, ou implausivelmente antiga (mais de 130 anos) — mesma faixa de
 * sanidade que ageFromDob aplicava sobre o número resultante.
 * @param {string} dob
 * @param {Date} now
 * @returns {Date|null}
 */
function birthDateFromDob(dob, now) {
  const d = parseBrDate(dob);
  if (!d) return null;
  if (d > now) return null;
  const idadeAprox = now.getFullYear() - d.getFullYear();
  return idadeAprox >= 0 && idadeAprox < 130 ? d : null;
}

/**
 * Constrói o documento athletes/{uid} a partir de um lead do M1.
 *
 * @param {object} lead - documento da coleção "leads" (campos em pt-BR:
 *   nome, email, objetivo...). O id do doc deve vir em lead.id.
 * @param {object|null} avaliacao - documento correspondente em "avaliacoes"
 *   (opcional; usado apenas para rastrear o token da avaliação de origem).
 * @param {object} [opts] - { uid, leadId, payment, startDate, phase, genero,
 *   externalLabel, now, test }. `status` não é mais aceito (Adendo 06, DA-01).
 * @returns {object} documento pronto para gravar em athletes/{uid}.
 */
function athleteFromLead(lead, avaliacao, opts = {}) {
  if (!lead || typeof lead !== 'object') {
    throw new Error('athleteFromLead: lead ausente ou inválido.');
  }
  const now = opts.now instanceof Date ? opts.now : new Date();
  // opts.startDate chega como string "DD/MM/AAAA" (mesmo formato que
  // promote-lead.ts já valida com isValidBrDate antes de chamar este
  // contrato); aqui é convertida para Date, o tipo que o Esquema v3 (seção 5)
  // pede. Ausente (o runner de emulação não a informa) cai em `now`.
  let startDate;
  if (opts.startDate) {
    startDate = parseBrDate(opts.startDate);
    if (!startDate) {
      throw new Error('athleteFromLead: startDate inválida — esperado "DD/MM/AAAA".');
    }
  } else {
    startDate = now;
  }

  const peso      = toNum(lead.peso);
  const altura    = toNum(lead.altura);
  const tempoAtiv = toNum(lead.tempo_atividade);
  const freq      = toNum(lead.frequencia_semanal);
  const disp      = toNum(lead.disponibilidade_diaria);

  return {
    // -- Identificação (lista + cabeçalho do drawer) --
    name:   String(lead.nome  || '').trim(),
    email:  String(lead.email || '').trim().toLowerCase(),
    // Guardado NORMALIZADO (só dígitos, com país), não com a máscara do
    // formulário — ao contrário de height/freq/duration, que ficaram como texto
    // de exibição e são a ressalva registrada no topo deste arquivo.
    phone:  toPhoneE164(lead.celular, lead.idioma),
    // Adendo 06, DA-01: o campo status foi removido (era "awaiting_checkin"
    // sempre, sem comportamento algum — a situação de acompanhamento agora é
    // derivada na leitura por @elite90/situacao, a partir de createdAt e do
    // último check-in enviado). O ponto de decisão de negócio que pedia
    // confirmação do Coach saiu junto: o adendo encerrou a questão por outro
    // caminho, removendo o campo em vez de confirmar o vocabulário.
    startDate,                                              // Date (Esquema v3, seção 5)
    // Vocabulário fechado ('masculino'|'feminino'|'outro'), validado por quem
    // chama (promote-lead.ts) — este contrato só grava o que recebe. Existe
    // para casos de uso de IA que ainda serão construídos sobre este campo.
    genero: opts.genero || null,
    // Rótulo visto pelo delegado externo no lugar do nome (Adendo 02, D-14).
    // Sorteado e conferido contra colisão por quem chama; nulo aqui significa
    // que a rotina única de preenchimento ainda não passou por este atleta.
    externalLabel: opts.externalLabel || null,

    // -- Progressão de ciclo --
    // week e day saíram (Esquema v3, seção 5: deriváveis de startDate, como
    // já ocorre com a idade). O painel já os recalculava a cada leitura via
    // normalizarCiclo, descartando o valor gravado sempre que startDate era
    // válido — a redundância era silenciosa, nunca visível na tela.
    phase: opts.phase || 'Bulking',                         // fase inicial do ciclo

    // -- Perfil do Atleta (drawer > Visão Geral) --
    // Tradução pt → en, em tipo nativo (Esquema v3, seção 5). A camada de
    // formatação é da interface (princípio P1) — nenhum destes é mais texto
    // pronto para exibir.
    birthDate:       birthDateFromDob(lead.data_nascimento, now),  // idade é derivada na leitura
    heightCm:        altura !== null ? Math.round(altura * 100) : null,
    trainingYears:   tempoAtiv,                             // renomeação pura de years_active
    weeklyFrequency: freq,                                  // renomeação pura de freq
    dailyMinutes:    disp !== null ? Math.round(disp * 60) : null, // disponibilidade_diaria chega em horas
    goal:            lead.objetivo || null,                 // lead.objetivo -> athlete.goal
    flags:           Array.isArray(lead.score_flags) ? lead.score_flags : [],

    // -- Peso (lista + gráficos) --
    weightInitialKg: peso,
    weightCurrentKg: peso,                                  // no dia 1, inicial == atual

    // -- Estados iniciais das demais abas --
    checkin:        null,                                   // até o Portal (PRT-05/FN-07) gravar o primeiro
    prev:           null,
    avaliacao:      null,                                   // subcoleção evaluations/ ainda ausente
    baselinePhotos: [],
    planStatus:     'none',                                 // nenhum plano publicado ainda

    // -- Ponte com o Pipeline A (rastreabilidade; ainda não lida pelo M2) --
    originLeadId:    opts.leadId || lead.id || null,
    evaluationToken: (avaliacao && avaliacao.token) ? avaliacao.token : null,

    // -- Registro de pagamento --
    // No FN-08 real: { stripeSessionId, valor, metodo, paidAt }.
    payment: opts.payment || { emulated: true, source: 'emulate-fn08' },

    createdAt: now,                                         // Date; era now.toISOString()
    updatedAt: now,                                          // não existia; Esquema v3 seção 5 pede os dois
    _source:   'emulate-fn08',
    _test:     opts.test !== false,                         // default true — facilita purga de testes
  };
}

module.exports = { athleteFromLead, parseBrDate };
