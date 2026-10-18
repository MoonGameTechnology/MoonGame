import { describe, expect, it } from 'vitest';
import {
  fullCatalogArsenal,
  initializeOrdinaryArsenal,
  syncAccountArsenal,
} from './mainGameArsenal';
import { createDevMatch, loadShippedData } from './scenario';
import { MemoryAccountStore, MemoryArsenalStore } from './store';
import { InMemoryRoomRegistry } from './roomRegistry';
import { grantStarterArsenal } from './arsenal';
import type { Action } from '@void/shared-core';

const data = loadShippedData();
const starter = [{ kind: 'hull' as const, defId: 'cruiser' }];

/** A human has claimed `green`: like the hosts' join, the claim's sync swaps the bot's
 *  full catalog for the account's own arsenal before the player can build anything. */
async function fixture(
  options: {
    id?: string;
    legacy?: boolean;
    persist?: () => Promise<void>;
    actionRateMax?: number;
  } = {},
) {
  const initial = structuredClone(createDevMatch(data, { time: 1000, now: () => 1000 }).state);
  initial.players.green!.resources.microelectronics = 10;
  const room = createDevMatch(data, {
    id: options.id ?? 'ordinary',
    time: 1000,
    now: () => 1000,
    initialState: options.legacy ? initial : initializeOrdinaryArsenal(initial, data),
    persist: options.persist,
    actionRateMax: options.actionRateMax,
  });
  const arsenal = new MemoryArsenalStore();
  await grantStarterArsenal(arsenal, 'account', starter, 0);
  const accounts = new MemoryAccountStore();
  await accounts.resolveSeat(room.id, 'Pilot', ['green']);
  const registry = new InMemoryRoomRegistry([room]);
  const deps = {
    accountId: 'account',
    login: 'Pilot',
    arsenal,
    accounts,
    registry,
    isOrdinary: () => true,
    retryDelaysMs: [] as number[],
  };
  if (!options.legacy) expect(await syncAccountArsenal(deps)).toBe(1);
  return { room, deps };
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
  it('seats every claimable place with the full catalog, leaving NPCs, fleets and its input alone', () => {
    const initial = structuredClone(
      createDevMatch(data, { players: ['green', 'red', 'blue'] }).state,
    );
    initial.players.red!.npc = 'pirate';
    initial.players.blue!.ai = true;
    const before = structuredClone(initial);
    const next = initializeOrdinaryArsenal(initial, data);
    const full = fullCatalogArsenal(data);
    expect(initial).toEqual(before);
    expect(next.players.green!.arsenal).toEqual(full);
    expect(next.players.blue!.arsenal).toEqual(full);
    expect(next.players.red!.arsenal).toBeUndefined();
    expect(next.fleets).toEqual(initial.fleets);
    next.players.green!.arsenal!.hulls.push('other');
    expect(next.players.blue!.arsenal).toEqual(full);
  });

  // «Широкий старт» (решение владельца 2026-10-15): бот строит всё, что построил бы без
  // арсенала. Полный каталог — это ровно то, о чём спрашивает гейт ядра: каждый
  // не наземный корпус и каждый модуль.
  it('the full catalog covers everything the ownership gate can refuse', () => {
    const full = fullCatalogArsenal(data);
    const ships = Object.entries(data.units).filter(([, u]) => u.domain !== 'ground');
    expect(full.hulls).toEqual(ships.map(([id]) => id).sort());
    expect(full.modules).toEqual(Object.keys(data.modules).sort());
    expect(full.hulls).toEqual(expect.arrayContaining(['bomber', 'heavy_striker']));
    expect(full.modules).toEqual(expect.arrayContaining(['siege_platform', 'targeting_array']));
  });

  it('a claim trades the bot catalog for the account arsenal; the other seat stays a free bot', async () => {
    const { room } = await fixture();
    expect(room.state.players.green!.arsenal).toEqual({ hulls: ['cruiser'], modules: [] });
    expect(room.state.players.red!.arsenal).toEqual(fullCatalogArsenal(data));
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
    let fail = false;
    const { room, deps } = await fixture({
      persist: async () => {
        if (fail) throw Error('storage unavailable');
      },
    });
    fail = true;
    await grantModule(deps.arsenal);
    await expect(syncAccountArsenal(deps)).rejects.toThrow(/^E_/);
    expect(room.state.players.green!.arsenal!.modules).toEqual([]);
    fail = false;
    expect(await syncAccountArsenal(deps)).toBe(1);
    expect(room.state.players.green!.arsenal!.modules).toEqual(['targeting_array']);
  });

  it('retries a transient storage failure instead of leaving the old snapshot', async () => {
    let failures = 0;
    const { room, deps } = await fixture({
      persist: async () => {
        if (failures > 0) {
          failures--;
          throw Error('storage unavailable');
        }
      },
    });
    await grantModule(deps.arsenal);
    failures = 2;
    const waits: number[] = [];
    expect(
      await syncAccountArsenal({
        ...deps,
        retryDelaysMs: [5, 7, 9],
        sleep: async (ms) => {
          waits.push(ms);
        },
      }),
    ).toBe(1);
    expect(waits).toEqual([5, 7]);
    expect(room.state.players.green!.arsenal!.modules).toEqual(['targeting_array']);
  });

  // Ревью #1670 (подтверждено): отзыв делил лимит приказов с игроком. Упёрся в лимит и тут
  // же продал модуль — синхронизация получала отказ, и проданное строилось дальше.
  it('a revoke lands even when the player has used up their own order budget', async () => {
    const { room, deps } = await fixture({ persist: async () => undefined, actionRateMax: 2 });
    await grantModule(deps.arsenal);
    expect(await syncAccountArsenal(deps)).toBe(1);
    const order = (id: string): Action => ({
      ...build(id),
      payload: { planetId: 'home_green', unit: 'cruiser' },
    });
    await room.submitServerAction('green', order('spend-1'));
    await room.submitServerAction('green', order('spend-2'));
    expect(await room.submitServerAction('green', order('spend-3'))).toMatchObject({
      ok: false,
      code: 'E_RATE_LIMIT',
    });
    const items = await deps.arsenal.listOf('account');
    deps.arsenal.listOf = async () => items.filter((item) => item.defId !== 'targeting_array');
    expect(await syncAccountArsenal(deps)).toBe(1);
    expect(room.state.players.green!.arsenal!.modules).toEqual([]);
  });

  it('one failing room does not keep the account’s other matches on the old snapshot', async () => {
    let fail = false;
    const first = await fixture({
      persist: async () => {
        if (fail) throw Error('storage unavailable');
      },
    });
    const { room: other } = await fixture({ id: 'second' });
    await first.deps.accounts.resolveSeat('second', 'Pilot', ['green']);
    const registry = new InMemoryRoomRegistry([first.room, other]);
    fail = true;
    await grantModule(first.deps.arsenal);
    await expect(syncAccountArsenal({ ...first.deps, registry })).rejects.toThrow('E_UNAVAILABLE');
    expect(other.state.players.green!.arsenal!.modules).toEqual(['targeting_array']);
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
