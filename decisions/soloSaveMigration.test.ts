import { describe, expect, it } from 'vitest';
import { createInitialState } from '../packages/shared-core/src/index';
import { parseSoloSave, serializeSoloSave, type SoloSave } from './soloSave';
import {
  CORP_FORMATS_SOLO_MIGRATION as corpFormats,
  COMMANDER_CAREER_SOLO_MIGRATION as career,
  MINING_SOLO_MIGRATION as migration,
  RECON_HALT_SOLO_MIGRATION as reconHalt,
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
    expect(SOLO_MIGRATIONS).toEqual([migration, corpFormats, career, reconHalt]);
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
