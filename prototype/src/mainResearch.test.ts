import { describe, expect, it } from 'vitest';
import { newGame, networkSeats } from './matchSetup';
import { data } from './gameData';
import { order, advance, canOrder, traceHooks } from './protoKernel';
import { HOUR } from './time';
import { buildBuilding, buildUnit, researchTech, spawnHero } from '../../decisions/actions';
import { technologyLock, techInMatch, technologiesUnlocking } from '../../packages/shared-core/src/index';
import { TECH_BRANCHES, techTreeHtml } from './techTree';
import { aiOrders } from './ai';
import type { MapId } from './mapCatalog';

const fresh = (id: MapId = 'duel-1') => newGame({ mapId: id, seats: networkSeats('ffa', id) });
const rich = () => {
  const s = fresh();
  s.players.p1!.resources = { credits: 10000, metal: 10000, microelectronics: 1000, food: 1000, energy: 1000 };
  return s;
};

describe('main-game research progression', () => {
  it.each(['duel-1', 'ffa-4'] as const)('%s starts every seat with only the scout researched and deployed', (id) => {
    const s = fresh(id);
    expect(s.techRules?.ruleset).toBe('main');
    for (const p of Object.values(s.players)) {
      expect(p.technologies?.completed).toEqual(['scout_design']);
      expect(Object.values(s.fleets).filter((f) => f.owner === p.id).flatMap((f) => f.units))
        .toEqual([{ unit: 'scout', count: 1 }]);
    }
    expect(Object.values(s.heroes ?? {}).some((h) => h.alive)).toBe(false);
    expect(Object.values(s.planets).filter((p) => p.owner).every((p) => p.garrison.length > 0)).toBe(true);
    expect(JSON.parse(JSON.stringify(s)).techRules).toEqual(s.techRules);
  });

  it('has 48 nodes, six branches, valid unlock references and no prerequisite cycles', () => {
    const s = fresh();
    const ids = Object.keys(data.technologies).filter((id) => !data.technologies[id]!.grantOnly && techInMatch(s, id, data));
    expect(ids).toHaveLength(48);
    expect(new Set(ids.map((id) => data.technologies[id]!.branch)).size).toBe(6);
    const visit = (id: string, chain: string[] = []) => {
      expect(chain, id).not.toContain(id);
      const def = data.technologies[id]!;
      expect(def).toBeDefined();
      for (const parent of def.prerequisites) {
        expect(ids).toContain(parent);
        visit(parent, [...chain, id]);
      }
      for (const unit of def.unlocks.units ?? []) expect(data.units[unit], unit).toBeDefined();
      for (const building of def.unlocks.buildings ?? []) expect(data.buildings[building], building).toBeDefined();
    };
    ids.forEach((id) => visit(id));
    const html = TECH_BRANCHES.map((b) => techTreeHtml(s, 'p1', b.key, null)).join('');
    for (const id of ids.filter((id) => id !== 'scout_design')) expect(html).toContain(`data-tech="${id}"`);
  });

  it('gates every ordinary human unit independently in the authoritative construction hook', () => {
    const s = fresh();
    const units = Object.entries(data.units).filter(([, u]) =>
      !['swarm', 'pirates', 'neutral'].includes(u.faction) && !u.traits.includes('issued'));
    for (const [id] of units) {
      const locks = technologiesUnlocking(data, 'unit', id, s);
      expect(locks, id).toHaveLength(1);
      expect(data.technologies[locks[0]!]!.unlocks.units, id).toEqual([id]);
      const trace = traceHooks(s, [{ name: 'construction.requirement', base: { allowed: true }, args: { playerId: 'p1', kind: 'unit', id } }]);
      expect(trace?.[0]?.value, id).toEqual(id === 'scout' ? { allowed: true } : { allowed: false, code: 'E_TECH_LOCKED' });
    }
  });

  it('can afford both first military researches and then construct the unlocked ship', () => {
    let s = fresh();
    expect(canOrder(s, buildUnit('p1', 'home_1', 'frigate'))).toBe('E_TECH_LOCKED');
    for (const tech of ['frigate_design', 'militia_training']) {
      const r = order(s, researchTech('p1', tech), s.time);
      expect(r.error).toBeUndefined(); s = r.state;
    }
    expect(s.players.p1!.technologies!.active).toHaveLength(2);
    s = advance(s, 2 * HOUR).state;
    expect(canOrder(s, buildUnit('p1', 'home_1', 'frigate'))).toBeNull();
    expect(canOrder(s, buildUnit('p1', 'home_1', 'cruiser'))).toBe('E_TECH_LOCKED');
  });

  it('keeps basic infrastructure open and unlocks special buildings by research', () => {
    let s = rich();
    expect(canOrder(s, buildBuilding('p1', 'home_1', 'barracks'))).toBeNull();
    expect(canOrder(s, buildBuilding('p1', 'home_1', 'spaceport'))).toBe('E_TECH_LOCKED');
    const r = order(s, researchTech('p1', 'spaceport_infrastructure'), s.time);
    expect(r.error).toBeUndefined(); s = advance(r.state, 3 * HOUR).state;
    expect(canOrder(s, buildBuilding('p1', 'home_1', 'spaceport'))).toBeNull();
  });

  it('cannot bypass the opening through a free hero deployment', () => {
    const s = rich(); const id = Object.values(s.heroes!).find((h) => h.owner === 'p1')!.id;
    const action = spawnHero('p1', id, 'home_1');
    expect(canOrder(s, action)).toBe('E_TECH_LOCKED');
    s.players.p1!.technologies!.completed.push('signal_corps', 'flagship_command');
    expect(canOrder({ ...s }, action)).toBeNull();
  });

  it('keeps the additional gates out of legacy/campaign research', () => {
    const s = newGame();
    expect(technologyLock(data.technologies.frigate_design!, s, 'p1', data, 'frigate_design')).toBe('E_NOT_IN_MATCH');
    expect(technologiesUnlocking(data, 'unit', 'frigate', s)).toEqual([]);
    expect(techTreeHtml(s, 'p1', 'space', null)).not.toContain('data-tech="frigate_design"');
    expect(canOrder(s, buildUnit('p1', 'A', 'frigate'))).not.toBe('E_TECH_LOCKED');
  });

  it.each(['weak', 'strong'] as const)('%s AI researches its opening instead of remaining scout-only', (profile) => {
    let s = fresh();
    s.players.p2!.ai = true;
    let research = 0;
    for (let hour = 0; hour <= 16; hour += 2) {
      s = advance(s, hour * HOUR).state;
      for (const a of aiOrders(s, 'p2', 'expand', profile)) {
        const result = order(s, a, s.time);
        expect(result.error, a.type).not.toBe('E_TECH_LOCKED');
        if (!result.error && a.type === 'technology.research') research++;
        s = result.state;
      }
    }
    expect(research).toBeGreaterThan(0);
    expect(s.players.p2!.technologies!.completed).toContain('militia_training');
    expect(s.players.p2!.technologies!.completed).toContain('frigate_design');
  });
});
