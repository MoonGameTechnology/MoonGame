import { describe, expect, it } from 'vitest';
import { advance, newGame, data, order, buildBuilding } from './game';
import { mapPreset } from './mapCatalog';
import { kernel } from './protoKernel';
import { hashJson } from '../../packages/shared-core/src/index';
import { parseSoloSave, serializeSoloSave, type SoloSave } from '../../decisions/soloSave';
import { SOLO_SAVE_KEY, soloSaveStore } from './soloSaveLocal';
import { createScanMemory } from './scanMemory';

const rules = hashJson({ data, modules: kernel.manifest });
function checkpoint(): SoloSave {
  const state = advance(newGame(), 1000).state;
  const memory = createScanMemory();
  memory.remember([Object.keys(state.planets)[0]!], state.planets);
  return {
    state,
    ai: [['p2', 'strong']],
    normalSpeed: 50,
    fastSpeed: 150,
    autoAssault: ['f1'],
    patrols: [['f1', { kind: 'fleet' }]],
    memory: memory.dump(),
  };
}
describe('normal single-player checkpoint', () => {
  it('restores the full world and host policies without applying offline time', () => {
    const save = checkpoint();
    const home = Object.values(save.state.planets).find((p) => p.owner === 'p1')!;
    const built = order(save.state, buildBuilding('p1', home.id, 'farm'), save.state.time);
    expect(built.error).toBeUndefined();
    save.state = built.state;
    expect(save.state.scheduled.length).toBeGreaterThan(0);
    const restored = parseSoloSave(serializeSoloSave(save, rules), rules)!;
    expect(restored).toEqual(JSON.parse(JSON.stringify(save)));
    expect(restored.state.time).toBe(save.state.time);
    // The schedule, RNG, queues, research, diplomacy, fog, etc. take the same next step.
    const afterBuild = Math.max(...save.state.scheduled.map((e) => e.at)) + 1;
    expect(advance(restored.state, afterBuild).state).toEqual(
      advance(save.state, afterBuild).state,
    );
    expect(restored.ai).toEqual([['p2', 'strong']]);
  });
  it('supports the large map as well as Nexus', () => {
    const save = checkpoint();
    save.state = newGame({
      mapId: 'frontier-50',
      seats: [
        {
          id: 'p1',
          name: 'One',
          ai: false,
          faction: 'aurora',
          start: mapPreset('frontier-50').starts[0]!,
        },
      ],
    });
    save.memory = [];
    save.ai = [];
    const restored = parseSoloSave(serializeSoloSave(save, rules), rules);
    expect(restored?.state).toEqual(JSON.parse(JSON.stringify(save.state)));
    expect(restored?.state.mapId).toBe('frontier-50');
  });
  it('refuses corruption, older formats, changed rules, and damaged host metadata', () => {
    const raw = serializeSoloSave(checkpoint(), rules);
    expect(parseSoloSave(null, rules)).toBeNull();
    expect(parseSoloSave('{broken', rules)).toBeNull();
    expect(parseSoloSave(raw, 'other-rules')).toBeNull();
    const env = JSON.parse(raw);
    env.payload.state.time++;
    expect(parseSoloSave(JSON.stringify(env), rules)).toBeNull();
    env.v = 2;
    expect(parseSoloSave(JSON.stringify(env), rules)).toBeNull();
    for (const patch of [
      { normalSpeed: 0 },
      { ai: [['p2', 'unknown']] },
      { patrols: [['f1', {}]] },
      { memory: [['missing', {}]] },
    ]) {
      expect(
        parseSoloSave(serializeSoloSave({ ...checkpoint(), ...patch } as SoloSave, rules), rules),
      ).toBeNull();
    }
  });
  it('refuses completed games and Sector Zero worlds', () => {
    const save = checkpoint();
    save.state.match.status = 'ended';
    expect(parseSoloSave(serializeSoloSave(save, rules), rules)).toBeNull();
    save.state.match.status = 'ongoing';
    save.state.modeId = 'sector-zero';
    expect(parseSoloSave(serializeSoloSave(save, rules), rules)).toBeNull();
  });
  it('retains last identified intel as detached snapshots, not the hidden live world', () => {
    const save = checkpoint();
    const [id, old] = save.memory[0]!;
    save.state.planets[id]!.owner = 'hidden-new-owner';
    const restored = parseSoloSave(serializeSoloSave(save, rules), rules)!;
    const memory = createScanMemory();
    memory.restore(restored.memory);
    expect(memory.get(id)).toEqual(old);
    restored.memory[0]![1].buildings.length = 0;
    memory.dump()[0]![1].owner = 'mutated';
    expect(memory.get(id)).toEqual(old);
    expect(memory.ownerOf(id)).not.toBe('hidden-new-owner');
  });
});

describe('single-player local slot', () => {
  it('writes synchronously and never touches the Sector Zero slot or profile', () => {
    const entries = new Map([
      ['void.run.v1', 'run'],
      ['sector-zero.progress.v1', 'profile'],
    ]);
    const store = soloSaveStore(() => ({
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => {
        entries.set(key, value);
      },
      removeItem: (key) => {
        entries.delete(key);
      },
    }));
    expect(store.load()).toEqual({ ok: true, raw: null });
    expect(store.save('checkpoint')).toBe(true);
    expect(entries.get(SOLO_SAVE_KEY)).toBe('checkpoint');
    expect(store.load()).toEqual({ ok: true, raw: 'checkpoint' });
    expect(store.clear()).toBe(true);
    expect([...entries]).toEqual([
      ['void.run.v1', 'run'],
      ['sector-zero.progress.v1', 'profile'],
    ]);
  });
  it('reports unavailable storage and failed writes/clears without claiming success', () => {
    const blocked = soloSaveStore(() => {
      throw new Error('blocked');
    });
    expect(blocked.load()).toEqual({ ok: false });
    expect(blocked.save('save')).toBe(false);
    expect(blocked.clear()).toBe(false);
    const quota = soloSaveStore(() => ({
      getItem: () => 'previous',
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    }));
    expect(quota.save('new')).toBe(false);
    expect(quota.load()).toEqual({ ok: true, raw: 'previous' });
  });
});
