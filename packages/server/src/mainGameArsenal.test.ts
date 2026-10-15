import { describe, expect, it } from 'vitest';
import { initializeOrdinaryArsenal, syncAccountArsenal } from './mainGameArsenal';
import { createDevMatch, loadShippedData } from './scenario';
import { MemoryAccountStore, MemoryArsenalStore } from './store';
import { InMemoryRoomRegistry } from './roomRegistry';
import { grantStarterArsenal } from './arsenal';
import type { Action } from '@void/shared-core';

const data = loadShippedData();
const starter = [{ kind: 'hull' as const, defId: 'cruiser' }];

async function fixture(options: { legacy?: boolean; persist?: () => Promise<void> } = {}) {
  const initial = structuredClone(createDevMatch(data, { time: 1000, now: () => 1000 }).state);
  initial.players.green!.resources.microelectronics = 10;
  const room = createDevMatch(data, {
    id: 'ordinary',
    time: 1000,
    now: () => 1000,
    initialState: options.legacy ? initial : initializeOrdinaryArsenal(initial, starter),
    persist: options.persist,
  });
  const arsenal = new MemoryArsenalStore();
  await grantStarterArsenal(arsenal, 'account', starter, 0);
  const accounts = new MemoryAccountStore();
  await accounts.resolveSeat(room.id, 'Pilot', ['green']);
  const registry = new InMemoryRoomRegistry([room]);
  return {
    room,
    deps: {
      accountId: 'account',
      login: 'Pilot',
      arsenal,
      accounts,
      registry,
      isOrdinary: () => true,
    },
  };
}

async function grantModule(arsenal: MemoryArsenalStore): Promise<void> {
  await arsenal.grant({
    itemId: 'crafted',
    accountId: 'account',
    kind: 'module',
    form: 'instance',
    defId: 'targeting_array',
    soulbound: false,
    origin: 'craft',
    acquiredAt: 1,
  });
}

const build = (id: string): Action => ({
  id,
  type: 'unit.build',
  playerId: 'green',
  issuedAt: 1000,
  payload: { planetId: 'home_green', unit: 'cruiser', modules: ['targeting_array'] },
});

describe('ordinary match arsenal integration', () => {
  it('initializes independent claimable snapshots without changing NPCs, fleets or its input', () => {
    const initial = structuredClone(
      createDevMatch(data, { players: ['green', 'red', 'blue'] }).state,
    );
    initial.players.red!.npc = 'pirate';
    initial.players.blue!.ai = true;
    const before = structuredClone(initial);
    const next = initializeOrdinaryArsenal(initial, starter);
    expect(initial).toEqual(before);
    expect(next.players.green!.arsenal).toEqual({ hulls: ['cruiser'], modules: [] });
    expect(next.players.blue!.arsenal).toEqual({ hulls: ['cruiser'], modules: [] });
    expect(next.players.red!.arsenal).toBeUndefined();
    expect(next.fleets).toEqual(initial.fleets);
    next.players.green!.arsenal!.hulls.push('other');
    expect(next.players.blue!.arsenal!.hulls).toEqual(['cruiser']);
  });

  it('unlocks a crafted module for the next build without modifying existing ships', async () => {
    const { room, deps } = await fixture({ persist: async () => undefined });
    expect(await room.submitServerAction('green', build('before-grant'))).toMatchObject({
      ok: false,
      code: 'E_NOT_OWNED',
    });
    const fleets = structuredClone(room.state.fleets);
    await grantModule(deps.arsenal);
    expect(await syncAccountArsenal(deps)).toBe(1);
    expect(room.state.players.green!.arsenal!.modules).toEqual(['targeting_array']);
    expect(room.state.fleets).toEqual(fleets);
    const sequence = room.sequence;
    expect(await syncAccountArsenal(deps)).toBe(0);
    expect(room.sequence).toBe(sequence);
    expect(await room.submitServerAction('green', build('after-grant'))).toEqual({ ok: true });
  });

  it('leaves historical unrestricted matches and excluded corporate snapshots intact', async () => {
    const legacy = await fixture({ legacy: true });
    await grantModule(legacy.deps.arsenal);
    expect(await syncAccountArsenal(legacy.deps)).toBe(0);
    expect(legacy.room.state.players.green!.arsenal).toBeUndefined();
    const corporate = await fixture();
    await grantModule(corporate.deps.arsenal);
    expect(await syncAccountArsenal({ ...corporate.deps, isOrdinary: async () => false })).toBe(0);
    expect(corporate.room.state.players.green!.arsenal!.modules).toEqual([]);
    expect(await syncAccountArsenal({ ...corporate.deps, login: 'Unseated' })).toBe(0);
  });

  it('does not claim a failed durable sync succeeded, and permits a later retry', async () => {
    let fail = true;
    const { room, deps } = await fixture({
      persist: async () => {
        if (fail) throw Error('storage unavailable');
      },
    });
    await grantModule(deps.arsenal);
    await expect(syncAccountArsenal(deps)).rejects.toThrow(/^E_/);
    expect(room.state.players.green!.arsenal!.modules).toEqual([]);
    fail = false;
    expect(await syncAccountArsenal(deps)).toBe(1);
    expect(room.state.players.green!.arsenal!.modules).toEqual(['targeting_array']);
  });

  it('serializes inventory reads so a delayed old sync cannot erase a newer grant', async () => {
    const { room, deps } = await fixture();
    const list = deps.arsenal.listOf.bind(deps.arsenal);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reading!: () => void;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    let reads = 0;
    deps.arsenal.listOf = async (accountId) => {
      const snapshot = await list(accountId);
      if (reads++ === 0) {
        reading();
        await pending;
      }
      return snapshot;
    };
    const old = syncAccountArsenal(deps);
    await started;
    await grantModule(deps.arsenal);
    const fresh = syncAccountArsenal(deps);
    release();
    await Promise.all([old, fresh]);
    expect(room.state.players.green!.arsenal!.modules).toEqual(['targeting_array']);
  });
});
