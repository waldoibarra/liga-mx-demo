import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defaultEdition, prepareEdition, validatePlayoffs } from '../app/edition.mjs';
import { Liga } from '../app/engine.mjs';
import { merge, normalize } from './update-results.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../app/${name}.json`, import.meta.url)));
const baseline = read('season');
const registry = read('tournaments');
const [apertura,clausura] = registry.editions;
const ids = new Map(registry.teamIds.map((id,i) => [id,i]));
const zero = () => [0,0];

function match(phase, leg, home, away, score, date = '2026-11-26T01:00Z') {
  return { id: `${phase}-${leg}-${home}-${away}`, date, phase, leg, home, away, score };
}

const prepare = (edition, fixtures) => prepareEdition(registry,baseline,fixtures,edition);

test('only completed ESPN scores become real, and penalties are separate', () => {
  const fixture = {
    id: 'final', date: '2026-12-14T01:00Z', season: { year: 2026, slug: 'apertura---finals' },
    status: { type: { name: 'STATUS_FINAL_PEN', completed: true } },
    competitions: [{ notes: [{ headline: '2nd Leg - Tied on aggregate' }], competitors: [
      { id: '218', homeAway: 'away', score: '1', shootoutScore: 5 },
      { id: '219', homeAway: 'home', score: '2', shootoutScore: 4 },
    ] }],
  };
  const result = normalize(fixture,apertura,ids);
  assert.equal(result.phase,2);
  assert.equal(result.leg,2);
  assert.deepEqual(result.score,[2,1]);
  assert.deepEqual(result.penalties,[4,5]);
  assert.equal(normalize(fixture,clausura,ids),null);
  const live = normalize({...fixture,status:{type:{name:'STATUS_IN_PROGRESS'}}},apertura,ids);
  assert.equal(live.score,undefined);
  assert.deepEqual(merge([result],[live]),[result]);
  assert.throws(() => merge([result],[{ ...result,id:'duplicate' }]),/Conflicting/);
});

test('a real first leg is fixed in every scenario even with reversed home order', () => {
  const first = match(0,1,0,7,[0,2]);
  const season = prepare(apertura,{ [apertura.id]:[first] });
  validatePlayoffs(season);
  for (const seed of [0,8,20261122]) {
    const [tie] = Liga.simulator(zero,seed,season.context).next([]);
    assert.equal(tie.firstReal,true);
    assert.equal(tie.secondReal,false);
    assert.equal(tie.firstHome,0);
    assert.equal(tie.secondHome,7);
    assert.deepEqual(tie.first,[0,2]);
    assert.equal(tie.winner,7);
  }
  assert.throws(() => validatePlayoffs(prepare(apertura,{ [apertura.id]:[match(0,2,0,7,[1,0])] })),/first-leg/);
});

test('a finished tournament keeps its real champion and yields the default to a ready successor', () => {
  const quarters = Liga.quarterfinals.flatMap(([b,w]) => [match(0,1,w,b,[0,0]),match(0,2,b,w,[0,0])]);
  const semis = [[0,3],[1,2]].flatMap(([b,w]) => [match(1,1,w,b,[0,0]),match(1,2,b,w,[0,0])]);
  const final = [match(2,1,1,0,[0,0]),{ ...match(2,2,0,1,[0,0]), penalties:[3,4] }];
  const current = prepare(apertura,{ [apertura.id]:[...quarters,...semis,...final] });
  validatePlayoffs(current);
  assert.equal(current.complete,true);
  const summary = Liga.summarize(zero,10,100,undefined,current.context);
  assert.equal(summary.clubs[1][2],100);
  assert.equal(summary.endings.Penalties,100);
  const opening = baseline.games.map(([date,home,away]) => match(-1,undefined,home,away,undefined,date));
  const next = prepare(clausura,{ [clausura.id]:opening });
  assert.equal(next.ready,true);
  assert.equal(next.pending.length,153);
  assert.equal(defaultEdition([current,next]),1);
  assert.equal(defaultEdition([current,prepare(clausura,{})]),0);
  const projected = Liga.simulator(zero,10,next.context).regular();
  assert.equal(projected.seeds.length,8);
  assert.ok(projected.standings.every(row => row.played === 17 && row.points === 17));
});
