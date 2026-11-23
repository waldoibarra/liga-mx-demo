export const Liga = (() => {
  const quarterfinals = [[0,7], [1,6], [2,5], [3,4]];
  const rounds = ['Quarterfinals', 'Semifinals', 'Final'];
  function seedRandom(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = Math.imul(seed ^ seed >>> 15, seed | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function standings(clubs, games) {
    const rows = clubs.map(() => ({ played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 }));
    for (const [,h,a,x,y] of games) {
      for (const [i,forGoals,against] of [[h,x,y],[a,y,x]]) {
        const row = rows[i]; row.played++; row.gf += forGoals; row.ga += against;
        if (forGoals > against) { row.wins++; row.points += 3; }
        else if (forGoals === against) { row.draws++; row.points++; }
        else row.losses++;
      }
    }
    return rows;
  }
  function fit(clubs, games, mode) {
    const size = clubs.length;
    const rates = [3,4].map((i,j) => Math.max(.05, games.length ? games.reduce((total,g) => total + g[i], 0) / games.length : [1.55,1.42][j]));
    if (mode === 'league') return () => rates;
    const w = [...rates.map(Math.log), ...Array(2 * size).fill(0)];
    for (let step = 0; step < 850; step++) {
      const grad = [0,0,...w.slice(2).map(v => -6 * v)];
      for (const [,h,a,x,y] of games) {
        for (const [side,attack,defense,goals] of [[0,h,a,x],[1,a,h,y]]) {
          const i = 2 + attack, j = 2 + size + defense;
          const residual = goals - Math.exp(w[side] + w[i] + w[j]);
          grad[side] += residual; grad[i] += residual; grad[j] += residual;
        }
      }
      for (let i = 0; i < w.length; i++) w[i] += .002 * grad[i];
    }
    return (h,a) => [Math.exp(w[0] + w[2+h] + w[2+size+a]), Math.exp(w[1] + w[2+a] + w[2+size+h])];
  }
  function poisson(rate) {
    const p = [Math.exp(-rate)];
    for (let i = 1; i <= 22; i++) p.push(p[i-1] * rate / i);
    return p;
  }
  function forecast(rate, h, a) {
    const [x,y] = rate(h,a).map(poisson);
    let mode = [0,0,0]; const outcomes = [0,0,0];
    for (let i = 0; i < x.length; i++) for (let j = 0; j < y.length; j++) {
      const p = x[i] * y[j];
      outcomes[1 + Math.sign(j-i)] += p;
      if (p > mode[2]) mode = [i,j,p];
    }
    return { mode, outcomes };
  }
  function shootout(random) {
    const goals = [0,0], taken = [0,0];
    const first = random() < .5 ? 0 : 1;
    const kick = side => { taken[side]++; goals[side] += Number(random() < .75); };
    for (let i = 0; i < 10; i++) {
      kick((first + i) % 2);
      if (goals.some((g,s) => g > goals[1-s] + 5 - taken[1-s])) return goals;
    }
    while (goals[0] === goals[1]) { kick(first); kick(1-first); }
    return goals;
  }
  function simulator(rate, seed, context = {}) {
    const { clubCount = 8, playoffs = [], pending = [], games = [], seeds: fixedSeeds } = context;
    const random = seedRandom(seed);
    const fixtureKey = (phase,h,a,leg) => `${phase}:${Math.min(h,a)}:${Math.max(h,a)}:${leg}`;
    const fixtures = new Map(playoffs.map(g => [fixtureKey(g.phase,g.home,g.away,g.leg),g]));
    const cdf = p => { let sum = 0; return p.map(v => sum += v); };
    const tables = [1, 1/3].map(factor => Array.from({length: clubCount}, (_,h) =>
      Array.from({length: clubCount}, (_,a) => rate(h,a).map(l => cdf(poisson(l * factor))))));
    function score(h,a,extra = false) {
      return tables[Number(extra)][h][a].map(c => {
        const draw = random(); let i = 0;
        while (i < c.length - 1 && draw >= c[i]) i++;
        return i;
      });
    }
    function regular() {
      if (fixedSeeds || (pending.length === 0 && games.length === 0)) return { seeds: fixedSeeds ?? quarterfinals.map(([b]) => b).concat([4,5,6,7]) };
      const played = pending.length ? [...games, ...pending.map(g => [g.date,g.home,g.away,...score(g.home,g.away)])] : games;
      const rows = standings(Array(clubCount).fill(null),played);
      const away = Array.from({ length: clubCount }, () => [0]);
      for (const [, ,a, ,y] of [...played].sort((x,y) => x[0].localeCompare(y[0]))) away[a].push(away[a].at(-1)+y);
      const lots = rows.map(() => random());
      const order = rows.map((_,i) => i).sort((i,j) => {
        const a = rows[i], b = rows[j], size = Math.min(away[i].length,away[j].length)-1;
        return b.points-a.points || (b.gf-b.ga)-(a.gf-a.ga) || b.gf-a.gf || away[j][size]-away[i][size] || lots[i]-lots[j];
      });
      return { seeds: order.slice(0,8), standings: order.map(i => ({ i, ...rows[i] })) };
    }
    function round(pairs, phase, seeds) {
      return pairs.map(([b,w]) => {
        const leg1 = fixtures.get(fixtureKey(phase,b,w,1));
        const leg2 = fixtures.get(fixtureKey(phase,b,w,2));
        const firstHome = leg1?.home ?? (leg2?.home === w ? b : w);
        const secondHome = leg2?.home ?? (firstHome === b ? w : b);
        const first = leg1?.score ?? score(firstHome,firstHome === b ? w : b);
        const second = leg2?.score ?? score(secondHome,secondHome === b ? w : b);
        const aggregate = [first[Number(firstHome !== b)] + second[Number(secondHome !== b)], first[Number(firstHome === b)] + second[Number(secondHome === b)]];
        const orient = goals => secondHome === b ? goals : [...goals].reverse();
        let extra = null, penalties = leg2?.penalties ? orient(leg2.penalties) : null;
        let decidedBy = penalties ? 'Penalties' : leg2?.extraTime ? 'Extra time' : 'Regulation';
        if (aggregate[0] === aggregate[1] && !penalties) {
          if (phase < 2) decidedBy = 'Higher seed';
          else if (!leg2?.score) {
            extra = orient(score(secondHome,secondHome === b ? w : b,true)); decidedBy = 'Extra time';
            aggregate[0] += extra[0]; aggregate[1] += extra[1];
            if (aggregate[0] === aggregate[1]) { penalties = shootout(random); decidedBy = 'Penalties'; }
          } else throw new Error('Completed final is tied without shootout data');
        }
        const result = penalties ?? aggregate;
        return { b,w,first,second,firstHome,secondHome,firstReal:Boolean(leg1?.score),secondReal:Boolean(leg2?.score),
          aggregate,extra,penalties,decidedBy,seeds,winner: result[0] >= result[1] ? b : w };
      });
    }
    function next(history, seeds = history[0]?.[0]?.seeds ?? regular().seeds) {
      if (history.length === 0) return round(quarterfinals.map(([b,w]) => [seeds[b],seeds[w]]), 0, seeds);
      const winners = history.at(-1).map(t => t.winner).sort((a,b) => seeds.indexOf(a)-seeds.indexOf(b));
      if (history.length === 1) return round([[winners[0],winners[3]],[winners[1],winners[2]]],1,seeds);
      return round([winners],2,seeds);
    }
    return { next, regular };
  }
  function summarize(rate, seed, n, onProgress, context = {}) {
    const sim = simulator(rate, seed, context);
    const clubs = Array.from({length:context.clubCount ?? 8}, () => [0,0,0]);
    const matchups = [new Map(),new Map()];
    const endings = { Regulation: 0, 'Extra time': 0, Penalties: 0 };
    const add = (map,key) => map.set(key, (map.get(key) ?? 0) + 1);
    for (let i = 0; i < n; i++) {
      const history = [];
      const { seeds } = sim.regular();
      for (let phase = 0; phase < 3; phase++) {
        const ties = sim.next(history,seeds); history.push(ties);
        for (const t of ties) {
          clubs[t.winner][phase]++;
          if (!phase) continue;
          const map = matchups[phase-1], key = `${t.firstHome},${t.secondHome}`;
          if (!map.has(key)) map.set(key,{ b:t.secondHome,w:t.firstHome,count:0,legs:[new Map(),new Map()] });
          const summary = map.get(key); summary.count++;
          add(summary.legs[0], t.first.join('–')); add(summary.legs[1], t.second.join('–'));
          if (phase === 2) endings[t.decidedBy]++;
        }
      }
      if ((i + 1) % 2048 === 0 || i + 1 === n) onProgress?.(i + 1);
    }
    const mostCommon = map => [...map].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]))[0][0];
    return { clubs, endings, matchups: matchups.map(map => [...map.values()]
      .sort((a,b) => b.count-a.count || a.b-b.b || a.w-b.w)
      .map(t => ({ ...t, legs: t.legs.map(mostCommon) }))) };
  }
  return { quarterfinals, rounds, standings, fit, forecast, simulator, summarize };
})();
