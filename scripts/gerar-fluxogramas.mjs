// ELITE90 PRO · gerar-fluxogramas
// -----------------------------------------------------------------------------
// Emite os dois fluxogramas da delegação de planos, cada um em duas variantes.
//
//   SAÍDA  apps/site/src/components/Fluxogramas.astro   (arquivo COMITADO)
//
//   I  · ciclo de vida do profissional  — acontece uma vez por profissional.
//   II · ciclo de um plano              — acontece muitas vezes, dentro do I.
//
// POR QUE ESTE ARQUIVO EXISTE, EM VEZ DE SVG ESCRITO À MÃO
// A geometria do desenho não é decorativa: coordenada errada produz seta solta,
// linha atravessando polígono e rótulo estourando a caixa — os três defeitos
// aconteceram na versão manual. Aqui a geometria é calculada e VERIFICADA, e o
// script ABORTA em vez de emitir um desenho quebrado. As travas são sete:
//
//   1. todo rótulo cabe na sua caixa (largura medida por caractere e fonte);
//   2. ligação vertical direta tem folga mínima entre bordas;
//   3. nenhuma seta começa fora da borda de um símbolo;
//   4. nenhum segmento degenerado (menos de 12px);
//   5. nenhuma linha cruza o interior de um polígono;
//   6. nenhum símbolo se sobrepõe a outro;
//   7. nenhuma seta corre sobreposta a outra na mesma horizontal ou vertical.
//
// A SAÍDA É COMITADA, e não gerada no build. O desenho não muda por contexto de
// publicação — diferente de filtrar-graficos.mjs, cuja saída é artefato de build
// e está no .gitignore. Aqui o componente é conteúdo: quem alterar o fluxo roda
// este script de novo e comita o resultado, como se faz com a base de domínio.
//
// Uso:
//   node scripts/gerar-fluxogramas.mjs
//   node scripts/gerar-fluxogramas.mjs --conferir   # só verifica, não escreve
// -----------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = resolve(AQUI, '../apps/site/src/components/Fluxogramas.astro');
const SO_CONFERIR = process.argv.includes('--conferir');

const PALETA = { coach: '#27AE60', prof: '#8E6FD8', sis: '#4A90D9', atleta: '#D88C2C' };
const ROTULO = { coach: 'Coach', prof: 'Profissional', sis: 'Sistema', atleta: 'Atleta' };

const PW = 230, PH = 66;      // processo
const DW = 230, DH = 104;     // decisão
const TW = 240, TH = 58;      // terminal
const RC = 17;                // conector
const AV_T = 6.9, AV_S = 6.2; // largura média por caractere: título 16px, subtítulo 11px
const HEAD_Y = 18, HEAD_H = 58;
const FOLGA_MIN = 24;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class Diagrama {
  constructor(id, lanes, { passo = 140, laneW = 290, x0 = 20, topoExtra = 58 } = {}) {
    this.id = id;
    this.lanes = lanes;
    this.LW = laneW;
    this.X0 = x0;
    this.CX = Object.fromEntries(lanes.map((k, i) => [k, x0 + i * laneW + Math.floor(laneW / 2)]));
    this.W = x0 * 2 + laneW * lanes.length;
    this.TOPO = HEAD_Y + HEAD_H + topoExtra;
    this.PASSO = passo;
    this.N = new Map();
    this.C = new Map();
    this.O = [];
  }

  y(n) { return this.TOPO + n * this.PASSO; }

  no(id, lane, yy, tipo, linhas) {
    const larg = tipo === 'dec' ? DW : tipo === 'term' ? TW : PW;
    const util = tipo === 'dec' ? larg * 0.62 : larg - 26;
    if (linhas[0].length * AV_T > util) throw new Error(`título não cabe em ${id}: ${linhas[0]}`);
    if (linhas[1] && linhas[1].length * AV_S > util) throw new Error(`subtítulo não cabe em ${id}: ${linhas[1]}`);
    this.N.set(id, { id, lane, yy, tipo, linhas });
  }

  conector(id, lane, yy, letra, saida) { this.C.set(id, { id, lane, yy, letra, saida }); }

  dim(id) {
    const t = this.N.get(id).tipo;
    return t === 'dec' ? [DW, DH] : t === 'term' ? [TW, TH] : [PW, PH];
  }
  cx(id) { return this.CX[this.N.get(id).lane]; }
  cy(id) { return this.N.get(id).yy; }
  bot(id) { return this.cy(id) + this.dim(id)[1] / 2; }
  top(id) { return this.cy(id) - this.dim(id)[1] / 2; }
  lft(id) { return this.cx(id) - this.dim(id)[0] / 2; }
  rgt(id) { return this.cx(id) + this.dim(id)[0] / 2; }
  ccx(id) { return this.CX[this.C.get(id).lane]; }
  ccy(id) { return this.C.get(id).yy; }
  calha(i) { return i ? this.X0 + i * this.LW - 16 : this.X0 + 16; }

  A(s) { this.O.push(s); }
  seta(d) { this.A(`<path d="${d}" fill="none" stroke="#8A8A82" stroke-width="1.5" marker-end="url(#pt-${this.id})"/>`); }
  rot(x, yy, t, anc = 'middle') { this.A(`<text class="rot" x="${x}" y="${yy}" text-anchor="${anc}">${esc(t)}</text>`); }

  desce(a, b) {
    const folga = this.top(b) - this.bot(a);
    if (folga < FOLGA_MIN) throw new Error(`folga de ${folga}px entre ${a} e ${b}`);
    this.seta(`M ${this.cx(a)} ${this.bot(a)} L ${this.cx(a)} ${this.top(b) - 7}`);
  }

  cotovelo(a, b) {
    const xa = this.cx(a), ya = this.bot(a), yb = this.cy(b);
    const alvo = xa > this.cx(b) ? this.rgt(b) + 7 : this.lft(b) - 7;
    this.seta(`M ${xa} ${ya} L ${xa} ${yb} L ${alvo} ${yb}`);
  }

  // Entra pelo TOPO do destino. Para decisão, é o que mantém as laterais
  // livres para as saídas — sem isto, entrada e saída disputam a mesma aresta
  // e as duas setas se sobrepõem.
  porCima(a, b, recuo = 26) {
    const ymid = this.bot(a) + recuo;
    if (ymid > this.top(b) - 20) throw new Error(`sem folga entre ${a} e ${b}`);
    this.seta(`M ${this.cx(a)} ${this.bot(a)} L ${this.cx(a)} ${ymid} L ${this.cx(b)} ${ymid} L ${this.cx(b)} ${this.top(b) - 7}`);
  }

  paraConector(a, cid) {
    const folga = this.ccy(cid) - RC - this.bot(a);
    if (folga < FOLGA_MIN) throw new Error(`folga de ${folga}px entre ${a} e ${cid}`);
    this.seta(`M ${this.cx(a)} ${this.bot(a)} L ${this.cx(a)} ${this.ccy(cid) - RC - 7}`);
  }

  doConector(cid, b) {
    this.seta(`M ${this.ccx(cid)} ${this.ccy(cid) + RC} L ${this.cx(b)} ${this.top(b) - 7}`);
  }

  render(altura, titulo, descricao) {
    const out = [];
    this.lanes.forEach((k, i) => {
      const lx = this.X0 + i * this.LW, c = PALETA[k];
      out.push(`<rect x="${lx + 4}" y="${HEAD_Y}" width="${this.LW - 8}" height="${HEAD_H}" rx="3" fill="${c}" fill-opacity="0.13" stroke="${c}" stroke-width="1.2"/>`);
      out.push(`<rect x="${lx + 4}" y="${HEAD_Y}" width="5" height="${HEAD_H}" fill="${c}"/>`);
      out.push(`<text class="raia" x="${lx + this.LW / 2}" y="${HEAD_Y + HEAD_H / 2}" fill="${c}">${esc(ROTULO[k].toUpperCase())}</text>`);
      if (i) out.push(`<line x1="${lx}" y1="${HEAD_Y + HEAD_H + 20}" x2="${lx}" y2="${altura - 20}" stroke="rgba(255,255,255,.07)" stroke-width="1" stroke-dasharray="5 8"/>`);
    });
    for (const { id, lane, yy, tipo, linhas } of this.N.values()) {
      const c = PALETA[lane], x = this.CX[lane];
      if (tipo === 'proc') out.push(`<rect x="${x - PW / 2}" y="${yy - PH / 2}" width="${PW}" height="${PH}" rx="3" fill="#1A1A1A" stroke="${c}" stroke-width="1.5"/>`);
      else if (tipo === 'dec') out.push(`<polygon points="${x},${yy - DH / 2} ${x + DW / 2},${yy} ${x},${yy + DH / 2} ${x - DW / 2},${yy}" fill="#1A1A1A" stroke="${c}" stroke-width="1.5"/>`);
      else out.push(`<rect x="${x - TW / 2}" y="${yy - TH / 2}" width="${TW}" height="${TH}" rx="${TH / 2}" fill="${c}" stroke="${c}" stroke-width="1.5"/>`);
      const term = tipo === 'term';
      const ct = term ? '#0D0D0D' : '#FFFFFF', cs = term ? '#0D0D0D' : '#999999';
      if (linhas.length === 1) out.push(`<text class="nt" x="${x}" y="${yy}" fill="${ct}">${esc(linhas[0])}</text>`);
      else {
        out.push(`<text class="nt" x="${x}" y="${yy - 10}" fill="${ct}">${esc(linhas[0])}</text>`);
        out.push(`<text class="ns" x="${x}" y="${yy + 13}" fill="${cs}">${esc(linhas[1])}</text>`);
      }
    }
    for (const { lane, yy, letra, saida } of this.C.values()) {
      const d = saida ? ' stroke-dasharray="4 4"' : '';
      out.push(`<circle cx="${this.CX[lane]}" cy="${yy}" r="${RC}" fill="#0D0D0D" stroke="#A6C300" stroke-width="1.5"${d}/>`);
      out.push(`<text class="conn" x="${this.CX[lane]}" y="${yy}">${letra}</text>`);
    }
    return `<svg class="dg" viewBox="0 0 ${this.W} ${Math.round(altura)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="t-${this.id} d-${this.id}"><title id="t-${this.id}">${esc(titulo)}</title><desc id="d-${this.id}">${esc(descricao)}</desc><defs><marker id="pt-${this.id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#8A8A82" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>${out.concat(this.O).join('')}</svg>`;
  }

  verificar(svg) {
    const formas = [], caixas = [];
    for (const id of this.N.keys()) {
      const [w, h] = this.dim(id);
      const f = [id, this.cx(id) - w / 2, this.cy(id) - h / 2, this.cx(id) + w / 2, this.cy(id) + h / 2];
      formas.push(f);
      caixas.push([id, f[1] + 3, f[2] + 3, f[3] - 3, f[4] - 3]);
    }
    for (const id of this.C.keys()) formas.push([id, this.ccx(id) - RC, this.ccy(id) - RC, this.ccx(id) + RC, this.ccy(id) + RC]);

    const problemas = new Set();
    const segs = [];
    for (const m of svg.matchAll(/<path d="(M [^"]+)" fill="none" stroke="#8A8A82"/g)) {
      const pts = [...m[1].matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])]);
      const [x, yv] = pts[0];
      const ancorada = formas.some(([, a, b, c, e]) =>
        a - 2 <= x && x <= c + 2 && b - 2 <= yv && yv <= e + 2 &&
        (Math.abs(x - a) < 1.5 || Math.abs(x - c) < 1.5 || Math.abs(yv - b) < 1.5 || Math.abs(yv - e) < 1.5));
      if (!ancorada) problemas.add(`início solto em ${pts[0]}`);
      for (let i = 0; i < pts.length - 1; i++) {
        const [p, q] = [pts[i], pts[i + 1]];
        if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) < 12) problemas.add(`segmento curto ${p}->${q}`);
        if (Math.min(p[0], q[0]) < 0 || Math.max(p[0], q[0]) > this.W) problemas.add(`fora da largura ${p}->${q}`);
        for (const [id, bx1, by1, bx2, by2] of caixas) {
          if (p[0] === q[0] && bx1 < p[0] && p[0] < bx2 && Math.min(p[1], q[1]) < by2 && by1 < Math.max(p[1], q[1])) problemas.add(`cruza ${id}`);
          if (p[1] === q[1] && by1 < p[1] && p[1] < by2 && Math.min(p[0], q[0]) < bx2 && bx1 < Math.max(p[0], q[0])) problemas.add(`cruza ${id}`);
        }
        segs.push([p, q]);
      }
    }
    for (let i = 0; i < formas.length; i++) {
      for (let j = i + 1; j < formas.length; j++) {
        const a = formas[i], b = formas[j];
        if (a[1] < b[3] && b[1] < a[3] && a[2] < b[4] && b[2] < a[4]) problemas.add(`sobreposição ${a[0]}/${b[0]}`);
      }
    }
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const [[p1, q1], [p2, q2]] = [segs[i], segs[j]];
        if (p1[0] === q1[0] && p2[0] === q2[0] && Math.abs(p1[0] - p2[0]) < 1.5) {
          const s = Math.min(Math.max(p1[1], q1[1]), Math.max(p2[1], q2[1])) - Math.max(Math.min(p1[1], q1[1]), Math.min(p2[1], q2[1]));
          if (s > 2) problemas.add(`setas sobrepostas na vertical x=${p1[0]}`);
        }
        if (p1[1] === q1[1] && p2[1] === q2[1] && Math.abs(p1[1] - p2[1]) < 1.5) {
          const s = Math.min(Math.max(p1[0], q1[0]), Math.max(p2[0], q2[0])) - Math.max(Math.min(p1[0], q1[0]), Math.min(p2[0], q2[0]));
          if (s > 2) problemas.add(`setas sobrepostas na horizontal y=${p1[1]}`);
        }
      }
    }
    if (problemas.size) throw new Error(`[${this.id}] ${[...problemas].sort().join('; ')}`);
  }
}

// ═══════════════ I · ciclo de vida do profissional ═══════════════
const d1 = new Diagrama('i', ['coach', 'prof', 'sis']);
{
  const y = (n) => d1.y(n);
  d1.no('a1', 'coach', y(0), 'term', ['Início']);
  d1.no('a2', 'coach', y(1), 'proc', ['Cadastrar profissional', 'especialidade e nível de acesso']);
  d1.no('a3', 'coach', y(2), 'proc', ['Conceder acesso']);
  d1.no('a4', 'sis', y(3), 'proc', ['Criar conta e enviar e-mail', 'link de senha e rota da equipe']);
  d1.no('a5', 'prof', y(4), 'proc', ['Definir a senha']);
  d1.no('a6', 'prof', y(5), 'proc', ['Entrar pela rota da equipe']);
  d1.no('a7', 'prof', y(6), 'proc', ['Profissional ativo', 'o ciclo do plano roda aqui']);
  d1.no('a8', 'coach', y(7), 'dec', ['Encerrar o vínculo?']);
  d1.no('a9', 'coach', y(8), 'proc', ['Encerrar cada atribuição', 'uma chamada por vínculo']);
  d1.no('a10', 'coach', y(9), 'proc', ['Revogar o acesso', 'a conta deixa de entrar']);
  d1.no('a11', 'sis', y(10), 'proc', ['Preservar o cadastro', 'a autoria das versões aponta']);
  d1.no('a12', 'sis', y(11), 'term', ['Fim']);
}
const ALT1 = d1.y(11) + TH / 2 + 54;
d1.desce('a1', 'a2'); d1.desce('a2', 'a3');
d1.cotovelo('a3', 'a4'); d1.cotovelo('a4', 'a5'); d1.desce('a5', 'a6');
d1.desce('a6', 'a7');
d1.porCima('a7', 'a8');
d1.desce('a8', 'a9'); d1.rot(d1.cx('a8') + 14, d1.bot('a8') + 22, 'sim', 'start');
d1.desce('a9', 'a10');
d1.cotovelo('a10', 'a11'); d1.desce('a11', 'a12');
{
  const g = d1.calha(3);
  d1.seta(`M ${d1.rgt('a8')} ${d1.cy('a8')} L ${g} ${d1.cy('a8')} L ${g} ${d1.cy('a7')} L ${d1.rgt('a7') + 7} ${d1.cy('a7')}`);
  d1.rot(d1.rgt('a8') + 22, d1.cy('a8') - 14, 'não', 'start');
}
const SVG1 = d1.render(ALT1, 'Fluxograma I — ciclo de vida do profissional no programa',
  'Da entrada do profissional, cadastrada e liberada pelo Coach, ao encerramento do vínculo, com o cadastro preservado ao final.');
d1.verificar(SVG1);

// ═══════════════ II · ciclo de um plano ═══════════════
const d2 = new Diagrama('ii', ['coach', 'prof', 'sis', 'atleta']);
{
  const y = (n) => d2.y(n);
  d2.no('b1', 'coach', y(0), 'term', ['Início do ciclo']);
  d2.no('b2', 'coach', y(1), 'proc', ['Atribuir atleta', 'uma atribuição por especialidade']);
  d2.no('b3', 'sis', y(2), 'proc', ['Montar a carteira', 'só os campos do nível de acesso']);
  d2.no('b4', 'prof', y(3), 'proc', ['Montar o plano', 'rascunho salvo enquanto digita']);
  d2.no('b5', 'prof', y(4), 'dec', ['Falta item', 'no acervo?']);
  d2.no('b6', 'prof', y(5), 'proc', ['Propor o item completo']);
  d2.no('b7', 'coach', y(5), 'proc', ['Aprovar ou recusar o item']);
  d2.no('b8', 'prof', y(7), 'proc', ['Enviar ao Coach']);
  d2.no('b9', 'sis', y(8), 'proc', ['Congelar a sugestão', 'a tela dele vira leitura']);
  d2.no('b10', 'coach', y(9), 'proc', ['Revisar a sugestão']);
  d2.no('b11', 'coach', y(10), 'dec', ['Aprovar?']);
  d2.no('b12', 'coach', y(11), 'dec', ['Cabe ajuste?']);
  d2.no('b13', 'coach', y(12), 'proc', ['Devolver com observação', 'o texto é obrigatório']);
  d2.no('b14', 'prof', y(12), 'term', ['Fim — sugestão recusada']);
  d2.no('b15', 'sis', y(13), 'proc', ['Gravar versão numerada', 'autoria copiada no instante']);
  d2.no('b16', 'coach', y(14), 'proc', ['Entregar ao atleta', 'pelo canal que ele escolher']);
  d2.no('b17', 'atleta', y(15), 'term', ['Fim — plano entregue']);
  d2.conector('A_o1', 'coach', y(6), 'A', 1);
  d2.conector('A_i', 'prof', y(3) - 78, 'A', 0);
  d2.conector('A_o2', 'coach', y(12) + 78, 'A', 1);
}
const ALT2 = d2.y(15) + TH / 2 + 54;
d2.desce('b1', 'b2'); d2.cotovelo('b2', 'b3'); d2.cotovelo('b3', 'b4');
d2.desce('b4', 'b5');
d2.desce('b5', 'b6'); d2.rot(d2.cx('b5') + 14, d2.bot('b5') + 22, 'sim', 'start');
{
  const g = d2.calha(1), ymid = d2.top('b8') - 46;
  d2.seta(`M ${d2.lft('b5')} ${d2.cy('b5')} L ${g} ${d2.cy('b5')} L ${g} ${ymid} L ${d2.cx('b8')} ${ymid} L ${d2.cx('b8')} ${d2.top('b8') - 7}`);
  d2.rot((d2.lft('b5') + g) / 2, d2.cy('b5') - 14, 'não');
}
d2.seta(`M ${d2.lft('b6')} ${d2.cy('b6')} L ${d2.rgt('b7') + 7} ${d2.cy('b7')}`);
d2.paraConector('b7', 'A_o1');
d2.doConector('A_i', 'b4');
d2.cotovelo('b8', 'b9'); d2.cotovelo('b9', 'b10'); d2.desce('b10', 'b11');
d2.desce('b11', 'b12'); d2.rot(d2.cx('b11') + 14, d2.bot('b11') + 22, 'não', 'start');
d2.seta(`M ${d2.rgt('b11')} ${d2.cy('b11')} L ${d2.cx('b15')} ${d2.cy('b11')} L ${d2.cx('b15')} ${d2.top('b15') - 7}`);
d2.rot(d2.rgt('b11') + 22, d2.cy('b11') - 14, 'sim', 'start');
d2.desce('b12', 'b13'); d2.rot(d2.cx('b12') + 14, d2.bot('b12') + 22, 'sim', 'start');
d2.seta(`M ${d2.rgt('b12')} ${d2.cy('b12')} L ${d2.cx('b14')} ${d2.cy('b12')} L ${d2.cx('b14')} ${d2.top('b14') - 7}`);
d2.rot(d2.rgt('b12') + 22, d2.cy('b12') - 14, 'não', 'start');
d2.paraConector('b13', 'A_o2');
d2.cotovelo('b15', 'b16'); d2.cotovelo('b16', 'b17');
const SVG2 = d2.render(ALT2, 'Fluxograma II — ciclo de um plano',
  'Da atribuição do atleta à entrega do plano publicado, com o desvio da proposta de item de acervo e os três desfechos da revisão do Coach.');
d2.verificar(SVG2);

// ═══════════════ variantes em coluna ═══════════════
const NW = 430, NX = 200, NPW = 310, NDW = 262, NTW = 290;

function coluna(id, seq, fonte, ramos, letras) {
  const Y = new Map();
  let cur = 74;
  for (const [nid, t] of seq) {
    const h = t === 'dec' ? 104 : t === 'term' ? 58 : t === 'conn' ? 34 : 70;
    Y.set(nid, cur + h / 2);
    cur += h + (t === 'conn' ? 46 : 54);
  }
  const alt = cur + 20;
  const tipoDe = Object.fromEntries(seq);
  const meia = (nid) => (tipoDe[nid] === 'dec' ? 52 : tipoDe[nid] === 'term' ? 29 : tipoDe[nid] === 'conn' ? 17 : 35);
  const P = [];
  for (const [nid, t] of seq) {
    const yy = Y.get(nid);
    if (t === 'conn') {
      const d = nid.includes('_o') ? ' stroke-dasharray="4 4"' : '';
      P.push(`<circle cx="${NX}" cy="${yy}" r="17" fill="#0D0D0D" stroke="#A6C300" stroke-width="1.5"${d}/>`);
      P.push(`<text class="conn" x="${NX}" y="${yy}">${letras[nid]}</text>`);
      continue;
    }
    const { lane, linhas } = fonte.get(nid);
    const c = PALETA[lane], term = t === 'term';
    if (t === 'proc') P.push(`<rect x="${NX - NPW / 2}" y="${yy - 35}" width="${NPW}" height="70" rx="3" fill="#1A1A1A" stroke="${c}" stroke-width="1.5"/>`);
    else if (t === 'dec') P.push(`<polygon points="${NX},${yy - 52} ${NX + NDW / 2},${yy} ${NX},${yy + 52} ${NX - NDW / 2},${yy}" fill="#1A1A1A" stroke="${c}" stroke-width="1.5"/>`);
    else P.push(`<rect x="${NX - NTW / 2}" y="${yy - 29}" width="${NTW}" height="58" rx="29" fill="${c}" stroke="${c}" stroke-width="1.5"/>`);
    const ca = term ? '#0D0D0D' : c, ct = term ? '#0D0D0D' : '#FFFFFF', cs = term ? '#0D0D0D' : '#999999';
    P.push(`<text class="ator" x="${NX}" y="${yy - 22}" fill="${ca}">${esc(ROTULO[lane].toUpperCase())}</text>`);
    if (linhas.length === 1) P.push(`<text class="nt" x="${NX}" y="${yy + 6}" fill="${ct}">${esc(linhas[0])}</text>`);
    else {
      P.push(`<text class="nt" x="${NX}" y="${yy + 1}" fill="${ct}">${esc(linhas[0])}</text>`);
      P.push(`<text class="ns" x="${NX}" y="${yy + 22}" fill="${cs}">${esc(linhas[1])}</text>`);
    }
  }
  const ids = seq.map((s) => s[0]);
  const corta = new Set((ramos.corta || []).map((p) => p.join('>')));
  for (let i = 0; i < ids.length - 1; i++) {
    const [a, b] = [ids[i], ids[i + 1]];
    if (corta.has(`${a}>${b}`)) continue;
    P.push(`<path d="M ${NX} ${Y.get(a) + meia(a)} L ${NX} ${Y.get(b) - meia(b) - 7}" fill="none" stroke="#8A8A82" stroke-width="1.5" marker-end="url(#ptn-${id})"/>`);
  }
  for (const [nid, letra, texto] of (ramos.lado || [])) {
    const yy = Y.get(nid), xx = NX + NDW / 2 + 52;
    P.push(`<circle cx="${xx}" cy="${yy}" r="17" fill="#0D0D0D" stroke="#A6C300" stroke-width="1.5" stroke-dasharray="4 4"/>`);
    P.push(`<text class="conn" x="${xx}" y="${yy}">${letra}</text>`);
    P.push(`<path d="M ${NX + NDW / 2} ${yy} L ${xx - 24} ${yy}" fill="none" stroke="#8A8A82" stroke-width="1.5" marker-end="url(#ptn-${id})"/>`);
    P.push(`<text class="rot" x="${NX + NDW / 2 + 4}" y="${yy - 14}" text-anchor="start">${esc(texto)}</text>`);
  }
  for (const [nid, texto] of (ramos.abaixo || [])) {
    P.push(`<text class="rot" x="${NX + 12}" y="${Y.get(nid) + 52 + 22}" text-anchor="start">${esc(texto)}</text>`);
  }
  return `<svg class="dg" viewBox="0 0 ${NW} ${Math.round(alt)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Mesmo fluxo em coluna única; o ator aparece dentro de cada símbolo."><defs><marker id="ptn-${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="#8A8A82" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>${P.join('')}</svg>`;
}

const COL1 = coluna('i',
  [['a1', 'term'], ['a2', 'proc'], ['a3', 'proc'], ['a4', 'proc'], ['a5', 'proc'], ['a6', 'proc'],
   ['L_i', 'conn'], ['a7', 'proc'], ['a8', 'dec'], ['a9', 'proc'], ['a10', 'proc'], ['a11', 'proc'], ['a12', 'term']],
  d1.N, { lado: [['a8', 'L', 'não']], abaixo: [['a8', 'sim']] }, { L_i: 'L' });

const COL2 = coluna('ii',
  [['b1', 'term'], ['b2', 'proc'], ['b3', 'proc'], ['A_i', 'conn'], ['b4', 'proc'], ['b5', 'dec'],
   ['b6', 'proc'], ['b7', 'proc'], ['A_o1', 'conn'], ['1_i', 'conn'], ['b8', 'proc'], ['b9', 'proc'],
   ['b10', 'proc'], ['b11', 'dec'], ['b12', 'dec'], ['b13', 'proc'], ['A_o2', 'conn'],
   ['3_i', 'conn'], ['b14', 'term'], ['2_i', 'conn'], ['b15', 'proc'], ['b16', 'proc'], ['b17', 'term']],
  d2.N,
  { lado: [['b5', '1', 'não'], ['b11', '2', 'sim'], ['b12', '3', 'não']],
    abaixo: [['b5', 'sim'], ['b11', 'não'], ['b12', 'sim']],
    corta: [['A_o1', '1_i'], ['A_o2', '3_i'], ['b14', '2_i']] },
  { A_i: 'A', A_o1: 'A', A_o2: 'A', '1_i': '1', '2_i': '2', '3_i': '3' });

const COMPONENTE = `---
// GERADO POR scripts/gerar-fluxogramas.mjs — NÃO EDITAR À MÃO.
// Alterou o fluxo? Altere o script e rode-o de novo. A geometria e as sete
// verificações vivem lá; editar este arquivo desfaz as duas coisas em silêncio.
//
// \`qual\` escolhe o fluxo: 'i' (ciclo de vida do profissional) ou 'ii' (ciclo de
// um plano). Cada um traz as duas variantes; a troca é por CSS, na mesma regra
// de largura usada pelo índice dos guias — ver o comentário do @media abaixo.
interface Props { qual: 'i' | 'ii'; }
const { qual } = Astro.props;
---
<div class="flx">
  {qual === 'i' && <div class="flx-raias" set:html={${JSON.stringify(SVG1)}} />}
  {qual === 'i' && <div class="flx-col" set:html={${JSON.stringify(COL1)}} />}
  {qual === 'ii' && <div class="flx-raias" set:html={${JSON.stringify(SVG2)}} />}
  {qual === 'ii' && <div class="flx-col" set:html={${JSON.stringify(COL2)}} />}
</div>

<style is:global>
  .flx .dg{display:block;width:100%;height:auto;margin:0 auto}
  .flx-col{display:none}
  .flx text.raia{font-family:var(--font-display);font-size:21px;letter-spacing:.12em;text-anchor:middle;dominant-baseline:central}
  .flx text.nt{font-family:var(--font-display);font-size:16px;letter-spacing:.04em;text-anchor:middle;dominant-baseline:central}
  .flx text.ns{font-family:var(--font-body);font-size:11px;text-anchor:middle;dominant-baseline:central}
  .flx text.ator{font-family:var(--font-label);font-size:9.5px;font-weight:700;letter-spacing:.16em;text-anchor:middle;dominant-baseline:central}
  .flx text.rot{font-family:var(--font-label);font-size:11px;font-weight:700;letter-spacing:.12em;fill:var(--c-lime);dominant-baseline:central}
  .flx text.conn{font-family:var(--font-display);font-size:18px;fill:var(--c-lime);text-anchor:middle;dominant-baseline:central}

  /* MESMA CONDIÇÃO DO ÍNDICE DOS GUIAS, de propósito (AdminHeader.astro e
     guia.astro). Duas regras diferentes na mesma página produziriam uma faixa
     de largura em que o guia ainda está largo e o desenho já está estreito. */
  @media (max-width:760px) and (orientation:portrait){
    .flx-raias{display:none}
    .flx-col{display:block;max-width:440px;margin:0 auto}
  }
  @media print{.flx-raias{display:block}.flx-col{display:none}}
</style>
`;

if (SO_CONFERIR) {
  console.log('[gerar-fluxogramas] verificações passaram; nada escrito (--conferir)');
} else {
  writeFileSync(SAIDA, COMPONENTE, 'utf8');
  console.log(`[gerar-fluxogramas] I ${d1.W}x${Math.round(ALT1)} · II ${d2.W}x${Math.round(ALT2)} → ${SAIDA}`);
}
