import { describe, expect, it } from 'vitest';
import { newGame, networkSeats } from './matchSetup';
import { data } from './gameData';
import { order, advance } from './protoKernel';
import { act, spawnHero, installHeroModule } from '../../decisions/actions';
import { heroFlagshipUnit } from '../../packages/shared-core/src/state/heroFlagship';

function ready() {
  const s = newGame({ mapId: 'duel-1', seats: networkSeats('ffa', 'duel-1') });
  s.players.p1!.technologies!.completed = Object.keys(data.technologies);
  s.players.p1!.arsenal = { hulls: ['frigate', 'heavy_cruiser'], modules: ['ion_engine'] };
  const hero = Object.values(s.heroes!).find((h) => h.owner === 'p1')!;
  hero.modules = [];
  return { s, hero };
}
describe('authoritative flagship selection', () => {
  it('keeps the archetype hull in old saves and deploys the selected hull after restore', () => {
    const { s, hero } = ready();
    expect(heroFlagshipUnit(hero, data)).toBe('hero');
    const fit = order(
      s,
      act('p1', 'hero.flagship', { heroId: hero.id, unit: 'frigate', modules: [] }),
      s.time,
    );
    expect(fit.error).toBeUndefined();
    expect(hero.flagship).toBeUndefined();
    const pending = order(
      JSON.parse(JSON.stringify(fit.state)),
      spawnHero('p1', hero.id, 'home_1'),
      s.time,
    );
    expect(pending.error).toBeUndefined();
    const done = advance(
      pending.state,
      pending.state.heroes![hero.id]!.mobilization!.readyAt,
    ).state;
    const fleetId = done.heroes![hero.id]!.fleetId!;
    expect(done.fleets[fleetId]!.units[0]!.unit).toBe('frigate');
    // A regular-looking flagship is still bound to its hero, and cannot be split away.
    done.fleets[fleetId]!.units.push({ unit: 'cruiser', count: 1 });
    expect(
      order(
        done,
        act('p1', 'fleet.split', { fleetId, take: [{ unit: 'frigate', count: 1 }] }),
        done.time,
      ).error,
    ).toBe('E_HERO_UNIT');
  });
  it.each([undefined, []])('splits ordinary escorts while keeping the flagship (%j)', (modules) => {
    const { s, hero } = ready();
    hero.flagship = 'frigate';
    const pending = order(s, spawnHero('p1', hero.id, 'home_1'), s.time).state;
    const deployed = advance(pending, pending.heroes![hero.id]!.mobilization!.readyAt).state;
    const fleetId = deployed.heroes![hero.id]!.fleetId!;
    deployed.fleets[fleetId]!.units.push({ unit: 'frigate', count: 2 });
    const split = (count: number) => order(deployed, act('p1', 'fleet.split', {
      fleetId, take: [{ unit: 'frigate', count, ...(modules ? { modules } : {}) }],
    }), deployed.time);
    for (const count of [1, 2]) {
      const result = split(count);
      expect(result.error).toBeUndefined();
      expect(result.state.fleets[fleetId]!.units.find(st => st.heroId === hero.id)?.count).toBe(1);
      expect(result.state.heroes![hero.id]!.fleetId).toBe(fleetId);
      const detached = Object.values(result.state.fleets).find(f => !deployed.fleets[f.id])!;
      expect(detached.units.reduce((sum, st) => sum + st.count, 0)).toBe(count);
      expect(detached.units.every(st => !st.heroId)).toBe(true);
    }
    expect(split(3).error).toBe('E_HERO_UNIT');
    const overlap = order(deployed, act('p1', 'fleet.split', { fleetId, take: [
      { unit: 'frigate', count: 2 }, { unit: 'frigate', count: 1, modules: [] },
    ] }), deployed.time);
    expect(overlap.error).toBeTruthy();
    expect(overlap.state).toEqual(deployed);
  });
  it('rechecks the selected hull technology before automatic respawn', () => {
    const { s, hero } = ready();
    s.players.p1!.technologies!.completed = [];
    hero.alive = false;
    hero.home = 'home_1';
    const selected = order(s, act('p1', 'hero.flagship', {
      heroId: hero.id, unit: 'heavy_cruiser', modules: [],
    }), s.time);
    expect(selected.error).toBeUndefined();
    expect(order(selected.state, spawnHero('p1', hero.id, 'home_1'), s.time).error).toBe('E_TECH_LOCKED');
    selected.state.scheduled.push({ id: 'test-respawn', at: s.time + 1, seq: selected.state.scheduleSeq++, type: 'hero.respawn', payload: { heroId: hero.id } });
    const blocked = advance(selected.state, s.time + 1).state;
    expect(blocked.heroes![hero.id]!.alive).toBe(false);
    expect(blocked.heroes![hero.id]!.fleetId).toBeUndefined();
    selected.state.players.p1!.technologies!.completed = Object.keys(data.technologies);
    const allowed = advance(selected.state, s.time + 1).state;
    expect(allowed.heroes![hero.id]!.alive).toBe(true);
    expect(allowed.fleets[allowed.heroes![hero.id]!.fleetId!]!.units[0]!.unit).toBe('heavy_cruiser');
  });
  it('rejects foreign hero, unowned hull, troop hull and injected fittings', () => {
    const { s, hero } = ready();
    const change = (playerId: string, unit: string, modules: string[] = []) =>
      order(s, act(playerId, 'hero.flagship', { heroId: hero.id, unit, modules }), s.time);
    expect(change('p2', 'frigate').error).toBe('E_FORBIDDEN');
    expect(change('p1', 'cruiser').error).toBe('E_NOT_OWNED');
    expect(change('p1', 'militia').error).toBe('E_NOT_OWNED');
    expect(change('p1', 'frigate', ['ion_engine']).error).toBe('E_NOT_OWNED');
  });
  it('locks hull and hardware while mobilizing', () => {
    const { s, hero } = ready();
    const pending = order(s, spawnHero('p1', hero.id, 'home_1'), s.time).state;
    expect(
      order(
        pending,
        act('p1', 'hero.flagship', { heroId: hero.id, unit: 'frigate', modules: [] }),
        s.time,
      ).error,
    ).toBe('E_HERO_MOBILIZING');
    expect(order(pending, installHeroModule('p1', hero.id, 'ion_engine'), s.time).error).toBe(
      'E_HERO_MOBILIZING',
    );
  });
});

it('keeps identical escort stacks separate and does not mistake an escort loss for a hero death', async () => {
  const { createKernel, heroModule } = await import('../../packages/shared-core/src/index');
  const { mergeStacks } = await import('../../packages/shared-core/src/util/stacks');
  const { applyDamage } = await import('../../packages/shared-core/src/util/combat');
  const { s, hero } = ready();
  const selected = order(
    s,
    act('p1', 'hero.flagship', { heroId: hero.id, unit: 'frigate', modules: [] }),
    s.time,
  ).state;
  const queued = order(selected, spawnHero('p1', hero.id, 'home_1'), s.time).state;
  const deployed = advance(queued, queued.heroes![hero.id]!.mobilization!.readyAt).state;
  const fleetId = deployed.heroes![hero.id]!.fleetId!;
  const fleet = deployed.fleets[fleetId]!;
  fleet.units = mergeStacks(fleet.units, [{ unit: 'frigate', count: 1 }]);
  expect(fleet.units).toHaveLength(2);
  fleet.units[1]!.hp = 0.001;
  const kernel = createKernel([
    heroModule,
    {
      id: 'damage-test',
      version: '1',
      setup(api) {
        api.onAction('test.damage', (a, h) => {
          const f = h.state.fleets[fleetId]!;
          f.units = applyDamage(h, f.units, (a.payload as { amount: number }).amount, data, {
            fleetId,
            owner: 'p1',
          });
        });
      },
    },
  ]);
  const escortLost = kernel.applyAction(deployed, act('p1', 'test.damage', { amount: 1 }), {
    now: deployed.time,
    data,
  });
  expect(escortLost.ok).toBe(true);
  if (!escortLost.ok) return;
  expect(escortLost.state.heroes![hero.id]!.alive).toBe(true);
  expect(escortLost.state.fleets[fleetId]!.units).toHaveLength(1);
  const flagshipLost = kernel.applyAction(
    escortLost.state,
    act('p1', 'test.damage', { amount: 100000 }),
    { now: deployed.time, data },
  );
  expect(flagshipLost.ok).toBe(true);
  if (!flagshipLost.ok) return;
  expect(flagshipLost.state.heroes![hero.id]!.alive).toBe(false);
});
