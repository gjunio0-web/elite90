import { classificar, documentoDe, snapshotDe, igual, normalizarBusca, CAMPOS_ATUALIZAVEIS } from './carregar-alimentos.mjs';
let ok = 0, falhas = [];
const t = (nome, cond) => { if (cond) ok++; else falhas.push(nome); };

const item = { numeroAlimento: 1, linha: 5, nome: 'Arroz, integral, cozido', nomeBusca: 'arroz integral cozido',
  categoria: 'Cereais e derivados', base: 'por100g',
  nutrientes: { proteinaG: { v: 2.58825, st: 'ok' }, colesterolMg: { v: null, st: 'nao_aplicavel' } },
  macros: { kcal: 124, proteinaG: 2.6, carboidratoG: 25.8, lipideosG: 1 }, macrosTemTraco: false, publicado: true };
const meta = { sha256: 'abc', aba: 'CMVCol taco3' };
const novo = documentoDe(item, meta, 'AGORA');

// 1 · nada mudou
let banco = { ...novo, origem: { ...novo.origem, snapshotCarga: snapshotDe(item) } };
let r = classificar(banco, novo);
t('inalterado não gera atualização', r.atualizar.length === 0 && r.conflitos.length === 0 && r.preservados.length === 0);

// 2 · só a planilha mudou → atualiza
const item2 = { ...item, nutrientes: { ...item.nutrientes, proteinaG: { v: 2.7, st: 'ok' } } };
const novo2 = documentoDe(item2, meta, 'AGORA');
r = classificar(banco, novo2);
t('planilha mudou → atualiza nutrientes', r.atualizar.includes('nutrientes') && !r.conflitos.length);

// 3 · só o Coach editou → preserva
let bancoEditado = { ...banco, nomeExibicao: 'Arroz integral (cozido)' };
r = classificar(bancoEditado, novo);
t('Coach editou → preserva nomeExibicao', r.preservados.includes('nomeExibicao') && !r.atualizar.length);

// 4 · os dois mudaram → conflito
r = classificar(bancoEditado, { ...novo, nomeExibicao: 'Arroz integral cozido TACO' });
t('ambos mudaram → conflito', r.conflitos.includes('nomeExibicao') && !r.atualizar.includes('nomeExibicao'));

// 5 · sem snapshot → conservador
r = classificar({ ...novo, nomeExibicao: 'outro', origem: {} }, novo);
t('sem snapshot → preserva, não sobrescreve', r.preservados.includes('nomeExibicao') && !r.atualizar.length);

// 6 · campos protegidos fora da lista
t('medidaCaseira não é atualizável', !CAMPOS_ATUALIZAVEIS.includes('medidaCaseira'));
t('publicado não é atualizável', !CAMPOS_ATUALIZAVEIS.includes('publicado'));
t('revisadoPor não é atualizável', !CAMPOS_ATUALIZAVEIS.includes('revisadoPor'));
t('ativo não é atualizável', !CAMPOS_ATUALIZAVEIS.includes('ativo'));

// 7 · comparação profunda de nutrientes
t('igual() distingue estado de ausência', !igual({ v: null, st: 'traco' }, { v: null, st: 'nao_solicitada' }));
t('igual() reconhece objetos idênticos', igual({ v: 1, st: 'ok' }, { v: 1, st: 'ok' }));
t('igual() não confunde nulo com zero', !igual({ v: null, st: 'traco' }, { v: 0, st: 'ok' }));

// 8 · documento novo nasce como a especificação manda
t('medidaCaseira nasce nula', novo.medidaCaseira === null);
t('ativo nasce verdadeiro', novo.ativo === true);
t('revisadoPor nasce nulo', novo.revisadoPor === null);
t('snapshot acompanha o documento', igual(novo.origem.snapshotCarga, snapshotDe(item)));

// 9 · normalização
t('normalizarBusca remove acento e vírgula', normalizarBusca('Açúcar, mascavo') === 'acucar mascavo');

console.log(`\n${ok} verificações passaram, ${falhas.length} falharam`);
if (falhas.length) { falhas.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
