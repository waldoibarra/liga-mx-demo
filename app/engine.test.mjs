import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Liga } from './engine.mjs';

const { clubs, games } = JSON.parse(readFileSync(new URL('./season.json', import.meta.url)));

test('the frozen regular-season snapshot agrees with the official points and seeding', () => {
  const table = Liga.standings(clubs, games);
  assert.equal(games.length, 153);
  assert.equal(new Set(games.map(([,h,a]) => [h,a].sort((x,y) => x-y).join(':'))).size, 153);
  assert.ok(table.every(row => row.played === 17));
  assert.deepEqual(table.map(row => row.points), [33,32,30,28,27,27,26,25,25,25,21,21,20,20,18,14,14,12]);
  assert.deepEqual(Liga.quarterfinals, [[0,7],[1,6],[2,5],[3,4]]);
});

test('aggregate ties favor the higher seed before the final; the final goes to penalties', () => {
  const sim = Liga.simulator(() => [0,0], 20261122);
  const quarters = sim.next([]);
  assert.ok(quarters.every(tie => tie.winner === tie.b && tie.decidedBy === 'Higher seed'));
  const semis = sim.next([quarters]);
  assert.deepEqual(semis.map(({ b,w }) => [b,w]), [[0,3],[1,2]]);
  const [final] = sim.next([quarters,semis]);
  assert.deepEqual(final.extra, [0,0]);
  assert.equal(final.decidedBy, 'Penalties');
  assert.notEqual(final.penalties[0], final.penalties[1]);
  assert.equal(final.winner, final.penalties[0] > final.penalties[1] ? final.b : final.w);
});

test('both playoff models reproduce a lower two-leg goal environment', () => {
  for (const model of ['club','league']) {
    const sim = Liga.simulator(Liga.fit(clubs, games, model), 20261122);
    let goals = 0, high = 0;
    const series = 7000;
    for (let i = 0; i < series / 7; i++) {
      const history = [];
      for (let phase = 0; phase < 3; phase++) {
        const ties = sim.next(history);
        history.push(ties);
        for (const { first, second } of ties) {
          const total = [...first,...second].reduce((sum, n) => sum + n, 0);
          goals += total;
          high += Number(total >= 8);
        }
      }
    }
    assert.ok(goals / series < 5.6, `${model}: ${goals / series} goals per series`);
    assert.ok(high / series < .22, `${model}: ${high / series} with 8+ goals`);
  }
});

test('progress reporting preserves deterministic results and every bracket has one champion', () => {
  const rate = Liga.fit(clubs, games, 'club');
  const progress = [];
  const result = Liga.summarize(rate, 20261122, 4200, done => progress.push(done));
  assert.deepEqual(progress, [2048,4096,4200]);
  assert.deepEqual(result, Liga.summarize(rate, 20261122, 4200));
  assert.deepEqual([0,1,2].map(i => result.clubs.reduce((sum, row) => sum + row[i], 0)), [16800,8400,4200]);
  assert.equal(Object.values(result.endings).reduce((sum, count) => sum + count), 4200);
});
