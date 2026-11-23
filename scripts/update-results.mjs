import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { prepareEdition, validatePlayoffs } from '../app/edition.mjs';

const api = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard';
const dayMs = 86_400_000;
const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });
const phaseNames = ['quarterfinals', 'semifinals', 'finals'];
const finished = new Set(['STATUS_FULL_TIME', 'STATUS_FINAL', 'STATUS_FINAL_AET', 'STATUS_FINAL_PEN']);

export function normalize(event, edition, ids) {
  const { season, competitions, status, date, id } = event;
  if (season?.year !== edition.year || !id || !Number.isFinite(Date.parse(date))) return null;
  const slug = season.slug ?? '';
  const phase = phaseNames.findIndex(name => slug === `${edition.half}---${name}`);
  if (phase < 0 && slug !== `torneo-${edition.half}`) return null;
  const fixture = competitions?.[0];
  const home = fixture?.competitors?.find(c => c.homeAway === 'home');
  const away = fixture?.competitors?.find(c => c.homeAway === 'away');
  if (!ids.has(home?.id) || !ids.has(away?.id) || home.id === away.id) throw new Error(`Unknown teams for ${id}`);
  const type = status?.type?.name ?? fixture.status?.type?.name;
  const complete = finished.has(type);
  if (status?.type?.completed && !complete) throw new Error(`Unknown completed status ${type} for ${id}`);
  const numbers = (a,b) => [a,b].every(x => x != null && /^\d+$/.test(String(x)));
  const result = { id, date, phase, home: ids.get(home.id), away: ids.get(away.id), venue: fixture.venue?.fullName ?? '' };
  if (phase >= 0) {
    const note = fixture.notes?.map(n => n.headline ?? n.text ?? '').join(' ') ?? '';
    const leg = note.match(/\b([12])(?:st|nd) Leg\b/i)?.[1];
    if (!leg) {
      if (complete) throw new Error(`No leg number for ${id}`);
      return null;
    }
    result.leg = Number(leg);
  }
  if (complete) {
    if (!numbers(home.score, away.score)) throw new Error(`Missing final score for ${id}`);
    result.score = [Number(home.score), Number(away.score)];
    if (type === 'STATUS_FINAL_AET') result.extraTime = true;
    if (type === 'STATUS_FINAL_PEN') {
      if (!numbers(home.shootoutScore, away.shootoutScore) || Number(home.shootoutScore) === Number(away.shootoutScore)) throw new Error(`Invalid penalties for ${id}`);
      result.penalties = [Number(home.shootoutScore), Number(away.shootoutScore)];
    }
  }
  return result;
}

export function merge(previous, fetched) {
  const records = new Map(previous.map(record => [record.id, record]));
  for (const next of fetched) {
    if (!next) continue;
    if (records.get(next.id)?.score && !next.score) continue;
    records.set(next.id, next);
  }
  const canonical = new Map();
  for (const record of [...records.values()].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const pair = [record.home, record.away].sort((a,b) => a-b).join(':');
    const key = `${record.phase}:${pair}:${record.leg ?? 0}`;
    const other = canonical.get(key);
    if (other?.score && record.score && other.id !== record.id) throw new Error(`Conflicting completed fixtures: ${key}`);
    if (!other?.score) canonical.set(key,record);
  }
  return [...canonical.values()].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

async function get(day) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${api}?dates=${day.replaceAll('-','')}`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`ESPN ${response.status} on ${day}`);
      const page = await response.json();
      if (!Array.isArray(page.events) || !Array.isArray(page.leagues?.[0]?.calendar)) throw new Error(`Unexpected ESPN response on ${day}`);
      return page;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
}

async function main() {
  const registry = JSON.parse(await readFile(new URL('../app/tournaments.json',import.meta.url)));
  const path = new URL('../app/results.json',import.meta.url);
  const previous = JSON.parse(await readFile(path));
  const baseline = JSON.parse(await readFile(new URL('../app/season.json',import.meta.url)));
  const output = { ...previous };
  const ids = new Map(registry.teamIds.map((id,i) => [id,i]));
  const now = new Date();
  const today = localDay.format(now);
  const yesterday = localDay.format(new Date(Number(now) - dayMs));
  const current = await get(today);
  const calendar = current.leagues[0].calendar.map(date => date.slice(0,10));
  const near = localDay.format(new Date(Number(now) + 45 * dayMs));
  const recent = localDay.format(new Date(Number(now) - 10 * dayMs));
  const pages = new Map([[today, current]]);
  for (const edition of registry.editions) {
    if (edition.regularStart > near || edition.collectUntil < today) continue;
    const old = previous[edition.id] ?? [];
    const dates = new Set([today,yesterday]);
    if (edition.id !== 'apertura-2026' && old.filter(r => r.phase === -1).length < registry.formats[edition.format].regularMatches) {
      for (const day of calendar) if (day >= edition.regularStart && day <= edition.collectUntil) dates.add(day);
    }
    for (const record of old) if (!record.score && localDay.format(new Date(record.date)) <= today) dates.add(localDay.format(new Date(record.date)));
    for (const day of calendar) if (day <= near && day >= edition.regularStart && day <= edition.collectUntil && (day >= recent || day > edition.regularEnd) && (edition.id !== 'apertura-2026' || day > edition.regularEnd)) dates.add(day);
    const request = [...dates].filter(day => day >= edition.regularStart && day <= edition.collectUntil);
    for (let offset = 0; offset < request.length; offset += 6) {
      await Promise.all(request.slice(offset, offset + 6).map(async day => { if (!pages.has(day)) pages.set(day,await get(day)); }));
    }
    const fetched = request.flatMap(day => pages.get(day).events).map(event => normalize(event,edition,ids))
      .filter(record => record && (edition.id !== 'apertura-2026' || record.phase >= 0));
    const records = merge(old,fetched);
    if (records.length) output[edition.id] = records;
    if (edition.id !== 'apertura-2026' && records.filter(r => r.phase === -1 && r.score).length === registry.formats[edition.format].regularMatches) {
      const response = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/mex.1/standings?season=${edition.year}`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`ESPN standings: ${response.status}`);
      const groups = (await response.json()).children ?? [];
      const entries = groups.find(g => g.name?.toLowerCase().includes(edition.half))?.standings?.entries ?? [];
      const stat = (entry,name) => entry.stats?.find(s => s.name === name)?.value;
      const ranked = entries.map(e => [stat(e,'rank'),ids.get(e.team.id),stat(e,'gamesPlayed')]).sort((a,b) => a[0]-b[0]);
      if (ranked.length !== registry.formats[edition.format].clubs || new Set(ranked.map(row => row[1])).size !== ranked.length || ranked.some(([rank,id,played],i) => rank !== i+1 || id == null || played !== ranked.length-1)) {
        throw new Error(`Final standings unavailable for ${edition.id}`);
      }
      output[`${edition.id}:order`] = ranked.map(row => row[1]);
    }
    validatePlayoffs(prepareEdition(registry,baseline,output,edition));
    console.log(`${edition.id}: ${records.length} fixtures, ${records.filter(r => r.score).length} complete`);
  }
  // A failed fetch or validation never overwrites the snapshot.
  const next = `${JSON.stringify(output,null,2)}\n`;
  if (next !== `${JSON.stringify(previous,null,2)}\n`) await writeFile(path,next);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
