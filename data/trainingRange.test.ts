/**
 * УЧЕБНЫЙ ПОЛИГОН «Протокол допуска» — карта и дверь к ней.
 *
 * Дизайн — `docs/sector-zero-map-concepts.md` §14 (обсуждение с владельцем 2026-09-25).
 * Соседство выводится из мозаики, поэтому требования §14.3 к географии — два подхода к цели
 * с поперечной связью, станция маяка с нейтральной стороны — проверяются здесь числами:
 * любая правка координат может молча поменять карту.
 */
import { describe, expect, it } from 'vitest';
import { matchMapEdges, parseMatchMap, validateMatchMap, type MatchMap } from '../packages/shared-core/src/index';
import {
  PVE_MISSION_COUNT,
  pveMissionOfMap,
  trainingModeId,
  trainingObjectives,
  trainingState,
} from '../packages/client/src/gameData';
import { shippedGameData } from './bundle';
import mapJson from './maps/training-1.json';

const data = shippedGameData();
const map: MatchMap = parseMatchMap(mapJson);
const edges = matchMapEdges(map, data).paths;
const linked = (a: string, b: string): boolean =>
  edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
const neighbours = (id: string): string[] =>
  edges.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : [])).sort();

/** Есть ли путь по дорогам, минуя `banned`. */
function reachable(from: string, to: string, banned: ReadonlySet<string> = new Set()): boolean {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) return true;
    for (const next of neighbours(cur))
      if (!seen.has(next) && !banned.has(next)) {
        seen.add(next);
        queue.push(next);
      }
  }
  return false;
}

describe('учебный полигон — карта (§14.3)', () => {
  it('проходит валидатор на шипнутом каталоге, соседство из мозаики', () => {
    expect(validateMatchMap(map, data)).toEqual([]);
    expect(matchMapEdges(map, data).derived).toBe(true);
  });

  it('семь провинций, и каждая — место, а не пустая клетка (M2.10)', () => {
    expect(Object.keys(map.sectors)).toHaveLength(7);
    expect(Object.values(map.sectors).map((s) => s.kind)).not.toContain('empty');
  });

  it('два подхода к цели: короткий через пост, обход через нейтральную планету и астероиды', () => {
    expect(linked('base', 'open_reach') && linked('open_reach', 'outpost') && linked('outpost', 'target')).toBe(true);
    expect(linked('base', 'neutral') && linked('neutral', 'asteroid_pass') && linked('asteroid_pass', 'target')).toBe(true);
    // Каждый подход самостоятелен: закрыт любой — цель достижима другим.
    expect(reachable('base', 'target', new Set(['outpost']))).toBe(true);
    expect(reachable('base', 'target', new Set(['asteroid_pass']))).toBe(true);
    // Поперечная связь открытого участка с астероидным.
    expect(linked('open_reach', 'asteroid_pass')).toBe(true);
  });

  it('станция маяка — с нейтральной стороны, не у базы и не на основной цепочке', () => {
    expect(neighbours('station')).not.toContain('base');
    expect(neighbours('station')).toContain('neutral');
    expect(neighbours('station')).not.toContain('outpost');
    expect(neighbours('station')).not.toContain('target');
  });

  it('штурм идёт против настоящего гарнизона с орбитальной обороной (§14.4)', () => {
    const target = map.sectors.target!;
    expect(target.owner).toBe('p2');
    expect((target.garrison ?? []).reduce((n, g) => n + g.count, 0)).toBeGreaterThan(0);
    expect((target.buildings ?? []).map((b) => b.type)).toContain('orbital_aa');
  });
});

describe('учебный полигон — противник и Рой (§14.2, §14.6)', () => {
  const state = trainingState(data);

  it('противник — человеческие силы: ни фракции, ни юнитов, ни построек Роя', () => {
    expect(Object.values(state.players).map((p) => p.faction)).not.toContain('swarm');
    const swarmUnits = new Set(data.factions.swarm?.uniqueUnits ?? []);
    for (const f of Object.values(state.fleets))
      for (const u of f.units) expect(swarmUnits.has(u.unit), u.unit).toBe(false);
    for (const p of Object.values(state.planets))
      for (const b of p.buildings) expect(b.type.startsWith('swarm'), b.type).toBe(false);
  });

  it('режим без волн PvE — мир не заводит секцию забега, досье Роя не на чем стоять', () => {
    const mode = trainingModeId();
    expect(mode).toBe('training');
    expect(data.modes[mode!]?.pve).toBeUndefined();
    expect(state.pve).toBeUndefined();
  });
});

describe('учебный полигон — не глава (§14.1)', () => {
  it('не входит в главы: ни одна глава не играется на его карте', () => {
    expect(pveMissionOfMap(map.id)).toBeNull();
    expect(PVE_MISSION_COUNT).toBeGreaterThan(0);
  });
});

describe('учебный полигон — задания экспедиции (§14.5)', () => {
  const objectives = trainingObjectives();

  it('ровно две: маяк на станции (control) и разведка всей карты (scout)', () => {
    expect(objectives.map((o) => [o.kind, o.id])).toEqual([
      ['control', 'mission.training-beacon'],
      ['scout', 'mission.training-recon'],
    ]);
    expect(objectives[0]!.targets).toEqual(['station']);
  });

  it('порог разведки равен фактическому размеру карты', () => {
    expect(objectives[1]!.count).toBe(Object.keys(map.sectors).length);
  });
});
