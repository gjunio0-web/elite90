// ELITE90 PRO · graficos/com-dados.js
// -----------------------------------------------------------------------------
// Módulo de "Progressão Física" — versão COM CURVAS, publicada SOMENTE FORA DE
// PRODUÇÃO (Adendo 07, AC-33 · v1.27; filtro em scripts/filtrar-graficos.mjs).
//
// OS DADOS AQUI SÃO INVENTADOS. `generateMockWeightData`,
// `generateMockVTaperData` e `generateMockSymmetryData` sintetizam curvas dia a
// dia com `seededRand`, ancoradas em dois ou três valores reais do atleta. Nada
// disso aconteceu: as subcoleções que trariam histórico de verdade —
// weights/checkins/evaluations — estão declaradas e deliberadamente não lidas
// nesta fase (ver SUBCOLECOES_NIVEL_1 em _projecao-atleta.ts).
//
// MESMA REGRA DO PLANO-BASE DE DEMONSTRAÇÃO, e pelo mesmo motivo: enquanto não
// há dado real, homologação mostra a maquete e produção não mostra número
// nenhum. Ver o cabeçalho de scripts/filtrar-demo.mjs, que decidiu isto
// primeiro — este arquivo apenas estende a decisão ao que tinha escapado dela.
//
// O CONTÊINER VEM DA PÁGINA, não é fixo: /admin/atletas usa
// `elite-m2-charts`, /profissional usa `prof-charts`. Cada uma declara o seu em
// `window.E90_CHARTS_CONTAINER` antes de carregar este arquivo — foi o que
// permitiu as duas telas compartilharem um módulo só, em vez da cópia que
// existia antes.
//
// ARTEFATO DURÁVEL enquanto a maquete existir. Some junto com ela, no dia em
// que a Progressão Física passar a ler dado real.
// -----------------------------------------------------------------------------

// ── SEEDED PSEUDO-RANDOM (determinístico por atleta) ──
// athlete.id é o doc-id do Firestore (string) — hash simples para virar
// um seed numérico estável, já que a geração abaixo é aritmética.
function idSeed(id) {
  if (typeof id === 'number') return id;
  var s = String(id), h = 0;
  for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return Math.abs(h) || 1;
}
function seededRand(seed, i) {
  var x = Math.sin(seed * 9301 + i * 49297 + 233) * 44208.63;
  return x - Math.floor(x);
}

// ── GERADOR PESO — usa dados reais do atleta ──
function generateMockWeightData(days, athlete) {
  var data = [];
  var today = new Date();
  var seed = athlete ? idSeed(athlete.id) : 1;
  var pesoBase = athlete ? (athlete.weightInitialKg || 82) : 82;
  var pesoFinal = athlete ? (athlete.weightCurrentKg || pesoBase) : pesoBase;
  var totalDays = athlete ? (athlete.day || days) : days;
  var dailyTrend = (pesoFinal - pesoBase) / Math.max(totalDays, 1);
  for (var i = days - 1; i >= 0; i--) {
    var date = new Date(today);
    date.setDate(date.getDate() - i);
    var dayOffset = Math.max(0, totalDays - i);
    var trendW = pesoBase + dailyTrend * dayOffset;
    var noise = (seededRand(seed, i) - 0.5) * 1.0 + Math.sin(i / 7) * 0.3;
    data.push({ date: date.toLocaleDateString('pt-BR').substring(0, 5), peso_bruto: parseFloat((trendW + noise).toFixed(2)), mma7: 0 });
  }
  for (var j = 0; j < data.length; j++) {
    if (j < 6) { data[j].mma7 = data[j].peso_bruto; }
    else {
      var sl7 = data.slice(j - 6, j + 1).map(function(d){ return d.peso_bruto; });
      data[j].mma7 = parseFloat((sl7.reduce(function(a,b){ return a+b; }) / 7).toFixed(2));
    }
  }
  return data;
}

// ── GERADOR V-TAPER — usa dados reais do atleta ──
function generateMockVTaperData(days, athlete) {
  var semanas = Math.ceil(days / 7);
  var data = [];
  var seed = athlete ? idSeed(athlete.id) : 1;
  var ombrosNow = (athlete && athlete.checkin && athlete.checkin.chest) ? (athlete.checkin.chest + 17) : 116;
  var cinturaNow = (athlete && athlete.checkin) ? athlete.checkin.waist : 88;
  var phase = athlete ? (athlete.phase || 'Bulking') : 'Bulking';
  var og = phase === 'Bulking' ? 0.12 : (phase === 'Cutting' ? -0.06 : 0.02);
  var cg = phase === 'Cutting' ? -0.20 : (phase === 'Bulking' ? 0.09 : -0.02);
  for (var s = 1; s <= semanas; s++) {
    var wo = s - semanas;
    var noise = (seededRand(seed, s) - 0.5) * 0.4;
    data.push({
      semana: s,
      perimetro_ombros: parseFloat(Math.max(90, ombrosNow + og * wo + noise).toFixed(1)),
      perimetro_cintura: parseFloat(Math.max(60, cinturaNow + cg * wo + noise * 0.5).toFixed(1))
    });
  }
  return data;
}

// ── GERADOR SIMETRIA — usa dados reais do atleta ──
function generateMockSymmetryData(days, athlete) {
  var quinzenas = Math.max(2, Math.ceil(days / 15));
  var data = [];
  var seed = athlete ? idSeed(athlete.id) : 1;
  var bracoNow = (athlete && athlete.checkin && athlete.checkin.arm) ? athlete.checkin.arm : 41;
  var coxaNow  = (athlete && athlete.checkin && athlete.checkin.hip) ? (athlete.checkin.hip * 0.65) : 62;
  for (var q = 1; q <= quinzenas; q++) {
    var qo = q - quinzenas;
    data.push({
      quinzena: q,
      braco_esq: parseFloat((bracoNow      + qo*0.12 + seededRand(seed, q*4)   * 0.6).toFixed(1)),
      braco_dir: parseFloat((bracoNow+0.2  + qo*0.12 + seededRand(seed, q*4+1) * 0.6).toFixed(1)),
      coxa_esq:  parseFloat((coxaNow       + qo*0.18 + seededRand(seed, q*4+2) * 1.0).toFixed(1)),
      coxa_dir:  parseFloat((coxaNow-0.15  + qo*0.18 + seededRand(seed, q*4+3) * 1.0).toFixed(1))
    });
  }
  return data;
}

// ── GLOBAIS ──
var chart1, chart2, chart3;
var currentPeriod = 30;
var currentAthlete = null;

function initCharts(athlete) {
  var container = document.getElementById(window.E90_CHARTS_CONTAINER || 'elite-m2-charts');
  if (!container) return;
  currentAthlete = athlete || null;
  if (chart1) { try { chart1.destroy(); } catch(e){} chart1 = null; }
  if (chart2) { try { chart2.destroy(); } catch(e){} chart2 = null; }
  if (chart3) { try { chart3.destroy(); } catch(e){} chart3 = null; }
  container.innerHTML = '';

  var periodRow =
    '<div style="display:flex;gap:8px;margin-bottom:24px;">' +
    '<button onclick="updateCharts(30)" id="btn-30" style="padding:6px 12px;background:#A6C300;color:#0d0d0d;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-size:12px;">30d</button>' +
    '<button onclick="updateCharts(60)" id="btn-60" style="padding:6px 12px;background:#1a1a1a;color:#999;border:1px solid #333;border-radius:4px;cursor:pointer;font-weight:600;font-size:12px;">60d</button>' +
    '<button onclick="updateCharts(90)" id="btn-90" style="padding:6px 12px;background:#1a1a1a;color:#999;border:1px solid #333;border-radius:4px;cursor:pointer;font-weight:600;font-size:12px;">90d</button>' +
    '</div>';

  var wHtml =
    '<div style="margin-bottom:32px;min-width:0;">' +
    '<h3 style="font-family:Bebas Neue;color:#A6C300;text-transform:uppercase;margin:0 0 4px 0;font-size:16px;letter-spacing:0.05em;">Evolução do Peso</h3>' +
    '<p style="color:#999;font-size:11px;margin:0 0 16px 0;">Tendência de 7 dias (MMA7)</p>' +
    '<canvas id="chart-weight" height="140" style="width:100% !important;max-width:100%;"></canvas>' +
    '<div style="display:flex;column-gap:24px;row-gap:4px;margin-top:8px;flex-wrap:wrap;">' +
    '<div><div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Peso Inicial</div><div id="metric-peso-inicial" style="font-size:15px;font-weight:600;color:#EDEDE0;">—</div></div>' +
    '<div><div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Peso Atual</div><div id="metric-peso-atual" style="font-size:15px;font-weight:600;color:#EDEDE0;">—</div></div>' +
    '<div><div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Variação</div><div id="metric-variacao" style="font-size:15px;font-weight:600;color:#EDEDE0;">—</div></div>' +
    '<div><div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Menor</div><div id="metric-menor" style="font-size:15px;font-weight:600;color:#EDEDE0;">—</div></div>' +
    '<div><div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Maior</div><div id="metric-maior" style="font-size:15px;font-weight:600;color:#EDEDE0;">—</div></div>' +
    '</div></div>';

  var vtHtml =
    '<div style="min-width:0;">' +
    '<h3 style="font-family:Bebas Neue;color:#A6C300;text-transform:uppercase;margin:0 0 4px 0;font-size:16px;letter-spacing:0.05em;">V-Taper Profile</h3>' +
    '<p style="color:#999;font-size:11px;margin:0 0 16px 0;">Ombros vs Cintura</p>' +
    '<canvas id="chart-vtaper" height="280" style="width:100% !important;max-width:100%;"></canvas>' +
    '<div style="display:flex;column-gap:24px;row-gap:4px;margin-top:8px;flex-wrap:wrap;">' +
    '<div><div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Ombros</div><div id="metric-ombros" style="font-size:15px;font-weight:600;color:#EDEDE0;">—</div></div>' +
    '<div><div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Cintura</div><div id="metric-cintura" style="font-size:15px;font-weight:600;color:#EDEDE0;">—</div></div>' +
    '<div><div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Relação V-Taper</div><div id="metric-vtaper" style="font-size:15px;font-weight:600;color:#A6C300;">—</div></div>' +
    '</div></div>';

  var symHtml =
    '<div style="min-width:0;">' +
    '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">' +
    '<h3 style="font-family:Bebas Neue;color:#A6C300;text-transform:uppercase;margin:0;font-size:16px;letter-spacing:0.05em;">Simetria e Densidade</h3>' +
    '<span id="badge-simetria" style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:3px 8px;border-radius:3px;background:rgba(166,195,0,0.12);color:#A6C300;border:1px solid rgba(166,195,0,0.3);">— VERIFICANDO</span>' +
    '</div>' +
    '<p style="color:#999;font-size:11px;margin:0 0 16px 0;">Braços e Coxas (esq/dir)</p>' +
    '<canvas id="chart-symmetry" height="280" style="width:100% !important;max-width:100%;"></canvas>' +
    '<div style="display:flex;column-gap:16px;row-gap:4px;margin-top:8px;flex-wrap:wrap;">' +
    '<div><div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Simetria Braço</div><div id="metric-sim-braco" style="font-size:15px;font-weight:600;color:#EDEDE0;">—</div></div>' +
    '<div><div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Simetria Coxa</div><div id="metric-sim-coxa" style="font-size:15px;font-weight:600;color:#EDEDE0;">—</div></div>' +
    '<div><div style="font-size:10px;color:#666;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Evolução Média</div><div id="metric-evolucao" style="font-size:15px;font-weight:600;color:#EDEDE0;">—</div></div>' +
    '</div></div>';

  container.innerHTML =
    '<div style="margin-bottom:24px;">' + periodRow + wHtml +
    '<div class="charts-grid" style="display:grid;gap:32px;">' + vtHtml + symHtml + '</div>' +
    '</div>';

  updateCharts(30);
}

function updateCharts(days) {
  currentPeriod = days;
  var athlete = currentAthlete;

  ['30','60','90'].forEach(function(d) {
    var btn = document.getElementById('btn-'+d);
    if (!btn) return;
    var active = days === parseInt(d);
    btn.style.background = active ? '#A6C300' : '#1a1a1a';
    btn.style.color      = active ? '#0d0d0d' : '#999';
    btn.style.border     = active ? 'none' : '1px solid #333';
  });

  var wData = generateMockWeightData(days, athlete);
  var vData = generateMockVTaperData(days, athlete);
  var sData = generateMockSymmetryData(days, athlete);

  if (chart1) { try{chart1.destroy();}catch(e){} }
  if (chart2) { try{chart2.destroy();}catch(e){} }
  if (chart3) { try{chart3.destroy();}catch(e){} }

  var ctx1 = document.getElementById('chart-weight'); if (!ctx1) return;
  chart1 = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: wData.map(function(d){return d.date;}),
      datasets: [
        {label:'Peso Bruto', data:wData.map(function(d){return d.peso_bruto;}), borderColor:'#A6C300', backgroundColor:'rgba(166,195,0,0.1)', pointRadius:3, pointBackgroundColor:'#A6C300', tension:0.3, fill:false},
        {label:'MMA7',       data:wData.map(function(d){return d.mma7;}),       borderColor:'#CCCCCC', borderWidth:2, pointRadius:0, tension:0.3, fill:false}
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:true,
      plugins:{legend:{labels:{color:'#999',font:{size:11}},position:'bottom'}},
      scales:{
        x:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#999',font:{size:10}}},
        y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#999',font:{size:10},callback:function(v){return v.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});}}}
      }
    }
  });

  var ctx2 = document.getElementById('chart-vtaper'); if (!ctx2) return;
  var vt1mn=Math.min.apply(null,vData.map(function(d){return d.perimetro_ombros;}))-8;
  var vt1mx=Math.max.apply(null,vData.map(function(d){return d.perimetro_ombros;}))+8;
  var vt2mn=Math.min.apply(null,vData.map(function(d){return d.perimetro_cintura;}))-8;
  var vt2mx=Math.max.apply(null,vData.map(function(d){return d.perimetro_cintura;}))+8;
  chart2 = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: vData.map(function(d){return 'Sem '+d.semana;}),
      datasets: [
        {label:'Ombros (cm)', data:vData.map(function(d){return d.perimetro_ombros;}), backgroundColor:'#A6C300', yAxisID:'y'},
        {label:'Cintura (cm)',data:vData.map(function(d){return d.perimetro_cintura;}), backgroundColor:'#FFFFFF',  yAxisID:'y1'}
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:true,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:'#999',font:{size:11}},position:'bottom'}},
      scales:{
        y: {type:'linear',display:true,position:'left', title:{display:true,text:'Ombros (cm)',color:'#A6C300'},min:vt1mn,max:vt1mx,grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#999',font:{size:10}}},
        y1:{type:'linear',display:true,position:'right',title:{display:true,text:'Cintura (cm)',color:'#FFFFFF'},min:vt2mn,max:vt2mx,grid:{drawOnChartArea:false},ticks:{color:'#999',font:{size:10}}},
        x: {grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#999',font:{size:10}}}
      }
    }
  });

  var ctx3 = document.getElementById('chart-symmetry'); if (!ctx3) return;
  var aV=[];
  sData.forEach(function(d){aV.push(d.braco_esq,d.braco_dir,d.coxa_esq,d.coxa_dir);});
  chart3 = new Chart(ctx3, {
    type: 'bar',
    data: {
      labels: sData.map(function(d){return 'Q'+d.quinzena;}),
      datasets: [
        {label:'Braço Esq', data:sData.map(function(d){return d.braco_esq;}), backgroundColor:'#A6C300'},
        {label:'Braço Dir', data:sData.map(function(d){return d.braco_dir;}), backgroundColor:'#556600'},
        {label:'Coxa Esq',  data:sData.map(function(d){return d.coxa_esq;}),  backgroundColor:'#FFFFFF'},
        {label:'Coxa Dir',  data:sData.map(function(d){return d.coxa_dir;}),  backgroundColor:'#888888'}
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:true,
      plugins:{legend:{labels:{color:'#999',font:{size:11}},position:'bottom'}},
      scales:{
        x:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#999',font:{size:10}}},
        y:{grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:'#999',font:{size:10},callback:function(v){return v.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});}},min:Math.min.apply(null,aV)-4,max:Math.max.apply(null,aV)+4}
      }
    }
  });

  // ── Badge simetria ──
  var sl=sData[sData.length-1], sf=sData[0];
  var simB=(1-Math.abs(sl.braco_esq-sl.braco_dir)/Math.max(sl.braco_esq,sl.braco_dir))*100;
  var simC=(1-Math.abs(sl.coxa_esq -sl.coxa_dir) /Math.max(sl.coxa_esq, sl.coxa_dir)) *100;
  var mf=(sf.braco_esq+sf.braco_dir+sf.coxa_esq+sf.coxa_dir)/4;
  var ml=(sl.braco_esq+sl.braco_dir+sl.coxa_esq+sl.coxa_dir)/4;
  var evM=ml-mf;
  var isCr=simB<97||simC<97;
  var bdg=document.getElementById('badge-simetria');
  if(bdg){
    bdg.textContent=isCr?'⚠ ASSIMETRIA CRÍTICA':'✓ SIMÉTRICO';
    bdg.style.background  =isCr?'rgba(255,59,48,0.12)':'rgba(166,195,0,0.12)';
    bdg.style.color       =isCr?'#FF3B30':'#A6C300';
    bdg.style.borderColor =isCr?'rgba(255,59,48,0.3)':'rgba(166,195,0,0.3)';
  }
  function sm(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}
  function sc(id,c){var e=document.getElementById(id);if(e)e.style.color=c;}
  sm('metric-sim-braco',simB.toFixed(1).replace('.',',')+' %'); sc('metric-sim-braco',simB<97?'#FF3B30':'#EDEDE0');
  sm('metric-sim-coxa', simC.toFixed(1).replace('.',',')+' %'); sc('metric-sim-coxa', simC<97?'#FF3B30':'#EDEDE0');
  sm('metric-evolucao',(evM>=0?'+':'')+evM.toFixed(1).replace('.',',')+' cm');

  // ── Métricas peso ──
  var pi=wData[0].peso_bruto, pa=wData[wData.length-1].peso_bruto, va=pa-pi;
  var ps=wData.map(function(d){return d.peso_bruto;});
  sm('metric-peso-inicial',pi.toFixed(1).replace('.',',')+' kg');
  sm('metric-peso-atual',  pa.toFixed(1).replace('.',',')+' kg');
  sm('metric-variacao',(va>=0?'+':'')+va.toFixed(1).replace('.',',')+' kg'); sc('metric-variacao',va<=0?'#A6C300':'#FF3B30');
  sm('metric-menor',Math.min.apply(null,ps).toFixed(1).replace('.',',')+' kg');
  sm('metric-maior',Math.max.apply(null,ps).toFixed(1).replace('.',',')+' kg');

  // ── Métricas V-Taper ──
  var vtF=vData[0],vtL=vData[vData.length-1];
  var dO=vtL.perimetro_ombros-vtF.perimetro_ombros;
  var dC=vtL.perimetro_cintura-vtF.perimetro_cintura;
  sm('metric-ombros', (dO>=0?'+':'')+dO.toFixed(1).replace('.',',')+' cm'); sc('metric-ombros', dO>=0?'#A6C300':'#FF3B30');
  sm('metric-cintura',(dC>=0?'+':'')+dC.toFixed(1).replace('.',',')+' cm'); sc('metric-cintura',dC<=0?'#A6C300':'#FF3B30');
  sm('metric-vtaper',(vtL.perimetro_ombros/vtL.perimetro_cintura).toFixed(2).replace('.',',')+' x');
}

