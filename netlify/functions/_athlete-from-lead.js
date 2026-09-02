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
//   - name, email, status ("active"|"checkin_sent"|"awaiting_checkin")
//   - phone -> NÃO lido pelo M2 hoje; existe para o compartilhamento de plano
//             por mensagem. Normalizado em E.164 sem "+" (ver toPhoneE164).
//   - startDate  (DD/MM/YYYY -- parseDate faz str.split("/"))
//   - week, day, phase ("Bulking"|"Cutting"|"Diet Break")
//   - weight_init, weight_now, weight_change
//
//   DRAWER > VISÃO GERAL > "Perfil do Atleta"  (openAthleteDrawer, ~l.2285)
//   - age           -> renderizado como `${age} anos`      => NÚMERO
//   - height        -> renderizado cru                     => STRING ("1,75 m")
//   - years_active  -> renderizado como `${years_active} anos` => NÚMERO
//   - freq          -> renderizado cru                     => STRING ("4x / semana")
//   - duration      -> renderizado cru                     => STRING ("1,5 h/dia")
//   - goal          -> renderizado cru                     => STRING (o objetivo)
//   - flags         -> array de códigos; o M2 filtra por FLAG_META
//                      (CARDIO | SAUDE | LESAO | TRT_SEM_MEDICO)
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
 * Formata uma data como DD/MM/YYYY — formato que atletas.astro espera em
 * startDate (parseDate: const [d, m, y] = str.split("/")).
 * @param {Date} date
 * @returns {string}
 */
function toBrDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

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
 * Formata número em pt-BR (separador decimal vírgula), sem casas desnecessárias.
 * @param {number|null} n
 * @returns {string|null}
 */
function fmtNum(n) {
  if (n === null) return null;
  return String(n).replace('.', ',');
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
 * Idade a partir de data_nascimento no formato DD/MM/AAAA (formato do
 * TriageModal). Retorna null se ausente ou inválida.
 * @param {string} dob
 * @param {Date} now
 * @returns {number|null}
 */
function ageFromDob(dob, now) {
  if (!dob || typeof dob !== 'string') return null;
  const parts = dob.split('/');
  if (parts.length !== 3) return null;
  const d = Number(parts[0]), m = Number(parts[1]), y = Number(parts[2]);
  if (!d || !m || !y) return null;
  let age = now.getFullYear() - y;
  const antes = now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d);
  if (antes) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * Constrói o documento athletes/{uid} a partir de um lead do M1.
 *
 * @param {object} lead - documento da coleção "leads" (campos em pt-BR:
 *   nome, email, objetivo...). O id do doc deve vir em lead.id.
 * @param {object|null} avaliacao - documento correspondente em "avaliacoes"
 *   (opcional; usado apenas para rastrear o token da avaliação de origem).
 * @param {object} [opts] - { uid, leadId, payment, startDate, phase, genero,
 *   externalLabel, status, now, test }.
 * @returns {object} documento pronto para gravar em athletes/{uid}.
 */
function athleteFromLead(lead, avaliacao, opts = {}) {
  if (!lead || typeof lead !== 'object') {
    throw new Error('athleteFromLead: lead ausente ou inválido.');
  }
  const now = opts.now instanceof Date ? opts.now : new Date();
  const startDate = opts.startDate || toBrDate(now);

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
    // PONTO DE DECISÃO DE NEGÓCIO: "awaiting_checkin" é o estado inicial
    // recomendado (conta criada, nenhum check-in ainda). Confirmar com o
    // Coach Fernando se esta semântica é a adequada antes de usar em produção.
    status: opts.status || 'awaiting_checkin',
    startDate,                                              // DD/MM/YYYY
    // Vocabulário fechado ('masculino'|'feminino'|'outro'), validado por quem
    // chama (promote-lead.ts) — este contrato só grava o que recebe. Existe
    // para casos de uso de IA que ainda serão construídos sobre este campo.
    genero: opts.genero || null,
    // Rótulo visto pelo delegado externo no lugar do nome (Adendo 02, D-14).
    // Sorteado e conferido contra colisão por quem chama; nulo aqui significa
    // que a rotina única de preenchimento ainda não passou por este atleta.
    externalLabel: opts.externalLabel || null,

    // -- Progressão de ciclo (lista + Visão Geral) --
    week:  1,                                               // semana 1 de 13
    day:   1,                                               // dia 1 de 90
    phase: opts.phase || 'Bulking',                         // fase inicial do ciclo

    // -- Perfil do Atleta (drawer > Visão Geral) --
    // Tradução pt → en; os campos renderizados "crus" já saem formatados.
    age:          ageFromDob(lead.data_nascimento, now),    // número (M2 concatena " anos")
    height:       altura !== null ? `${fmtNum(altura)} m` : null,
    years_active: tempoAtiv,                                // número (M2 concatena " anos")
    freq:         freq !== null ? `${fmtNum(freq)}x / semana` : null,
    duration:     disp !== null ? `${fmtNum(disp)} h/dia`  : null,
    goal:         lead.objetivo || null,                    // lead.objetivo -> athlete.goal
    flags:        Array.isArray(lead.score_flags) ? lead.score_flags : [],

    // -- Peso (lista + gráficos) --
    weight_init:   peso,
    weight_now:    peso,                                    // no dia 1, inicial == atual
    weight_change: 0,

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

    createdAt: now.toISOString(),
    _source:   'emulate-fn08',
    _test:     opts.test !== false,                         // default true — facilita purga de testes
  };
}

module.exports = { athleteFromLead, toBrDate };
