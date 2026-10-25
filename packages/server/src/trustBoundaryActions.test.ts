import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ActionGate, createActionEnvelope } from '@void/action-layer';
import { isValidActionPayload } from '@void/shared-core';
import { createDevMatch, loadShippedData } from './scenario';
import { commitMatch } from './matchCommit';
import { MemoryArsenalStore, MemoryMatchStore, MemoryReceiptStore,
  PostgresMatchStore, PostgresReceiptStore, migrate } from './store';
import type { MatchSnapshot, StoredReceipt } from './store';
import type { RoomPeer } from './matchRoom';
import type { ServerMessage } from './protocol';

// Regression scenarios from the production trust-boundary audit.
const data = loadShippedData();
const SESSION = 'audit-connection';
class Peer implements RoomPeer {
  readonly messages: ServerMessage[] = [];
  send(raw: string): void { this.messages.push(JSON.parse(raw) as ServerMessage); }
  codes(): string[] {
    return this.messages.flatMap((m) => m.type === 'rejection' || m.type === 'error' ? [m.code] : []);
  }
}
function envelope(seq = 1, type = 'fleet.orbit', payload: unknown = { fleetId: 'green_1', orbit: 'near' }, issuedAt = 1000) {
  return createActionEnvelope({ matchId: 'dev', playerId: 'green', sessionId: SESSION,
    clientSeq: seq, type, payload, issuedAt });
}
function wire(value: unknown): string { return JSON.stringify({ type: 'action.v1', envelope: value }); }
function gate(): ActionGate { return new ActionGate({ payloadValidator: isValidActionPayload }); }
function basicRoom() {
  return createDevMatch(data, { now: () => 1000, time: 1000, gate: gate(), persist: async () => {} });
}
function arsenalRoom(store: MemoryArsenalStore, persist: (snapshot: MatchSnapshot, receipt: StoredReceipt) => Promise<void> = async () => {}) {
  const seed = createDevMatch(data, { now: () => 1000, time: 1000 });
  const state = structuredClone(seed.state);
  state.players.green!.resources.microelectronics = 10;
  state.players.green!.arsenal = { hulls: ['cruiser'], modules: [] };
  return createDevMatch(data, { now: () => 1000, time: 1000, initialState: state,
    gate: gate(), arsenalStore: store, persist });
}
async function grantOldOwnerCatalog(store: MemoryArsenalStore): Promise<void> {
  for (const [itemId, kind, defId] of [
    ['audit-hull', 'hull', 'cruiser'], ['audit-module', 'module', 'targeting_array'],
  ] as const) await store.grant({ itemId, accountId: 'old-owner', kind, defId,
    form: 'blueprint', soulbound: false, origin: 'craft', acquiredAt: 0 });
}
const buildPayload = { planetId: 'home_green', unit: 'cruiser', modules: ['targeting_array'] };

describe('trust boundary audit: adversarial command combinations', () => {
  it('does not execute a changed payload under an already accepted action ID', async () => {
    const room = basicRoom(); const peer = new Peer(); room.addPeer('green', peer);
    await room.receive('green', peer, wire(envelope()), SESSION);
    const before = structuredClone(room.state);
    // The adversary keeps the ID but swaps the target to another player's fleet.
    await room.receive('green', peer, wire(envelope(1, 'fleet.orbit', { fleetId: 'red_1', orbit: 'near' })), SESSION);
    expect(room.sequence).toBe(1);
    expect(room.state).toEqual(before);
    expect(room.state.fleets.red_1?.orbit).toBeUndefined();
  });

  it.each([-Number.MAX_VALUE, Number.MAX_VALUE, -1])('client issuedAt=%s cannot advance or rewind server time', async (issuedAt) => {
    const room = basicRoom(); const peer = new Peer(); room.addPeer('green', peer);
    await room.receive('green', peer, wire(envelope(1, 'fleet.orbit', { fleetId: 'green_1', orbit: 'near' }, issuedAt)), SESSION);
    expect(room.state.time).toBe(1000);
    expect(room.state.fleets.green_1?.orbit).toBe('near');
    expect(room.sequence).toBe(1);
  });

  it.each(['arsenal.sync', 'seat.confirm', 'seat.claim', 'coalition.clock.rebase', '__proto__', 'constructor'])('denies internal or prototype action type %s', async (type) => {
    const room = basicRoom(); const peer = new Peer(); room.addPeer('green', peer);
    const before = structuredClone(room.state);
    await room.receive('green', peer, wire(envelope(1, type, { hulls: ['cruiser'], modules: ['targeting_array'] })), SESSION);
    expect(peer.codes()).toContain('E_BAD_PAYLOAD');
    expect(room.state).toEqual(before);
    expect(room.sequence).toBe(0);
  });

  it('transient arsenal read failure does not consume clientSeq and block its retry', async () => {
    const store = new MemoryArsenalStore(); await grantOldOwnerCatalog(store);
    const original = store.listOf.bind(store); let failed = false;
    store.listOf = async (accountId) => {
      if (!failed) { failed = true; throw new Error('injected temporary read failure'); }
      return original(accountId);
    };
    const room = arsenalRoom(store); const peer = new Peer();
    room.addPeer('green', peer, undefined, undefined, 'old-owner');
    const command = wire(envelope(1, 'unit.build', buildPayload));
    await room.receive('green', peer, command, SESSION);
    expect(peer.codes()).toContain('E_UNAVAILABLE');
    expect(room.sequence).toBe(0);
    peer.messages.length = 0;
    await room.receive('green', peer, command, SESSION);
    expect(peer.codes()).not.toContain('E_REPLAY');
    expect(room.state.players.green?.arsenal?.modules).toContain('targeting_array');
  });

  it('an old connection cannot complete a build after password reset during its awaited arsenal read', async () => {
    const store = new MemoryArsenalStore(); await grantOldOwnerCatalog(store);
    const original = store.listOf.bind(store);
    let releaseRead!: () => void; let readStarted!: () => void;
    const held = new Promise<void>((resolve) => { releaseRead = resolve; });
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    store.listOf = async (accountId) => { readStarted(); await held; return original(accountId); };
    const room = arsenalRoom(store); const oldPeer = new Peer();
    room.addPeer('green', oldPeer, undefined, undefined, 'old-owner');
    const pending = room.receive('green', oldPeer, wire(envelope(1, 'unit.build', buildPayload)), SESSION);
    await started;
    // Password reset revokes the old connection while its read is pending, before
    // any state/receipt write starts. The same account may then reconnect; this
    // does not claim that password reset transfers ownership of its seat.
    room.evictAccount('old-owner', 'E_SESSION_REVOKED');
    const newPeer = new Peer();
    room.addPeer('green', newPeer, undefined, undefined, 'old-owner');
    const before = structuredClone(room.state);
    releaseRead(); await pending;
    expect(room.sequence).toBe(0);
    expect(room.state).toEqual(before);
    expect(room.state.players.green?.arsenal?.modules).not.toContain('targeting_array');
  });

  it('a failed arsenal-sync write leaves the original build retriable instead of caching E_NOT_OWNED', async () => {
    const store = new MemoryArsenalStore(); await grantOldOwnerCatalog(store);
    let unavailable = true;
    const room = arsenalRoom(store, async () => {
      if (unavailable) throw new Error('temporary snapshot outage');
    });
    const peer = new Peer(); room.addPeer('green', peer, undefined, undefined, 'old-owner');
    const command = wire(envelope(1, 'unit.build', buildPayload));
    await room.receive('green', peer, command, SESSION);
    expect(room.sequence).toBe(0);
    expect(peer.codes()).toContain('E_UNAVAILABLE');
    expect(peer.codes()).not.toContain('E_NOT_OWNED');
    unavailable = false; peer.messages.length = 0;
    await room.receive('green', peer, command, SESSION);
    expect(peer.codes()).not.toContain('E_REPLAY');
    expect(room.sequence).toBe(2);
  });

  it('receipt-write failure cannot leave an unacknowledged action in the recoverable snapshot', async () => {
    const snapshots = new MemoryMatchStore(); const receipts = new MemoryReceiptStore();
    const prepare = receipts.prepareSave.bind(receipts);
    receipts.prepareSave = () => { throw new Error('injected receipt preparation failure'); };
    const seed = createDevMatch(data, { now: () => 1000, time: 1000 });
    await snapshots.save({ matchId: 'dev', dataVersion: seed.state.version.data,
      seq: 0, status: 'ongoing', state: seed.state });
    const room = createDevMatch(data, { now: () => 1000, time: 1000, gate: gate(),
      persist: (snapshot, receipt) => commitMatch(snapshots, receipts, snapshot, receipt),
    });
    const peer = new Peer(); room.addPeer('green', peer);
    await room.receive('green', peer, wire(envelope()), SESSION);
    expect(peer.codes()).toContain('E_UNAVAILABLE');
    expect(room.sequence).toBe(0);
    expect(await receipts.loadAll('dev')).toHaveLength(0);
    const recovered = await snapshots.load('dev');
    expect(recovered?.seq).toBe(room.sequence);
    expect(recovered?.state).toEqual(room.state);
    receipts.prepareSave = prepare;
    await room.receive('green', peer, wire(envelope()), SESSION);
    expect(room.sequence).toBe(1);
    expect((await receipts.loadAll('dev'))).toHaveLength(1);
  });
});

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)('trust boundary audit: actual PostgreSQL partial commit', () => {
  const databaseName = `audit_actions_${randomUUID().replaceAll('-', '')}`;
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl, max: 1 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const target = new URL(databaseUrl!);
    target.pathname = '/' + databaseName;
    pool = new Pool({ connectionString: target.toString(), max: 2 });
    await migrate(pool);
  });
  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        const { rows } = await admin.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1', [databaseName]);
        if (rows[0].n === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    } finally { await admin.end(); }
  });
  it('cannot recover a rejected action without its receipt after the second write fails', async () => {
    const snapshots = new PostgresMatchStore(pool!);
    const receipts = new PostgresReceiptStore(pool!);
    // The snapshot INSERT really executes before this PostgreSQL statement fails.
    const saveReceipt = receipts.saveUsing.bind(receipts);
    receipts.saveUsing = async (query) => { await query.query('SELECT 1 / 0'); };
    const seed = createDevMatch(data, { now: () => 1000, time: 1000 });
    await snapshots.save({ matchId: 'dev', dataVersion: seed.state.version.data,
      seq: 0, status: 'ongoing', state: seed.state });
    const room = createDevMatch(data, { now: () => 1000, time: 1000, gate: gate(),
      persist: (snapshot, receipt) => commitMatch(snapshots, receipts, snapshot, receipt),
    });
    const peer = new Peer(); room.addPeer('green', peer);
    await room.receive('green', peer, wire(envelope()), SESSION);
    expect(peer.codes()).toContain('E_UNAVAILABLE');
    expect(room.sequence).toBe(0);
    const recoveredSnapshot = await snapshots.load('dev');
    const recoveredReceipts = await new PostgresReceiptStore(pool!).loadAll('dev');
    expect(recoveredReceipts).toHaveLength(0);
    expect(recoveredSnapshot).not.toBeNull();
    const restored = createDevMatch(data, { now: () => 1000, time: 1000,
      initialState: recoveredSnapshot!.state, initialSeq: recoveredSnapshot!.seq,
      initialReceipts: recoveredReceipts, gate: gate(), persist: async () => {},
    });
    expect(restored.state.fleets.green_1?.orbit).toBeUndefined();
    expect(restored.sequence).toBe(room.sequence);
    receipts.saveUsing = saveReceipt;
    await room.receive('green', peer, wire(envelope()), SESSION);
    expect(room.sequence).toBe(1);
    expect((await snapshots.load('dev'))?.state.fleets.green_1?.orbit).toBe('near');
    expect(await receipts.loadAll('dev')).toHaveLength(1);
  });
});
