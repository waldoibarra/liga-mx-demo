import { Liga } from './engine.mjs';
import { defaultEdition, prepareEdition } from './edition.mjs';

const $ = id => document.getElementById(id);
const letters = ['A', 'B'];
const roundNames = ['Cuartos', 'Semifinales', 'Final'];
const decisions = { Regulation: 'Tiempo reglamentario', 'Higher seed': 'Mejor posición', 'Extra time': 'Prórroga', Penalties: 'Penales' };
const modelNames = { club: 'Por club', league: 'Promedio de liga' };
const integer = new Intl.NumberFormat('es-MX');
const percent = new Intl.NumberFormat('es-MX', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const difference = new Intl.NumberFormat('es-MX', { signDisplay: 'exceptZero', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dates = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' });
let season;
let editions;
let projection;
let history = [];
let bracketSim;
let bracketSeed;
const scores = new Map();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function table(label, columns, rows) {
  const scroll = element('div', null, 'scroll');
  const t = element('table');
  t.setAttribute('aria-label', label);
  for (const [i, values] of [columns, ...rows].entries()) {
    const row = (i === 0 ? t.tHead ?? t.createTHead() : t.tBodies[0] ?? t.createTBody()).insertRow();
    for (const [j, value] of values.entries()) {
      const cell = element(i === 0 || j === 0 ? 'th' : 'td');
      if (cell.tagName === 'TH') cell.scope = i === 0 ? 'col' : 'row';
      cell.append(value);
      row.append(cell);
    }
  }
  scroll.append(t);
  return scroll;
}

const scenarios = letters.map((letter, index) => {
  const form = $('scenario-template').content.firstElementChild.cloneNode(true);
  form.querySelector('h3').textContent = `Escenario ${letter}`;
  form.elements.namedItem('model').value = index === 0 ? 'club' : 'league';
  const progress = form.querySelector('progress');
  progress.setAttribute('aria-label', `Progreso del escenario ${letter}`);
  $('scenarios').append(form);
  return {
    form, progress, letter, worker: null, output: null,
    status: form.querySelector('.state'), message: form.querySelector('.scenario-message'),
    fields: form.querySelector('fieldset'), start: form.querySelector('[type=submit]'), cancel: form.querySelector('.cancel'),
  };
});

function config(s) {
  const { elements } = s.form;
  return { model: elements.namedItem('model').value, runs: elements.namedItem('runs').valueAsNumber, seed: elements.namedItem('seed').valueAsNumber };
}

function setState(s, state, text, message = '') {
  s.status.dataset.state = state;
  s.status.textContent = text;
  s.message.textContent = message;
  s.fields.disabled = s.start.disabled = Boolean(s.worker) || !season?.ready;
  s.cancel.disabled = !s.worker;
  $('run-both').disabled = !season?.ready || scenarios.some(item => item.worker);
}

function end(s, worker, state, text, message) {
  if (s.worker !== worker) return false;
  worker?.terminate();
  s.worker = null;
  setState(s, state, text, message);
  return true;
}

function run(s) {
  if (!season?.ready || s.worker || !s.form.reportValidity()) return;
  const settings = config(s);
  const { runs, seed, model } = settings;
  let worker;
  try {
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
  } catch {
    setState(s, 'error', 'No disponible', 'No se pudo iniciar el cálculo. Recarga e inténtalo de nuevo.');
    return;
  }
  s.worker = worker;
  s.progress.max = runs;
  s.progress.value = 0;
  setState(s, 'running', 'Calculando', `0 de ${integer.format(runs)} corridas`);
  let announced = 0;
  worker.onmessage = ({ data }) => {
    if (s.worker !== worker) return;
    if (data.kind === 'progress') {
      s.progress.value = data.done;
      const step = Math.floor(4 * data.done / runs);
      if (step > announced) {
        announced = step;
        s.message.textContent = `${integer.format(data.done)} de ${integer.format(runs)} corridas`;
      }
      return;
    }
    s.output = { ...settings, result: data.result };
    s.progress.value = runs;
    end(s, worker, 'done', 'Completo', `${integer.format(runs)} corridas · semilla ${seed} · ${modelNames[model]}`);
    renderResults();
  };
  worker.onerror = event => {
    event.preventDefault();
    end(s, worker, 'error', 'Error de cálculo', 'No se completó este escenario. Puedes volver a intentarlo.');
  };
  worker.postMessage({ clubs: season.clubs, training: season.training, context: season.context, ...settings });
}

function probabilityCell(count, total, index) {
  const box = element('div', percent.format(count / total), `bar-cell${index ? ' series-b' : ''}`);
  const bar = element('span', null, 'bar');
  bar.setAttribute('aria-hidden', 'true');
  const fill = element('i');
  fill.style.width = `${100 * count / total}%`;
  bar.append(fill); box.append(bar);
  return box;
}

function clubName(i) { return season.clubs[i]; }

function renderResults() {
  const outputs = scenarios.map(s => s.output);
  const highlights = scenarios.map((s, index) => {
    const o = s.output;
    const node = element('div', null, `metric${index ? ' series-b' : ''}`);
    if (!o) {
      node.append(element('h3', `Escenario ${s.letter}`), element('p', 'Sin resultados todavía'));
      return node;
    }
    const top = o.result.clubs.reduce((best, counts, i) => counts[2] > o.result.clubs[best][2] ? i : best, 0);
    node.append(element('p', `Escenario ${s.letter} · ${modelNames[o.model]} · ${integer.format(o.runs)} corridas · semilla ${o.seed}`),
      element('strong', percent.format(o.result.clubs[top][2] / o.runs)), element('h3', `${clubName(top)}, mayor frecuencia de título`));
    return node;
  });
  $('highlights').replaceChildren(...highlights);
  const [a,b] = outputs;
  if (!a && !b) {
    $('probabilities').replaceChildren(element('p', 'Completa una simulación para ver las probabilidades.', 'muted'));
    $('matchups').replaceChildren();
    return;
  }
  const rows = (season.seeds ?? season.clubs.map((_,i) => i)).map(i => {
    const club = clubName(i);
    const val = (o,k) => o ? percent.format(o.result.clubs[i][k] / o.runs) : '—';
    const delta = a && b ? `${difference.format(100 * (b.result.clubs[i][2] / b.runs - a.result.clubs[i][2] / a.runs))} pp` : '—';
    return [club, val(a,0), val(b,0), val(a,1), val(b,1),
      a ? probabilityCell(a.result.clubs[i][2],a.runs,0) : '—', b ? probabilityCell(b.result.clubs[i][2],b.runs,1) : '—', delta];
  });
  $('probabilities').replaceChildren(table('Probabilidades de avanzar y ganar por club',
    ['Club','Semis A','Semis B','Final A','Final B','Campeón A','Campeón B','Diferencia'], rows));
  $('matchups').replaceChildren(...outputs.map((o,index) => {
    const block = element('div');
    block.append(element('h3', `Escenario ${letters[index]}`));
    if (!o) { block.append(element('p','Sin resultados todavía')); return block; }
    const matchRows = o.result.matchups.flatMap((matches,i) => matches.slice(0,3).map(t => [
      roundNames[i+1], `${clubName(t.w)} ${t.legs[0]} ${clubName(t.b)}`,
      `${clubName(t.b)} ${t.legs[1]} ${clubName(t.w)}`, percent.format(t.count/o.runs),
    ]));
    const endings = Object.entries(o.result.endings).map(([decision,count]) => [decisions[decision],percent.format(count/o.runs)]);
    block.append(table(`Cruces más frecuentes, escenario ${letters[index]}`, ['Ronda','Ida','Vuelta','Frecuencia'],matchRows),
      element('h4','Cómo se resolvió la final'), table(`Desenlaces, escenario ${letters[index]}`,['Desenlace','Frecuencia'],endings));
    return block;
  }));
}

function currentScenario() { return scenarios[Number($('bracket-scenario').value)]; }
function modelRate(mode) {
  if (!scores.has(mode)) scores.set(mode, Liga.fit(season.clubs, season.training, mode));
  return scores.get(mode);
}

function renderBracket() {
  const done = history.length === 3;
  const regular = season.pending.length > 0 && !projection;
  const seeds = projection?.seeds ?? season.seeds;
  $('next-round').disabled = done || !season.ready;
  $('new-bracket').disabled = !season.ready;
  $('replay-bracket').disabled = !season.ready || bracketSeed == null;
  $('bracket-seed').textContent = bracketSeed == null ? '' : `Semilla de esta corrida: ${bracketSeed}`;
  $('next-round').textContent = regular ? 'Simular fase regular pendiente' : ['Simular cuartos', 'Simular semifinales', 'Simular final', 'Simulación completa'][history.length];
  $('bracket-status').textContent = !season.ready ? 'Llave aún no disponible.' : done ? `Campeón: ${clubName(history[2][0].winner)}` : regular ? 'Primero define los ocho clasificados.' : `Siguiente ronda: ${roundNames[history.length]}`;
  $('projection').hidden = !projection?.standings;
  $('projected-standings').replaceChildren(...(projection?.standings ? [standingsTable(projection.standings)] : []));
  $('bracket').replaceChildren(...roundNames.map((round,i) => {
    const column = element('section', null, 'round');
    column.append(element('h3', round));
    const ties = history[i] ?? (i === 0 && seeds ? Liga.quarterfinals.map(([b,w]) => ({ b:seeds[b],w:seeds[w] })) : []);
    if (ties.length === 0) column.append(element('p','Por definir','muted'));
    for (const tie of ties) {
      const pair = element('div',null,'tie');
      for (const [j,team] of [tie.b,tie.w].entries()) {
        const line = element('div',null,`team${tie.winner === team ? ' winner' : ''}`);
        line.append(element('span',`#${seeds.indexOf(team)+1}`), element('span',clubName(team)),element('strong',tie.aggregate?.[j] ?? '—'));
        pair.append(line);
      }
      if (tie.aggregate) {
        const leg = (label,home,score,real) => `${label}: ${clubName(home)} ${score.join('–')} ${clubName(home === tie.b ? tie.w : tie.b)} (${real ? 'real' : 'simulado'})`;
        const parts = [leg('Ida',tie.firstHome,tie.first,tie.firstReal),leg('Vuelta',tie.secondHome,tie.second,tie.secondReal),decisions[tie.decidedBy]];
        if (tie.extra) parts.push(`Prórroga ${tie.extra.join('–')}`);
        if (tie.penalties) parts.push(`Penales ${tie.penalties.join('–')}`);
        pair.append(element('p',parts.join(' · ')));
      }
      column.append(pair);
    }
    return column;
  }));
}

function renderForecast() {
  const seeds = projection?.seeds ?? season.seeds;
  if (!seeds) { $('fixtures').replaceChildren(element('p','Los cruces se muestran después de definir los ocho clasificados.')); return; }
  const rate = modelRate(config(currentScenario()).model);
  const rows = Liga.quarterfinals.flatMap(([better,worse]) => {
    const b = seeds[better], w = seeds[worse];
    const series = season.context.playoffs.filter(g => g.phase === 0 && [b,w].includes(g.home) && [b,w].includes(g.away));
    const firstHome = series.find(g => g.leg === 1)?.home ?? (series.find(g => g.leg === 2)?.home === w ? b : w);
    return [firstHome,firstHome === b ? w : b].map((h,i) => {
      const a = h === b ? w : b;
      const game = series.find(g => g.leg === i+1);
      const labels = [i === 0 ? 'Ida' : 'Vuelta',clubName(h),clubName(a)];
      if (game?.score) return [...labels,`${game.score.join('–')} · Real`,'—','—','—'];
      const { mode, outcomes } = Liga.forecast(rate,h,a);
      return [...labels,`${mode[0]}–${mode[1]} (${percent.format(mode[2])})`,...outcomes.map(v => percent.format(v))];
    });
  });
  $('fixtures').replaceChildren(table('Pronóstico de cuartos',['Partido','Local','Visitante','Marcador','Gana local','Empate','Gana visitante'],rows));
}

function resetBracket(seed = null) {
  history = []; projection = null; bracketSim = null; bracketSeed = seed;
  renderBracket(); renderForecast();
}

function newBracketSeed(previous) {
  const [seed] = crypto.getRandomValues(new Uint32Array(1));
  return seed === previous ? (seed + 1) >>> 0 : seed;
}

function advanceBracket() {
  if (!season?.ready || history.length === 3) return;
  const { model } = config(currentScenario());
  bracketSeed ??= newBracketSeed();
  bracketSim ??= Liga.simulator(modelRate(model),bracketSeed,season.context);
  if (season.pending.length && !projection) projection = bracketSim.regular();
  else history.push(bracketSim.next(history,projection?.seeds));
  renderBracket(); renderForecast();
}

function renderArchive() {
  const filter = $('club-filter').value;
  const rows = [...season.games,...season.pending.map(g => [g.date,g.home,g.away,null,null,g.venue])]
    .filter(([,h,a]) => filter === 'all' || h === +filter || a === +filter)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([date,h,a,x,y,venue]) => [dates.format(new Date(date)),clubName(h),x == null ? 'Pendiente' : `${x}–${y}`,clubName(a),venue]);
  $('archive').replaceChildren(table('Calendario de fase regular, hora de Ciudad de México',['Fecha y hora (CDMX)','Local','Marcador','Visitante','Estadio'],rows));
}

for (const s of scenarios) {
  setState(s, 'idle', 'Listo');
  s.form.addEventListener('submit', event => { event.preventDefault(); run(s); });
  s.form.addEventListener('change', event => {
    if (season && currentScenario() === s && event.target.name === 'model') resetBracket();
  });
  s.cancel.addEventListener('click', () => end(s, s.worker, 'canceled', 'Cancelado', s.output ? 'Se conserva el último resultado completo.' : 'No se guardaron resultados parciales.'));
}
$('run-both').addEventListener('click', () => {
  if (scenarios.every(s => s.form.reportValidity())) scenarios.forEach(run);
});
$('bracket-scenario').addEventListener('change', () => { if (season) resetBracket(); });
$('next-round').addEventListener('click', advanceBracket);
$('new-bracket').addEventListener('click', () => {
  resetBracket(newBracketSeed(bracketSeed));
  advanceBracket();
});
$('replay-bracket').addEventListener('click', () => {
  resetBracket(bracketSeed);
  advanceBracket();
});
$('club-filter').addEventListener('change', () => { if (season) renderArchive(); });

function standingsTable(rows) {
  return table('Tabla general',['Club','Posición','J','G','E','P','GF','GC','DG','Pts'],
    rows.map((r,i) => [clubName(r.i),i+1,r.played,r.wins,r.draws,r.losses,r.gf,r.ga,r.gf-r.ga,r.points]));
}

function showEdition(index) {
  for (const s of scenarios) {
    s.worker?.terminate(); s.worker = null; s.output = null; s.progress.value = 0;
  }
  season = editions[index]; scores.clear();
  $('edition-title').textContent = season.edition.label;
  $('rules-source').href = season.rules?.source ?? 'https://ligamx.net/cancha/reglamentos';
  document.title = `Simulador Liga MX · ${season.edition.label}`;
  const playoffCount = season.context.playoffs.filter(g => g.score).length;
  $('edition-status').textContent = [season.complete ? 'Torneo finalizado' : null, `${season.games.length + playoffCount} partidos terminados`,
    season.lastResult ? `Último partido: ${dates.format(new Date(season.lastResult))}` : null].filter(Boolean).join(' · ');
  const rows = Liga.standings(season.clubs,season.games).map((r,i) => ({ i,...r }));
  const ordered = season.order?.map(i => rows[i]) ?? rows.sort((a,b) => b.points-a.points || (b.gf-b.ga)-(a.gf-a.ga) || b.gf-a.gf);
  $('standings').replaceChildren(standingsTable(ordered));
  const fixtures = season.context.playoffs.map(g => [roundNames[g.phase],g.leg === 1 ? 'Ida' : 'Vuelta',dates.format(new Date(g.date)),
    clubName(g.home), g.score ? `${g.score.join('–')}${g.penalties ? ` (${g.penalties.join('–')} pen.)` : ''}` : 'Pendiente',clubName(g.away),g.venue]);
  $('playoff-results').replaceChildren(fixtures.length ? table('Partidos de Liguilla', ['Ronda','Partido','Fecha (CDMX)','Local','Marcador','Visitante','Estadio'],fixtures)
    : element('p','No hay partidos de Liguilla publicados en la fuente.'));
  renderArchive(); resetBracket(); renderResults();
  $('load-status').textContent = season.ready ? '' : (season.scheduleReady ? 'Esperando la tabla final para fijar los cruces.' : 'Esperando el calendario completo de este torneo.');
  for (const s of scenarios) { setState(s,'idle',season.ready ? 'Listo' : 'Pendiente'); if (season.ready) run(s); }
}

async function load() {
  const [baseline,registry,results] = await Promise.all(['season.json','tournaments.json','results.json'].map(async file => {
    const response = await fetch(`./${file}`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Unavailable: ${file}`);
    return response.json();
  }));
  editions = registry.editions.map(edition => prepareEdition(registry,baseline,results,edition));
  for (const [i, club] of baseline.clubs.entries()) $('club-filter').add(new Option(club,i));
  const picker = $('edition-picker');
  editions.forEach((s,i) => picker.add(new Option(s.edition.label,i)));
  picker.disabled = false;
  picker.value = defaultEdition(editions);
  picker.addEventListener('change', () => showEdition(Number(picker.value)));
  showEdition(Number(picker.value));
}
load().catch(error => {
  console.error(error);
  $('load-status').textContent = 'No se pudieron cargar los datos. Abre la app desde el servidor local y recarga.';
});
