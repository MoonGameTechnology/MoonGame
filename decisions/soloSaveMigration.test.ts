import { describe, expect, it } from 'vitest';
import { createInitialState } from '../packages/shared-core/src/index';
import { parseSoloSave, serializeSoloSave, type SoloSave } from './soloSave';
import { MINING_SOLO_MIGRATION as migration, parseCompatibleSoloSave } from './soloSaveMigration';

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
