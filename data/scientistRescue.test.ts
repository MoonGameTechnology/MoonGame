import { describe, expect, it } from 'vitest';
import { parseMatchMap, validateMatchMap, visibleState, type GameState } from '../packages/shared-core/src/index';
import { kernel } from '../prototype/src/protoKernel';
import { data } from '../prototype/src/gameData';
import { pveChapter, pveModeId, pveObjectives, pveRescues, pveState } from '../packages/client/src/gameData';
import { objectiveProgress, shownObjectives } from '../decisions/missionObjectives';
import { missionTargets } from '../decisions/missionView';
import { chapterTargets } from '../decisions/chapterMap';
import { retireDoneEncounters } from '../decisions/retiredEncounters';
import { freshSectorZeroProgress, newSectorHero, prepareSectorZeroRun, settleSectorZeroRun } from '../decisions/sectorZeroProgress';
import { grantChapterHeroes } from '../decisions/heroRecruits';
import mapJson from './maps/pve-1.json';

const station = 'research_station';
const objectiveId = 'mission.rescue-scientist';
const objective = () => pveObjectives().find((o) => o.id === objectiveId)!;
const start = () => prepareSectorZeroRun(pveState(data), freshSectorZeroProgress(data), data);
const ctx = (now: number) => ({ now, data, config: { timeScale: 1, travelSpeedFactor: 5 } });
const scientists = (s: GameState) => Object.values(s.heroes ?? {}).filter((h) => h.archetype === 'scientist');

/** The same context under the chapter's PvE mode: waves, the tally and `pve.abandon` live there. */
const pveCtx = (now: number) => ({ ...ctx(now), config: { ...ctx(now).config, modeId: pveModeId() } });

/** Follow the real movement scheduler, including intermediate road segments. */
function fly(s: GameState, fleetId: string, to: string, at = ctx): GameState {
  const moved = kernel.applyAction(s, {
    id: `move:${s.time}:${fleetId}`, type: 'fleet.move', playerId: s.fleets[fleetId]!.owner,
    issuedAt: s.time, payload: { fleetId, to },
  }, at(s.time));
  if (!moved.ok) throw new Error(moved.code);
  let next = moved.state;
  for (let i = 0; i < 100 && next.fleets[fleetId]?.movement; i++) {
    const when = next.scheduled.filter((e) => e.type === 'fleet.arrival').map((e) => e.at).sort((a, b) => a - b)[0];
    expect(when).toBeDefined();
    const step = kernel.advanceTo(next, at(when!));
    if (!step.ok) throw new Error(step.code);
    expect(step.failures).toEqual([]);
    next = step.state;
  }
  expect(next.fleets[fleetId]?.location).toBe(to);
  return next;
}

describe('Chapter I: rescue the scientist on arrival', () => {
  it('adds a central station and puts its unfinished mission first, with a map marker', () => {
    const map = parseMatchMap(mapJson);
    expect(validateMatchMap(map, data)).toEqual([]);
    expect(Object.keys(map.sectors)).toHaveLength(13);
    expect(map.sectors[station]).toMatchObject({ position: { x: 150, y: 0 }, kind: 'void_station', recruitHero: 'scientist', owner: null });
    const s = start();
    expect(shownObjectives(pveObjectives(), [])[0]?.id).toBe(objectiveId);
    expect(objectiveProgress(objective(), s, 'p1').complete).toBe(false);
    expect(missionTargets(objective(), s, 'p1')).toEqual([station]);
    expect(chapterTargets(s, pveObjectives(), new Set([objectiveId]), new Set()).active).toEqual([station]);
    expect(scientists(s)).toHaveLength(0);
    // Sight / ownership alone do not rescue anyone.
    s.planets[station]!.owner = 'p1';
    expect(objectiveProgress(objective(), s, 'p1').complete).toBe(false);
  });

  it('does not complete when a movement order is merely issued', () => {
    const s = start();
    const ordered = kernel.applyAction(s, {
      id: 'approach', type: 'fleet.move', playerId: 'p1', issuedAt: 0,
      payload: { fleetId: 'p1_1', to: station },
    }, ctx(0));
    if (!ordered.ok) throw new Error(ordered.code);
    expect(ordered.state.fleets.p1_1!.movement).toBeTruthy();
    expect(scientists(ordered.state)).toHaveLength(0);
    expect(objectiveProgress(objective(), ordered.state, 'p1').complete).toBe(false);
  });

  it('completes at physical arrival and creates the playable scientist ship at the station', () => {
    const before = start();
    const s = fly(before, 'p1_1', station);
    expect(scientists(before)).toHaveLength(0);
    expect(objectiveProgress(objective(), s, 'p1').complete).toBe(true);
    expect(missionTargets(objective(), s, 'p1')).toEqual([]);
    const [hero] = scientists(s);
    expect(scientists(s)).toHaveLength(1);
    expect(hero).toMatchObject({ owner: 'p1', alive: true, location: station, abilities: ['scan'], passives: ['field_lab', 'ballistic_model'] });
    expect(hero!.equipped).toEqual(['scan', 'ballistic_model']);
    expect(Object.keys(s.fleets)).toHaveLength(Object.keys(before.fleets).length + 1);
    expect(s.fleets[hero!.fleetId!]).toMatchObject({ owner: 'p1', location: station, units: [{ unit: data.heroes.scientist!.ship.unit, count: 1 }] });
    const view = visibleState(s, 'p1', data);
    expect(objectiveProgress(objective(), view, 'p1').complete).toBe(true);
    expect(visibleState(s, 'p3', data).missionFacts?.recruited?.p1).toBeUndefined();
  });

  it('does not duplicate a scientist already chosen for the expedition', () => {
    const progress = freshSectorZeroProgress(data);
    progress.heroes.scientist = newSectorHero('scientist', data);
    progress.selectedHero = 'scientist';
    const before = prepareSectorZeroRun(pveState(data), progress, data);
    const s = fly(before, 'sector-zero:flagship', station);
    expect(scientists(s).map((h) => h.id)).toEqual(['sector-zero:hero']);
    expect(Object.keys(s.fleets)).toHaveLength(Object.keys(before.fleets).length);
    expect(objectiveProgress(objective(), s, 'p1').complete).toBe(true);
  });

  it('survives a save round trip, departure and another fleet arrival without a second reward', () => {
    let s = fly(start(), 'p1_1', station);
    const heroId = scientists(s)[0]!.id;
    s = JSON.parse(JSON.stringify(s));
    s = fly(s, 'p1_1', 'home_a');
    s = fly(s, 'p1_2', station);
    expect(scientists(s).map((h) => h.id)).toEqual([heroId]);
    expect(s.missionFacts?.recruited?.p1).toEqual([station]);
    expect(objectiveProgress(objective(), s, 'p1').complete).toBe(true);
  });

  it('does not let the Swarm claim the rescue', () => {
    const s = start();
    // Give the AI a neighbouring neutral start to exercise a real arrival.
    s.fleets.p3_2!.location = s.planets[station]!.links![0]!;
    const next = fly(s, 'p3_2', station);
    expect(scientists(next)).toHaveLength(0);
    expect(objectiveProgress(objective(), next, 'p1').complete).toBe(false);
  });

  it('retires the completed rescue on a later run, keeping the station', () => {
    const before = start();
    const retired = retireDoneEncounters(before, pveObjectives(), [objectiveId]);
    expect(before.planets[station]!.recruitHero).toBe('scientist');
    expect(retired.planets[station]!.recruitHero).toBeUndefined();
    expect(retired.planets[station]!.kind).toBe('void_station');
    expect(scientists(fly(retired, 'p1_1', station))).toHaveLength(0);
    expect(shownObjectives(pveObjectives(), [objectiveId]).some((o) => o.id === objectiveId)).toBe(false);
  });

  // Баг-репорт владельца 2026-09-27: «выполнил миссию, забрал учёного, завершил сам
  // экспедицию, а учёного в подготовке не появилось». Выдача была только за победу в главе.
  it('brings the scientist into the squad after a rescue even when the run is abandoned', () => {
    expect(pveRescues()).toContainEqual({ chapter: pveChapter(0).id, objective: objectiveId, hero: 'scientist' });
    const progress = { ...freshSectorZeroProgress(data), nextAttempt: 2 };
    const rescued = fly(start(), 'p1_1', station, pveCtx);
    const quit = kernel.applyAction(rescued, { id: 'quit', type: 'pve.abandon', playerId: 'p1', issuedAt: rescued.time, payload: {} }, pveCtx(rescued.time));
    if (!quit.ok) throw new Error(quit.code);
    expect(quit.state.match).toMatchObject({ status: 'ended', reason: 'pve-failed' });
    const settled = settleSectorZeroRun(progress, 1, quit.state, pveChapter(0), data);
    expect(settled.objectivesDone[pveChapter(0).id]).toContain(objectiveId);
    expect(settled.chaptersWon).toEqual([]);
    const { progress: squad, joined } = grantChapterHeroes(settled, [pveChapter(0).id], data, pveRescues());
    expect(joined).toEqual(['scientist']);
    // The next expedition can be led by the rescued scientist.
    const next = prepareSectorZeroRun(pveState(data), { ...squad, selectedHero: 'scientist' }, data);
    expect(scientists(next).map((h) => h.id)).toEqual(['sector-zero:hero']);
  });

  it('rejects an unknown or boss rescue hero in map content', () => {
    for (const id of ['missing', 'leviathan']) {
      const map = parseMatchMap(mapJson);
      map.sectors[station]!.recruitHero = id;
      expect(validateMatchMap(map, data)).toContain(`E_INVALID_RECRUIT_HERO:${station}`);
    }
  });
});
