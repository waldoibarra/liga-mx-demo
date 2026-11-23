import { Liga } from './engine.mjs';

export function prepareEdition(registry, baseline, results, edition) {
  const { clubs } = baseline;
  const rules = registry.formats[edition.format];
  const records = results[edition.id] ?? [];
  const regular = records.filter(record => record.phase === -1);
  const playoffs = records.filter(record => record.phase >= 0);
  const original = edition.id === 'apertura-2026';
  const games = original ? baseline.games : regular.filter(record => record.score)
    .map(g => [g.date,g.home,g.away,...g.score,g.venue]);
  const pending = original ? [] : regular.filter(record => !record.score);
  const scheduleReady = Boolean(rules && rules.clubs === clubs.length && games.length + pending.length === rules.regularMatches);
  const order = original ? clubs.map((_,i) => i) : results[`${edition.id}:order`];
  const seeds = order?.slice(0,8);
  const ready = scheduleReady && (pending.length > 0 || Boolean(seeds));
  const context = { clubCount: clubs.length, playoffs, pending, games, seeds };
  const lastResult = [...games.map(g => g[0]),...playoffs.filter(g => g.score).map(g => g.date)].sort().at(-1);
  const complete = playoffs.some(g => g.phase === 2 && g.leg === 2 && g.score);
  return { edition, rules, clubs, games, pending, order, seeds, context, ready, scheduleReady, lastResult, complete,
    training: games.length ? games : baseline.games };
}

export function validatePlayoffs(season) {
  const { playoffs } = season.context;
  if (!playoffs.some(g => g.score)) return;
  if (!season.seeds) throw new Error('Final standings are required to validate playoff results');
  const sim = Liga.simulator(() => [0,0], 0, season.context);
  const history = [];
  for (let phase = 0; phase < 3; phase++) {
    const actual = playoffs.filter(g => g.phase === phase && g.score);
    if (actual.length && history.some(ties => ties.some(t => !t.firstReal || !t.secondReal))) throw new Error('A playoff round is missing prior results');
    const ties = sim.next(history); history.push(ties);
    for (const game of actual) {
      if (!ties.some(t => [t.b,t.w].includes(game.home) && [t.b,t.w].includes(game.away))) throw new Error(`Unexpected playoff fixture ${game.id}`);
    }
    if (ties.some(t => t.secondReal && !t.firstReal)) throw new Error('A second leg is missing its first-leg result');
  }
}

export function defaultEdition(seasons) {
  const active = seasons.findIndex(s => s.ready && !s.complete);
  return active >= 0 ? active : Math.max(0,seasons.findLastIndex(s => s.ready));
}
