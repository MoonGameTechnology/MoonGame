import { expect, it } from 'vitest';
import { createInitialState } from '../packages/shared-core/src/index';
import { parseSoloSave, serializeSoloSave, type SoloSave } from './soloSave';

it('keeps signed RNG words and JSON extensions without consulting wall time', () => {
  const state = createInitialState({
    seed: 'local-save',
    version: { data: '1', manifest: '1' },
    time: 123,
  });
  state.mapId = 'nexus';
  state.rng.b = -1470475506;
  state.players.p1 = { id: 'p1', name: 'One', faction: 'x', status: 'active', resources: {} };
  state.planets.A = {
    id: 'A',
    owner: 'p1',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
  const save: SoloSave = {
    state,
    ai: [],
    normalSpeed: 10,
    fastSpeed: 30,
    autoAssault: [],
    memory: [],
  };
  const raw = serializeSoloSave(save, 'rules');
  expect(parseSoloSave(raw, 'rules')).toEqual(save);
  expect(parseSoloSave(raw, 'changed-rules')).toBeNull();
  expect(state.time).toBe(123);
});

it('refuses non-envelopes, absent worlds and wrong versions without throwing', () => {
  for (const raw of [null, '', 'null', '[]', 'false', '42', '"text"', '{}', '{"v":2}', '{broken']) {
    expect(parseSoloSave(raw, 'rules')).toBeNull();
  }
});

it('SPY-20: carries the spy archive, refuses a damaged one, opens an older save without it', () => {
  const state = createInitialState({ seed: 'spy-archive', version: { data: '1', manifest: '1' } });
  state.mapId = 'nexus';
  state.players.p1 = { id: 'p1', name: 'One', faction: 'x', status: 'active', resources: {} };
  state.planets.A = {
    id: 'A',
    owner: 'p1',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
  const base = { state, ai: [], normalSpeed: 10, fastSpeed: 30, autoAssault: [], memory: [] };
  const save: SoloSave = {
    ...base,
    spyArchive: [{ at: 5, text: 'кража', planetId: 'A', op: 'theft' }],
  };
  expect(parseSoloSave(serializeSoloSave(save, 'rules'), 'rules')).toEqual(save);
  expect(parseSoloSave(serializeSoloSave(base, 'rules'), 'rules')).toEqual(base);
  const broken = { ...base, spyArchive: [{ at: 'вчера', text: 'x' }] } as unknown as SoloSave;
  expect(parseSoloSave(serializeSoloSave(broken, 'rules'), 'rules')).toBeNull();
});
