import { describe, expect, it } from 'vitest';
import { createInitialState } from '../packages/shared-core/src/index';
import { parseSoloSave, serializeSoloSave, type SoloSave } from './soloSave';
import {
  CORP_FORMATS_SOLO_MIGRATION as corpFormats,
  COMMANDER_CAREER_SOLO_MIGRATION as career,
  MINING_SOLO_MIGRATION as migration,
  RECON_HALT_SOLO_MIGRATION as reconHalt,
  SPY_PRICES_SOLO_MIGRATION as spyPrices,
  SPY_DELAY_SOLO_MIGRATION as spyDelay,
  RECON_LAYERS_SOLO_MIGRATION as reconLayers,
  SPY_DISRUPT_SOLO_MIGRATION as spyDisrupt,
  SPY_EXPOSED_SOLO_MIGRATION as spyExposed,
  SPY_CREW_SOLO_MIGRATION as spyCrew,
  SPY_TURN_SOLO_MIGRATION as spyTurn,
  LANDING_CANCEL_SOLO_MIGRATION as landingCancel,
  SLOW_AVIATION_SOLO_MIGRATION as slowAviation,
  RESEARCH_QUEUE_SOLO_MIGRATION as researchQueue,
  HOSPITAL_WOUNDS_SOLO_MIGRATION as hospitalWounds,
  PRODUCTION_LANES_SOLO_MIGRATION as productionLanes,
  WOUNDED_TRANSPORT_SOLO_MIGRATION as woundedTransport,
  STAND_UP_SOLO_MIGRATION as standUp,
  BOMBARD_VOLLEY_SOLO_MIGRATION as bombardVolley,
  HALF_MODULES_SOLO_MIGRATION as halfModules,
  FORTRESS_MODEL_SOLO_MIGRATION as fortressModel,
  LOAD_FIRST_SOLO_MIGRATION as loadFirst,
  HERO_MOBILIZATION_SOLO_MIGRATION as heroMobilization,
  ECHELONS_SOLO_MIGRATION as echelons,
  MODULE_PROGRESSION_SOLO_MIGRATION as moduleProgression,
  ARMY_SELECTION_SOLO_MIGRATION as armySelection,
  CAPITAL_VICTORY_SOLO_MIGRATION as capitalVictory,
  SPY_DEVELOPMENT_SOLO_MIGRATION as spyDevelopment,
  INTERCEPT_TURRET_SOLO_MIGRATION as interceptTurret,
  CLOAK_FIELD_SOLO_MIGRATION as cloakField,
  STAR_LADDER_SOLO_MIGRATION as starLadder,
  COMBAT_CONTINUITY_SOLO_MIGRATION as combatContinuity,
  SPY_NO_WAR_SOLO_MIGRATION as spyNoWar,
  CONTROL_LIMIT_SOLO_MIGRATION as controlLimit,
  CONTROL_RECHECK_SOLO_MIGRATION as controlRecheck,
  INTEGRATION_SOLO_MIGRATION as integration,
  RAMP_SETTLEMENT_SOLO_MIGRATION as rampSettlement,
  CONTROL_TECH_SOLO_MIGRATION as controlTech,
  VICEROY_SOLO_MIGRATION as viceroy,
  TECHNOLOGY_PRICES_SOLO_MIGRATION as technologyPrices,
  FLEET_MERGE_ORDERS_SOLO_MIGRATION as fleetMergeOrders,
  FORTRESS_PRICE_SOLO_MIGRATION as fortressPrice,
  LONG_RANGE_OPTICS_SOLO_MIGRATION as longRangeOptics,
  PRODUCTION_WORKBENCH_SOLO_MIGRATION as productionWorkbench,
  BUILD_PRODUCTION_TIMES_SOLO_MIGRATION as buildProductionTimes,
  PACE_RELIEF_SOLO_MIGRATION as paceRelief,
  FLEET_CLOCKS_SOLO_MIGRATION as fleetClocks,
  MISSILES_SOLO_MIGRATION as missiles,
  ANNIHILATE_PEACE_SOLO_MIGRATION as annihilatePeace,
  PAUSED_SLOTS_SOLO_MIGRATION as pausedSlots,
  SOLO_MIGRATIONS,
  parseCompatibleSoloSave,
} from './soloSaveMigration';

function oldSave(): SoloSave {
  const state = createInitialState({
    seed: 'mining-migration',
    time: 123,
    version: { data: migration.fromData, dataHash: migration.fromDataHash, manifest: '1' },
  });
  state.mapId = 'duel-1';
  state.players.p1 = {
    id: 'p1',
    name: 'One',
    faction: 'azure',
    status: 'active',
    resources: { metal: 123, credits: 456 },
  };
  state.pricing = { cost: { metal: 1.5, credits: 3 }, hours: 2 };
  state.planets.A = {
    id: 'A',
    owner: 'p1',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [
      { uid: 'saved:1', type: 'mine_t1', level: 1, hp: 15 },
      { uid: 'saved:2', type: 'mine_t2', level: 1, hp: 25 },
      { uid: 'saved:3', type: 'mine', level: 2, hp: 26 },
    ],
    garrison: [],
    traits: [],
    buildQueue: [{ id: 3, playerId: 'p1', kind: 'building', building: 'mine_t2' }],
    pausedConstruction: [
      {
        id: 4,
        kind: 'building',
        playerId: 'p1',
        building: 'mine_t1',
        progress: 0.5,
        remainingHours: 3,
        remainingCost: { metal: 50 },
      },
    ],
  };
  state.scheduled = [
    {
      id: 'saved-completion',
      seq: 2,
      type: 'construction.complete',
      at: 3600000,
      payload: { kind: 'building', planetId: 'A', playerId: 'p1', building: 'mine_t1' },
    },
  ];
  state.scheduleSeq = 5;
  return { state, ai: [], normalSpeed: 1, fastSpeed: 24, autoAssault: [], memory: [] };
}

it('the merge-orders patch preserves saved cargo, enabled modes and the pending volley', () => {
  const before = oldSave();
  before.state.version = { data: fleetMergeOrders.fromData,
    dataHash: fleetMergeOrders.fromDataHash, manifest: '1' };
  before.state.fleets.F = { id: 'F', owner: 'p1', location: 'A', movement: null,
    units: [{ unit: 'frigate', count: 3 }], landing: [{ unit: 'militia', count: 5 }],
    traits: [], orbit: 'near', bombarding: true, bombardNextAt: 3_600_000 };
  before.state.autoAssault = { F: true };
  const raw = serializeSoloSave(before, fleetMergeOrders.fromRules);
  expect(parseCompatibleSoloSave(raw, fleetMergeOrders.toRules)).toEqual(before);
});

it('the fleet-clocks patch preserves saved fleets and their timers', () => {
  const before = oldSave();
  before.state.version = { data: fleetClocks.fromData, dataHash: fleetClocks.fromDataHash, manifest: '1' };
  before.state.fleets.F = { id: 'F', owner: 'p1', location: 'A', movement: null,
    units: [{ unit: 'frigate', count: 3, shieldHp: 10 }], landing: [], traits: [], orbit: 'near',
    bombarding: true, bombardNextAt: 3_600_000, lastDamagedAt: 100, pdCooldownUntil: 200 };
  const raw = serializeSoloSave(before, fleetClocks.fromRules);
  expect(parseCompatibleSoloSave(raw, fleetClocks.toRules)).toEqual(before);
});

it('the annihilate-peace patch preserves a saved world unchanged', () => {
  const before = oldSave();
  before.state.version = { data: annihilatePeace.fromData, dataHash: annihilatePeace.fromDataHash, manifest: '1' };
  const raw = serializeSoloSave(before, annihilatePeace.fromRules);
  expect(parseCompatibleSoloSave(raw, annihilatePeace.toRules)).toEqual(before);
});

describe('explicit 0.1.66 mining save migration', () => {
  it('preserves the entire old world except its explicitly upgraded version pin', () => {
    const before = oldSave();
    const raw = serializeSoloSave(before, migration.fromRules);
    const result = parseCompatibleSoloSave(raw, migration.toRules);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      ...before,
      state: {
        ...before.state,
        version: { data: migration.toData, dataHash: migration.toDataHash, manifest: '1' },
      },
    });
    expect(parseSoloSave(raw, migration.toRules)).toBeNull(); // strict parser is unchanged
    expect(parseSoloSave(raw, migration.fromRules)).toEqual(before); // original slot is intact
    expect(parseSoloSave(serializeSoloSave(result!, migration.toRules), migration.toRules)).toEqual(
      result,
    );
  });

  it.each(['nexus', 'frontier-50', 'frontier-100'])(
    'supports the old generated %s version only under the exact outer rules fingerprint',
    (mapId) => {
      const before = oldSave();
      before.state.mapId = mapId;
      before.state.version = { data: '0.1.0', manifest: '1' };
      expect(
        parseCompatibleSoloSave(serializeSoloSave(before, migration.fromRules), migration.toRules),
      ).not.toBeNull();
      before.state.mapId = 'duel-1';
      expect(
        parseCompatibleSoloSave(serializeSoloSave(before, migration.fromRules), migration.toRules),
      ).toBeNull();
    },
  );

  it('refuses unknown predecessors and future receivers', () => {
    const save = oldSave();
    expect(
      parseCompatibleSoloSave(serializeSoloSave(save, 'unknown'), migration.toRules),
    ).toBeNull();
    expect(
      parseCompatibleSoloSave(serializeSoloSave(save, migration.fromRules), 'future'),
    ).toBeNull();
  });

  it('keeps checksum and payload validation mandatory for the known predecessor', () => {
    const raw = serializeSoloSave(oldSave(), migration.fromRules);
    const changed = JSON.parse(raw) as { checksum: string; payload: SoloSave };
    changed.payload.state.players.p1!.resources.metal = 999999;
    expect(parseCompatibleSoloSave(JSON.stringify(changed), migration.toRules)).toBeNull();
    const invalid = oldSave();
    delete invalid.state.players.p1;
    expect(
      parseCompatibleSoloSave(serializeSoloSave(invalid, migration.fromRules), migration.toRules),
    ).toBeNull();
  });

  it.each([
    { data: '0.1.65', dataHash: migration.fromDataHash, manifest: '1' },
    { data: migration.fromData, dataHash: 'foreign-data', manifest: '1' },
    { data: migration.fromData, dataHash: migration.fromDataHash, manifest: 'other-modules' },
  ])('refuses inconsistent internal pins even with a valid checksum: %j', (version) => {
    const before = oldSave();
    before.state.version = version;
    expect(
      parseCompatibleSoloSave(serializeSoloSave(before, migration.fromRules), migration.toRules),
    ).toBeNull();
  });

  it('still reads an ordinary current save without migrating it', () => {
    const save = oldSave();
    save.state.version = { data: migration.toData, dataHash: migration.toDataHash, manifest: '1' };
    expect(
      parseCompatibleSoloSave(serializeSoloSave(save, migration.toRules), migration.toRules),
    ).toEqual(save);
  });
});

describe('the audited release chain (0.1.66 → 0.1.67 → 0.1.68)', () => {
  const at = (release: { data: string; dataHash?: string }): SoloSave => {
    const save = oldSave();
    save.state.version = { ...release, manifest: '1' };
    return save;
  };
  const shipped = { data: corpFormats.toData, dataHash: corpFormats.toDataHash, manifest: '1' };

  it('starts every pair where the one before it ends', () => {
    expect(SOLO_MIGRATIONS).toEqual([migration, corpFormats, career, reconHalt, spyPrices, spyDelay, reconLayers, spyDisrupt, spyExposed, spyCrew, spyTurn, landingCancel, slowAviation, researchQueue, hospitalWounds, productionLanes, woundedTransport, standUp, bombardVolley, halfModules, fortressModel, loadFirst, heroMobilization, echelons, moduleProgression, armySelection, capitalVictory, spyDevelopment, interceptTurret, cloakField, starLadder, combatContinuity, spyNoWar, controlLimit, controlRecheck, integration, rampSettlement, controlTech, viceroy, technologyPrices, fleetMergeOrders, fortressPrice, longRangeOptics, productionWorkbench, buildProductionTimes, paceRelief, fleetClocks, missiles, annihilatePeace, pausedSlots]);
    SOLO_MIGRATIONS.slice(1).forEach((pair, i) => {
      const before = SOLO_MIGRATIONS[i]!;
      expect([pair.fromRules, pair.fromData, pair.fromDataHash]).toEqual([
        before.toRules,
        before.toData,
        before.toDataHash,
      ]);
    });
  });

  it('reads a 0.1.67 save under 0.1.68 with only its version pin moved', () => {
    const before = at({ data: corpFormats.fromData, dataHash: corpFormats.fromDataHash });
    const raw = serializeSoloSave(before, corpFormats.fromRules);
    expect(parseCompatibleSoloSave(raw, corpFormats.toRules)).toEqual({
      ...before,
      state: { ...before.state, version: shipped },
    });
    expect(parseSoloSave(raw, corpFormats.fromRules)).toEqual(before); // original slot is intact
  });

  it('carries a 0.1.66 save through both pairs', () => {
    const before = oldSave();
    expect(
      parseCompatibleSoloSave(serializeSoloSave(before, migration.fromRules), corpFormats.toRules),
    ).toEqual({ ...before, state: { ...before.state, version: shipped } });
  });

  it('reads a 0.1.67 generated map, which pins only its outer rules', () => {
    const before = at({ data: '0.1.0' });
    before.state.mapId = 'nexus';
    expect(
      parseCompatibleSoloSave(serializeSoloSave(before, corpFormats.fromRules), corpFormats.toRules)
        ?.state.version,
    ).toEqual(shipped);
  });

  it('refuses a 0.1.67 envelope whose world names another catalogue', () => {
    for (const release of [
      { data: migration.fromData, dataHash: migration.fromDataHash },
      { data: corpFormats.fromData, dataHash: 'foreign-data' },
    ]) {
      const raw = serializeSoloSave(at(release), corpFormats.fromRules);
      expect(parseCompatibleSoloSave(raw, corpFormats.toRules)).toBeNull();
    }
  });
});

describe('commander power retirement save migration (0.1.68 → 0.1.69)', () => {
  const shipped = { data: career.toData, dataHash: career.toDataHash, manifest: '1' };

  it('keeps an existing world and accepted work while advancing its exact catalog pin', () => {
    const before = oldSave();
    before.state.version = { data: career.fromData, dataHash: career.fromDataHash, manifest: '1' };
    before.state.players.p1!.technologies = { completed: ['meta_drill_speed', 'signal_corps'] };
    before.state.players.p1!.scientists = [{ id: 'overseer', level: 2 }];
    const raw = serializeSoloSave(before, career.fromRules);
    const result = parseCompatibleSoloSave(raw, career.toRules);
    expect(result).toEqual({ ...before, state: { ...before.state, version: shipped } });
    expect(parseSoloSave(raw, career.fromRules)).toEqual(before);
    expect(parseSoloSave(serializeSoloSave(result!, career.toRules), career.toRules)).toEqual(
      result,
    );
  });

  it('carries an older save through all three audited pairs', () => {
    const before = oldSave();
    expect(
      parseCompatibleSoloSave(serializeSoloSave(before, migration.fromRules), career.toRules),
    ).toEqual({ ...before, state: { ...before.state, version: shipped } });
  });

  it('refuses a mismatched catalog hash even with the expected envelope fingerprint', () => {
    const before = oldSave();
    before.state.version = { data: career.fromData, dataHash: 'foreign-data', manifest: '1' };
    expect(
      parseCompatibleSoloSave(serializeSoloSave(before, career.fromRules), career.toRules),
    ).toBeNull();
  });
});

describe('the rules-only recon pair (0.1.69 → 0.1.69)', () => {
  it('reads a 0.1.69 save under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = {
      data: reconHalt.fromData,
      dataHash: reconHalt.fromDataHash,
      manifest: '1',
    };
    const raw = serializeSoloSave(before, reconHalt.fromRules);
    expect(parseCompatibleSoloSave(raw, reconHalt.toRules)).toEqual(before);
  });
});

describe('the rules-only spy prices pair (0.1.69 → 0.1.69)', () => {
  it('reads a save of the recon-halt release under the new prices unchanged', () => {
    const before = oldSave();
    before.state.version = {
      data: spyPrices.fromData,
      dataHash: spyPrices.fromDataHash,
      manifest: '1',
    };
    const raw = serializeSoloSave(before, spyPrices.fromRules);
    expect(parseCompatibleSoloSave(raw, spyPrices.toRules)).toEqual(before);
  });
});

describe('the rules-only queue sabotage pair (0.1.69 → 0.1.69)', () => {
  it('reads a save of the spy prices release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: spyDelay.fromData, dataHash: spyDelay.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, spyDelay.fromRules);
    expect(parseCompatibleSoloSave(raw, spyDelay.toRules)).toEqual(before);
  });
});

describe('the rules-only accumulating recon pair (0.1.69 → 0.1.69)', () => {
  it('reads a save of the queue sabotage release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: reconLayers.fromData, dataHash: reconLayers.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, reconLayers.fromRules);
    expect(parseCompatibleSoloSave(raw, reconLayers.toRules)).toEqual(before);
  });
});

describe('the rules-only economic sabotage pair (0.1.69 → 0.1.69)', () => {
  it('reads a save of the accumulating recon release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: spyDisrupt.fromData, dataHash: spyDisrupt.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, spyDisrupt.fromRules);
    expect(parseCompatibleSoloSave(raw, spyDisrupt.toRules)).toEqual(before);
  });
});

describe('the rules-only public exposure pair (0.1.69 → 0.1.69)', () => {
  it('reads a save of the economic sabotage release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: spyExposed.fromData, dataHash: spyExposed.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, spyExposed.fromRules);
    expect(parseCompatibleSoloSave(raw, spyExposed.toRules)).toEqual(before);
  });
});

describe('the rules-only agent wave pair (0.1.69 → 0.1.69)', () => {
  it('reads a save of the public exposure release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: spyCrew.fromData, dataHash: spyCrew.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, spyCrew.fromRules);
    expect(parseCompatibleSoloSave(raw, spyCrew.toRules)).toEqual(before);
  });
});

describe('turned agents save migration (0.1.69 → 0.1.70)', () => {
  const shipped = { data: spyTurn.toData, dataHash: spyTurn.toDataHash, manifest: '1' };

  it('reads a save of the agent wave release with only its catalogue pin moved', () => {
    const before = oldSave();
    before.state.version = { data: spyTurn.fromData, dataHash: spyTurn.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, spyTurn.fromRules);
    const result = parseCompatibleSoloSave(raw, spyTurn.toRules);
    expect(result).toEqual({ ...before, state: { ...before.state, version: shipped } });
    expect(parseSoloSave(raw, spyTurn.fromRules)).toEqual(before);
  });
});

describe('the rules-only landing cancel pair (0.1.70 → 0.1.70)', () => {
  it('reads a save of the turned agents release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: landingCancel.fromData, dataHash: landingCancel.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, landingCancel.fromRules);
    expect(parseCompatibleSoloSave(raw, landingCancel.toRules)).toEqual(before);
  });
});

describe('slower aviation save migration (0.1.70 → 0.1.71)', () => {
  const shipped = { data: slowAviation.toData, dataHash: slowAviation.toDataHash, manifest: '1' };

  it('reads a save of the landing cancel release with only its catalogue pin moved', () => {
    const before = oldSave();
    before.state.version = {
      data: slowAviation.fromData,
      dataHash: slowAviation.fromDataHash,
      manifest: '1',
    };
    const raw = serializeSoloSave(before, slowAviation.fromRules);
    const result = parseCompatibleSoloSave(raw, slowAviation.toRules);
    expect(result).toEqual({ ...before, state: { ...before.state, version: shipped } });
    expect(parseSoloSave(raw, slowAviation.fromRules)).toEqual(before);
  });
});

describe('the rules-only research queue pair (0.1.71 → 0.1.71)', () => {
  it('reads a save of the slower aviation release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: researchQueue.fromData, dataHash: researchQueue.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, researchQueue.fromRules);
    expect(parseCompatibleSoloSave(raw, researchQueue.toRules)).toEqual(before);
  });
});

describe('the rules-only hospital wounds pair (0.1.71 → 0.1.71)', () => {
  it('reads a save of the research queue release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: hospitalWounds.fromData, dataHash: hospitalWounds.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, hospitalWounds.fromRules);
    expect(parseCompatibleSoloSave(raw, hospitalWounds.toRules)).toEqual(before);
  });
});

describe('the rules-only production lanes pair (0.1.71 → 0.1.71)', () => {
  it('reads a save with a shared unit queue under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: productionLanes.fromData, dataHash: productionLanes.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, productionLanes.fromRules);
    expect(parseCompatibleSoloSave(raw, productionLanes.toRules)).toEqual(before);
  });
});

describe('the rules-only wounded transport pair (0.1.71 → 0.1.71)', () => {
  it('reads a save of the production lanes release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: woundedTransport.fromData, dataHash: woundedTransport.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, woundedTransport.fromRules);
    expect(parseCompatibleSoloSave(raw, woundedTransport.toRules)).toEqual(before);
  });
});

describe('the rules-only stand-up battle pair (0.1.71 → 0.1.71)', () => {
  it('reads a save of the wounded transport release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: standUp.fromData, dataHash: standUp.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, standUp.fromRules);
    expect(parseCompatibleSoloSave(raw, standUp.toRules)).toEqual(before);
  });
});

describe('the rules-only bombardment volley pair (0.1.71 → 0.1.71)', () => {
  it('reads a save of the stand-up battle release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: bombardVolley.fromData, dataHash: bombardVolley.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, bombardVolley.fromRules);
    expect(parseCompatibleSoloSave(raw, bombardVolley.toRules)).toEqual(before);
  });
});

describe('lighter ship modules save migration (0.1.71 → 0.1.72)', () => {
  const shipped = { data: halfModules.toData, dataHash: halfModules.toDataHash, manifest: '1' };

  it('reads a save of the bombardment volley release with only its catalogue pin moved', () => {
    const before = oldSave();
    before.state.version = {
      data: halfModules.fromData,
      dataHash: halfModules.fromDataHash,
      manifest: '1',
    };
    const raw = serializeSoloSave(before, halfModules.fromRules);
    const result = parseCompatibleSoloSave(raw, halfModules.toRules);
    expect(result).toEqual({ ...before, state: { ...before.state, version: shipped } });
    expect(parseSoloSave(raw, halfModules.fromRules)).toEqual(before);
  });
});

describe('separate fortress release compatibility', () => {
  it('preserves an old fortress, its paid orders, clock and RNG while advancing the audited catalogue pins', () => {
    const before = oldSave();
    before.state.planets.A!.kind = 'void_station';
    before.state.planets.A!.priorKind = 'asteroid';
    before.state.planets.A!.buildings.push({ type: 'starfort', level: 1, hp: 45 });
    before.state.version = { data: fortressModel.fromData, dataHash: fortressModel.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, fortressModel.fromRules);
    const restored = parseCompatibleSoloSave(raw, fortressModel.toRules);
    expect(restored).toEqual({ ...before, state: { ...before.state,
      version: { data: fortressModel.toData, dataHash: fortressModel.toDataHash, manifest: '1' },
    } });
  });
});

describe('the rules-only load-first pair (0.1.73 → 0.1.73)', () => {
  it('reads a save of the fortress release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: loadFirst.fromData, dataHash: loadFirst.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, loadFirst.fromRules);
    expect(parseCompatibleSoloSave(raw, loadFirst.toRules)).toEqual(before);
  });
});

it('migrates the exact hero deployment release without removing ships, reserves or pending orders', () => {
  const before = oldSave();
  before.state.version = { data: heroMobilization.fromData, dataHash: heroMobilization.fromDataHash, manifest: '1' };
  before.state.heroes = {
    main: { id: 'main', owner: 'p1', location: 'home', cooldowns: {}, alive: true, fleetId: 'f1' },
    reserve: { id: 'reserve', owner: 'p1', location: 'home', cooldowns: {} },
  };
  const raw = serializeSoloSave(before, heroMobilization.fromRules);
  const result = parseCompatibleSoloSave(raw, heroMobilization.toRules);
  expect(result).toEqual({ ...before, state: { ...before.state, version: {
    ...before.state.version, data: heroMobilization.toData, dataHash: heroMobilization.toDataHash,
  } } });
  expect(parseSoloSave(raw, heroMobilization.fromRules)).toEqual(before);
});


it('retains a pending hero and a paid legacy order through the module progression migration', () => {
  const before = oldSave();
  before.state.version = { data: moduleProgression.fromData, dataHash: moduleProgression.fromDataHash, manifest: '1' };
  before.state.heroes = { reserve: { id: 'reserve', owner: 'p1', location: 'A', cooldowns: {},
    modules: ['gun'], mobilization: { target: 'A', startedAt: 0, readyAt: 3600000 } } };
  before.state.scheduled.push({ id: 'build:8', type: 'construction.complete', at: 7200000, seq: 8,
    payload: { kind: 'unit', planetId: 'A', playerId: 'p1', unit: 'ship', count: 1, modules: ['gun'] } });
  const raw = serializeSoloSave(before, moduleProgression.fromRules);
  expect(parseCompatibleSoloSave(raw, moduleProgression.toRules)).toEqual(before);
});

describe('explicit army selection save migration', () => {
  it('retains a legacy claim and wounded veterans in the preceding save', () => {
    const before = oldSave();
    before.state.version = {
      data: armySelection.fromData,
      dataHash: armySelection.fromDataHash,
      manifest: '1',
    };
    before.state.planets.A!.garrison = [{ unit: 'militia', count: 3, hp: 12, battles: 4 }];
    before.state.fleets.f = {
      id: 'f',
      owner: 'p1',
      location: 'A',
      movement: null,
      units: [],
      traits: [],
      loading: [{ unit: 'militia', count: 2, from: 'A', startAt: 0, doneAt: 3600000 }],
    };
    const raw = serializeSoloSave(before, armySelection.fromRules);
    expect(parseCompatibleSoloSave(raw, armySelection.toRules)).toEqual(before);
  });
});

it('keeps pending hero mobilization and damaged troops when adopting the echelon rules', () => {
  const before = oldSave();
  before.state.version = { data: echelons.fromData, dataHash: echelons.fromDataHash, manifest: '1' };
  before.state.heroes = {
    reserve: { id: 'reserve', owner: 'p1', location: 'home', cooldowns: {},
      mobilization: { target: 'home', startedAt: 1000, readyAt: 5000 } },
  };
  before.state.planets.A!.garrison = [{ unit: 'infantry', count: 2, hp: 7 }];
  const raw = serializeSoloSave(before, echelons.fromRules);
  expect(parseCompatibleSoloSave(raw, echelons.toRules)).toEqual({
    ...before,
    state: { ...before.state, version: {
      ...before.state.version, data: echelons.toData, dataHash: echelons.toDataHash,
    } },
  });
  expect(parseSoloSave(raw, echelons.fromRules)).toEqual(before);
});

it('preserves the released echelon save through module snapshots and exact army selection', () => {
  const before = oldSave();
  before.state.version = { data: echelons.toData, dataHash: echelons.toDataHash, manifest: '1' };
  before.state.heroes = { reserve: { id: 'reserve', owner: 'p1', location: 'A', cooldowns: {},
    modules: ['gun'], mobilization: { target: 'A', startedAt: 0, readyAt: 3600000 } } };
  before.state.planets.A!.garrison = [{ unit: 'militia', count: 3, hp: 12, battles: 4 }];
  before.state.fleets.f = { id: 'f', owner: 'p1', location: 'A', movement: null, traits: [],
    units: [{ unit: 'ship', count: 1, modules: ['gun'], moduleStars: { gun: 2 }, moduleRarity: { gun: 'unique' } }],
    loading: [{ unit: 'militia', count: 2, from: 'A', startAt: 0, doneAt: 3600000 }],
  };
  before.state.scheduled.push({ id: 'build:8', type: 'construction.complete', at: 7200000, seq: 8,
    payload: { kind: 'unit', planetId: 'A', playerId: 'p1', unit: 'ship', count: 1, modules: ['gun'] } });
  const raw = serializeSoloSave(before, echelons.toRules);
  expect(parseCompatibleSoloSave(raw, armySelection.toRules)).toEqual(before);
  expect(parseSoloSave(raw, echelons.toRules)).toEqual(before);
});

describe('the rules-only theft by development pair (0.1.76 → 0.1.76)', () => {
  it('reads a save of the capital victory release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: spyDevelopment.fromData, dataHash: spyDevelopment.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, spyDevelopment.fromRules);
    expect(parseCompatibleSoloSave(raw, spyDevelopment.toRules)).toEqual(before);
  });
});

describe('the intercept turret catalogue pair (0.1.76 → 0.1.77)', () => {
  it('reads a save of the previous release and moves only the catalogue pin', () => {
    const before = oldSave();
    before.state.version = { data: interceptTurret.fromData, dataHash: interceptTurret.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, interceptTurret.fromRules);
    expect(parseCompatibleSoloSave(raw, interceptTurret.toRules)).toEqual({
      ...before,
      state: { ...before.state, version: {
        ...before.state.version, data: interceptTurret.toData, dataHash: interceptTurret.toDataHash,
      } },
    });
  });
});

describe('the cloak field catalogue and rules pair (0.1.77 → 0.1.78)', () => {
  it('reads a save of the previous release and moves only the pins', () => {
    const before = oldSave();
    before.state.version = { data: cloakField.fromData, dataHash: cloakField.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, cloakField.fromRules);
    expect(parseCompatibleSoloSave(raw, cloakField.toRules)).toEqual({
      ...before,
      state: { ...before.state, version: {
        ...before.state.version, data: cloakField.toData, dataHash: cloakField.toDataHash,
      } },
    });
  });
});

describe('the gentler star ladder catalogue pair (0.1.78 → 0.1.79)', () => {
  it('reads a save of the previous release and moves only the catalogue pin', () => {
    const before = oldSave();
    before.state.version = { data: starLadder.fromData, dataHash: starLadder.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, starLadder.fromRules);
    expect(parseCompatibleSoloSave(raw, starLadder.toRules)).toEqual({
      ...before,
      state: { ...before.state, version: {
        ...before.state.version, data: starLadder.toData, dataHash: starLadder.toDataHash,
      } },
    });
  });
});

it('the combat patch reads pending personal clocks without resetting the saved battle', () => {
  const before = oldSave();
  before.state.version = { data: combatContinuity.fromData,
    dataHash: combatContinuity.fromDataHash, manifest: '1' };
  before.state.battles['battle:0'] = { id: 'battle:0', phase: 'orbital', location: 'A',
    round: 23, nextRoundAt: 3_600_000, sides: [
      { ref: { kind: 'fleet', fleetId: 'f1' }, owner: 'p1', role: 'attacker',
        attackStartedAt: 0, nextAttackAt: 3_600_000, attackCount: 23 },
      { ref: { kind: 'fleet', fleetId: 'f2' }, owner: 'p2', role: 'defender', stance: 'attack',
        attackStartedAt: 300_000, nextAttackAt: 3_900_000, attackCount: 19 },
    ] };
  before.state.scheduled = [{ id: 'evt:7', seq: 7, type: 'combat.tick', at: 3_600_000,
    payload: { battleId: 'battle:0' } }];
  before.state.scheduleSeq = 8;
  const raw = serializeSoloSave(before, combatContinuity.fromRules);
  expect(parseCompatibleSoloSave(raw, combatContinuity.toRules)).toEqual(before);
});

describe('the rules-only exposure without war pair', () => {
  it('reads a save of the combat continuity release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: spyNoWar.fromData, dataHash: spyNoWar.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, spyNoWar.fromRules);
    expect(parseCompatibleSoloSave(raw, spyNoWar.toRules)).toEqual(before);
  });
});

describe('the rules-only control limit pair', () => {
  it('reads a save of the exposure without war release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: controlLimit.fromData, dataHash: controlLimit.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, controlLimit.fromRules);
    expect(parseCompatibleSoloSave(raw, controlLimit.toRules)).toEqual(before);
  });
});

describe('the rules-only control recheck pair', () => {
  it('reads a save of the control limit release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: controlRecheck.fromData, dataHash: controlRecheck.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, controlRecheck.fromRules);
    expect(parseCompatibleSoloSave(raw, controlRecheck.toRules)).toEqual(before);
  });
});

describe('the rules-only integration pair', () => {
  it('reads a save of the control recheck release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: integration.fromData, dataHash: integration.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, integration.fromRules);
    expect(parseCompatibleSoloSave(raw, integration.toRules)).toEqual(before);
  });
});

describe('the rules-only ramp settlement pair', () => {
  it('reads a save of the integration release under the new rules unchanged', () => {
    const before = oldSave();
    before.state.version = { data: rampSettlement.fromData, dataHash: rampSettlement.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, rampSettlement.fromRules);
    expect(parseCompatibleSoloSave(raw, rampSettlement.toRules)).toEqual(before);
  });
});

describe('the control technologies catalogue and rules pair (0.1.79 → 0.1.80)', () => {
  it('reads a save of the ramp settlement release and moves only the catalogue pin', () => {
    const before = oldSave();
    before.state.version = { data: controlTech.fromData, dataHash: controlTech.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, controlTech.fromRules);
    expect(parseCompatibleSoloSave(raw, controlTech.toRules)).toEqual({
      ...before,
      state: { ...before.state, version: {
        ...before.state.version, data: controlTech.toData, dataHash: controlTech.toDataHash,
      } },
    });
  });
});

describe('the viceroy catalogue and rules pair (0.1.80 → 0.1.81)', () => {
  it('reads a save of the control technologies release and moves only the catalogue pin', () => {
    const before = oldSave();
    before.state.version = { data: viceroy.fromData, dataHash: viceroy.fromDataHash, manifest: '1' };
    const raw = serializeSoloSave(before, viceroy.fromRules);
    expect(parseCompatibleSoloSave(raw, viceroy.toRules)).toEqual({
      ...before,
      state: { ...before.state, version: {
        ...before.state.version, data: viceroy.toData, dataHash: viceroy.toDataHash,
      } },
    });
  });
});


it('production migration preserves paid jobs, waiting order IDs and hero clocks', () => {
  const before = oldSave();
  before.state.version = { data: productionWorkbench.fromData, dataHash: productionWorkbench.fromDataHash, manifest: '1' };
  before.state.planets.A!.buildQueue = [{ id: 20, playerId: 'p1', kind: 'unit', unit: 'militia', count: 2 }];
  before.state.heroes = { h: { id: 'h', owner: 'p1', location: 'A', cooldowns: {}, mobilization: { target: 'A', startedAt: 100, readyAt: 999999 } } };
  before.state.scheduled.push({ id: 'hero:old', seq: 21, type: 'hero.mobilization.complete', at: 999999, payload: { heroId: 'h', readyAt: 999999 } });
  before.state.scheduleSeq = 22;
  const raw = serializeSoloSave(before, productionWorkbench.fromRules);
  expect(parseCompatibleSoloSave(raw, productionWorkbench.toRules)).toEqual(before);
});
