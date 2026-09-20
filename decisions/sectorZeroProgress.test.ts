import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { pveState, pveModeId } from '../packages/client/src/gameData';
import { effectiveStats } from '../packages/shared-core/src/index';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  parseSectorZeroProgress,
  prepareSectorZeroRun,
  settleSectorZeroRun,
  sectorHeroSlots,
  type SectorZeroProgress,
  type SectorProgressAction,
} from './sectorZeroProgress';
import { parseRunSave, serializeRunSave, RUN_SAVE_VERSION } from './runSave';

const data = shippedGameData();
const fresh = () => freshSectorZeroProgress(data);
function change(p: SectorZeroProgress, action: SectorProgressAction): SectorZeroProgress {
  const result = changeSectorZeroProgress(p, action, data);
  expect(result).not.toBeNull();
  return result!;
}

describe('Sector Zero persistent preparation', () => {
  it('can fit a real starter module without spending or borrowing PvP progress', () => {
    const p = fresh();
    const fitted = change(p, { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    expect(fitted.loadouts.cruiser).toEqual(['ion_engine']);
    expect(fitted.research).toBe(0);
    expect(p.loadouts).toEqual({});
    expect(
      changeSectorZeroProgress(p, { kind: 'unlock-module', id: 'shield_booster' }, data),
    ).toBeNull();
  });

  it('respects ownership, hull restrictions, slot capacity and unequipping', () => {
    let p = { ...fresh(), research: 20 };
    p = change(p, { kind: 'unlock-module', id: 'radar_module' });
    expect(
      changeSectorZeroProgress(p, { kind: 'fit', hull: 'cruiser', id: 'radar_module' }, data),
    ).toBeNull();
    p = change(p, { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    expect(
      changeSectorZeroProgress(p, { kind: 'fit', hull: 'cruiser', id: 'cargo_bay' }, data),
    ).toBeNull();
    p = change(p, { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    p = change(p, { kind: 'fit', hull: 'cruiser', id: 'cargo_bay' });
    expect(p.loadouts.cruiser).toEqual(['cargo_bay']);
  });

  it('persists a hero upgrade and skill chain, rejecting wrong branches and missing prerequisites', () => {
    let p = { ...fresh(), research: 40 };
    expect(
      changeSectorZeroProgress(
        p,
        { kind: 'skill', hero: 'commander', id: 'corridor_sustained' },
        data,
      ),
    ).toBeNull();
    expect(
      changeSectorZeroProgress(
        p,
        { kind: 'skill', hero: 'commander', id: 'void_attunement' },
        data,
      ),
    ).toBeNull();
    p = change(p, { kind: 'upgrade-hero', id: 'commander' });
    p = change(p, { kind: 'skill', hero: 'commander', id: 'neural_lace' });
    p = change(p, { kind: 'skill', hero: 'commander', id: 'overclocked_helm' });
    p = change(p, { kind: 'skill', hero: 'commander', id: 'corridor_sustained' });
    p = change(p, { kind: 'ability', hero: 'commander', id: 'corridor' });
    const roundtrip = parseSectorZeroProgress(JSON.stringify(p), data);
    expect(roundtrip).toEqual(p);
    expect(sectorHeroSlots(roundtrip.heroes.commander!, data)).toBe(2);
    expect(
      changeSectorZeroProgress(p, { kind: 'ability', hero: 'commander', id: 'scan' }, data),
    ).toBeNull();
    expect(
      changeSectorZeroProgress(
        p,
        { kind: 'skill', hero: 'commander', id: 'overclocked_helm' },
        data,
      ),
    ).toBeNull();
  });

  it('chooses another acquired hero and carries their own skills into the real map', () => {
    let p = { ...fresh(), research: 30 };
    p = change(p, { kind: 'unlock-hero', id: 'warden' });
    p = change(p, { kind: 'select-hero', id: 'warden' });
    p = change(p, { kind: 'skill', hero: 'warden', id: 'void_attunement' });
    const s = prepareSectorZeroRun(pveState(data), p, data);
    const own = Object.values(s.heroes ?? {}).filter((h) => h.owner === 'p1');
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      archetype: 'warden',
      skills: ['void_attunement'],
      passives: ['rally_beacon'],
      equipped: ['bulwark'],
      alive: true,
    });
    expect(s.fleets[own[0]!.fleetId!]?.owner).toBe('p1');
  });

  it('applies ship sets to the next attempt only, without altering the Swarm or an existing save', () => {
    const base = pveState(data);
    const p = change(fresh(), { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    const s = prepareSectorZeroRun(base, p, data);
    const cruiser = s.fleets.p1_1!.units.find((u) => u.unit === 'cruiser')!;
    expect(effectiveStats(data.units.cruiser!, cruiser, data).speed).toBeGreaterThan(
      data.units.cruiser!.stats.speed,
    );
    expect(base.fleets.p1_1!.units.find((u) => u.unit === 'cruiser')!.modules).toBeUndefined();
    expect(s.fleets.p3_1).toEqual(base.fleets.p3_1);
    const save = serializeRunSave({
      v: RUN_SAVE_VERSION,
      mode: pveModeId()!,
      difficulty: 'strong',
      state: s,
      sectorZeroAttempt: 1,
      shipLoadouts: p.loadouts,
    });
    const later = change(p, { kind: 'fit', hull: 'cruiser', id: 'ion_engine' });
    expect(later.loadouts.cruiser).toEqual([]);
    expect(parseRunSave(save)).toMatchObject({
      difficulty: 'strong',
      sectorZeroAttempt: 1,
      shipLoadouts: { cruiser: ['ion_engine'] },
    });
  });

  it('rewards a terminal loss once, survives reload, and does not reward a menu exit', () => {
    const p = { ...fresh(), nextAttempt: 2 };
    const s = pveState(data);
    expect(settleSectorZeroRun(p, 1, s)).toBe(p);
    s.pve = { waveNumber: 4, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    s.match.winner = 'p3';
    const settled = settleSectorZeroRun(p, 1, s);
    expect(settled.research).toBe(5);
    const loaded = parseSectorZeroProgress(JSON.stringify(settled), data);
    expect(settleSectorZeroRun(loaded, 1, s)).toBe(loaded);
    s.match.winner = 'p1';
    expect(settleSectorZeroRun(p, 1, s).research).toBeGreaterThan(settled.research);
  });

  it('does not confuse two different attempts ending at the same game time', () => {
    const s = pveState(data);
    s.pve = { waveNumber: 2, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    s.match.winner = 'p3';
    const first = settleSectorZeroRun({ ...fresh(), nextAttempt: 2 }, 1, s);
    const second = settleSectorZeroRun({ ...first, nextAttempt: 3 }, 2, s);
    expect(second.research).toBe(first.research * 2);
  });

  it('repairs invalid progress without granting unknown skills or impossible sets', () => {
    expect(parseSectorZeroProgress('{broken', data)).toEqual(fresh());
    const p = parseSectorZeroProgress(
      JSON.stringify({
        ...fresh(),
        research: -100,
        selectedHero: 'ghost',
        heroes: {
          commander: {
            level: 100,
            skills: ['corridor_open', 'ghost'],
            equipped: ['ghost', 'rally', 'rally'],
          },
        },
        loadouts: { cruiser: ['ion_engine', 'ion_engine', 'cargo_bay', 'ghost'] },
      }),
      data,
    );
    expect(p.research).toBe(0);
    expect(p.heroes.commander).toEqual({ level: 3, skills: [], equipped: ['rally'] });
    expect(p.loadouts.cruiser).toEqual(['ion_engine']);
  });
});
