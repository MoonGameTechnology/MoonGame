import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { WebSocket, type RawData } from 'ws';
import { Pool } from 'pg';
import { ActionGate, createActionEnvelope } from '../../packages/action-layer/src/index';
import {
  CLIENT_ACTION_TYPES,
  applyDelta,
  hashState,
  isValidActionPayload,
  visibleState,
  type GameState,
} from '../../packages/shared-core/src/index';
import {
  createMultiplayerServer,
  hmacSecret,
  migrate,
  PostgresMatchStore,
  PostgresReceiptStore,
  signJoinToken,
  type ActionReceipt,
  type MatchSnapshot,
  type ServerMessage,
  type ServerWelcomeMessage,
  type StoredReceipt,
} from '../../packages/server/src/index';
import { createDevMatch, loadShippedData } from '../../packages/server/src/scenario';

export interface RehearsalOptions {
  players: number;
  latencyMs: number;
  persistDelayMs: number;
  timeoutMs: number;
  databaseUrl?: string;
}

export interface RehearsalReport {
  players: number;
  actionsAccepted: number;
  duplicatesPrevented: number;
  reconnects: number;
  serverRestarts: number;
  durableWrites: number;
  wireActionTypes: number;
  wireActionsApplied: number;
  wireActionsRejectedByRules: number;
  hashMismatches: number;
  fogViolations: number;
  finalSequence: number;
  durationMs: number;
  persistenceBackend: 'memory' | 'postgres';
}

const DEFAULTS: RehearsalOptions = {
  players: 4,
  latencyMs: 75,
  persistDelayMs: 15,
  timeoutMs: 10_000,
};

/** One schema-valid payload for every action type exposed to an untrusted client.
 * The scenarios are intentionally not all legal in the compact dev state: this matrix
 * proves the complete wire path reaches the authoritative reducer (a rule rejection is
 * acceptable), while the modules' focused tests own each mechanic's success semantics. */
const WIRE_PAYLOADS: Record<string, unknown> = {
  'fleet.move': { fleetId: 'p1_1', to: 'nexus' },
  'fleet.stop': { fleetId: 'p1_1' },
  'fleet.orbit': { fleetId: 'p1_1', orbit: 'near' },
  'fleet.bombard': { fleetId: 'p1_1', on: true },
  'fleet.barrage': { fleetId: 'p1_1', targetId: null },
  'fleet.barrageMode': { fleetId: 'p1_1', mode: 'aggressive' },
  'fleet.assault': { fleetId: 'p1_1' },
  'fleet.retreat': { fleetId: 'p1_1' },
  'army.load': { fleetId: 'p1_1', unit: 'militia', count: 1 },
  'army.unload': { fleetId: 'p1_1', unit: 'militia', count: 1 },
  'hero.move': { to: 'home_p1' },
  'planet.annihilate': { planetId: 'nexus' },
  'hero.ability': { heroId: 'hero:p1', abilityId: 'scan', target: 'nexus' },
  'hero.spawn': { heroId: 'hero:p1', at: 'home_p1' },
  'hero.skill.unlock': { heroId: 'hero:p1', node: 'neural_lace' },
  'hero.fit': { heroId: 'hero:p1', fitting: 'psi_lens' },
  'station.deploy': { planetId: 'home_p1' },
  'seat.claim': { faction: 'missing-faction', scientists: [] },
  'building.construct': { planetId: 'home_p1', building: 'mine' },
  'building.upgrade': { planetId: 'home_p1', building: 'spaceport' },
  'unit.build': { planetId: 'home_p1', unit: 'cruiser', count: 1 },
  'construction.cancel': { planetId: 'home_p1', seq: 0 },
  'construction.resume': { planetId: 'home_p1', id: 0 },
  'technology.research': { technology: 'propulsion_1' },
  'technology.boost': { technology: 'propulsion_1' },
  'espionage.spy': { target: 'p2', kind: 'treasury' },
  'market.list': { side: 'sell', resource: 'metal', amount: 1, price: 1 },
  'market.take': { id: 'missing-lot', amount: 1 },
  'market.cancel': { id: 'missing-lot' },
  'diplomacy.declare': { target: 'p2', stance: 'war' },
  'diplomacy.mapshare': { target: 'p2', on: true },
  'fleet.launch': { planetId: 'home_p1' },
  'fleet.merge': { from: 'p1_1', into: 'missing-fleet' },
  'fleet.split': { fleetId: 'p1_1', take: [{ unit: 'scout_drone', count: 1 }] },
  'fleet.engage': { fleetId: 'p1_1', targetId: 'missing-fleet' },
  'squadron.strike': { fleetId: 'p1_1', targetFleetId: 'missing-fleet' },
  'squadron.return': { fleetId: 'p1_1' },
  'capital.designate': { planetId: 'home_p1' },
  'steward.delegate': { posture: 'defend', until: 10_000 },
  'steward.recall': {},
  'steward.holdpoint': { planetId: 'home_p1', on: true },
  'order.auto': { fleetId: 'p1_1', on: true },
  'order.scramble': { fleetId: 'p1_1', on: true },
  'fleet.forcemarch': { fleetId: 'p1_1', on: true },
  'fleet.instantRepair': { fleetId: 'p1_1' },
  'fleet.repair': { fleetId: 'p1_1' },
  'order.chain': { fleetId: 'p1_1', steps: [] },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

class WireClient {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: Array<(message: ServerMessage) => void> = [];
  readonly socket: WebSocket;
  welcome!: ServerWelcomeMessage;
  state?: GameState;
  clientSeq = 0;

  private constructor(
    url: string,
    readonly matchId: string,
    readonly playerId: string,
    private readonly latencyMs: number,
    private readonly timeoutMs: number,
  ) {
    this.socket = new WebSocket(url);
    this.socket.on('message', (raw: RawData) => {
      const message = JSON.parse(String(raw)) as ServerMessage;
      if ((message.type === 'welcome' || message.type === 'state') && message.state) {
        this.state = message.state;
      } else if (message.type === 'delta' && this.state) {
        this.state = applyDelta(this.state, message.delta);
      }
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.queue.push(message);
    });
  }

  static async connect(
    url: string,
    matchId: string,
    playerId: string,
    latencyMs: number,
    timeoutMs: number,
  ): Promise<WireClient> {
    const client = new WireClient(url, matchId, playerId, latencyMs, timeoutMs);
    await withTimeout(once(client.socket, 'open'), timeoutMs, `${playerId} connect`);
    const first = await client.next();
    if (first.type !== 'welcome' || !first.sessionId) {
      throw new Error(`${playerId} expected a gated welcome`);
    }
    client.welcome = first;
    return client;
  }

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return withTimeout(
      new Promise((resolve) => this.waiters.push(resolve)),
      this.timeoutMs,
      `${this.playerId} message`,
    );
  }

  async nextUntil(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    for (;;) {
      const message = await this.next();
      if (predicate(message)) return message;
    }
  }

  clearMessages(): void {
    this.queue.length = 0;
  }

  async send(type: string, payload: unknown, envelope?: ReturnType<typeof createActionEnvelope>) {
    const sent =
      envelope ??
      createActionEnvelope({
        matchId: this.matchId,
        playerId: this.playerId,
        sessionId: this.welcome.sessionId!,
        clientSeq: (this.clientSeq += 1),
        issuedAt: 1_000,
        type,
        payload,
      });
    await sleep(this.latencyMs);
    this.socket.send(JSON.stringify({ type: 'action.v1', envelope: sent }));
    return sent;
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, 'close');
    this.socket.close();
    await withTimeout(closed, this.timeoutMs, `${this.playerId} close`);
  }
}

function baseView(state: GameState, playerId: string, data: ReturnType<typeof loadShippedData>) {
  const {
    signatures: _signatures,
    remembered: _remembered,
    ...view
  } = visibleState(state, playerId, data);
  return view as GameState;
}

async function waitForClientView(
  client: WireClient,
  expected: GameState,
  timeoutMs: number,
): Promise<boolean> {
  const expectedHash = hashState(expected);
  try {
    await withTimeout(
      (async () => {
        while (!client.state || hashState(client.state) !== expectedHash) await sleep(1);
      })(),
      timeoutMs,
      `${client.playerId} convergence`,
    );
    return true;
  } catch {
    return false;
  }
}

export async function runRehearsal(
  partial: Partial<RehearsalOptions> = {},
): Promise<RehearsalReport> {
  const options = { ...DEFAULTS, ...partial };
  if (!Number.isInteger(options.players) || options.players < 2 || options.players > 10) {
    throw new Error('players must be an integer from 2 to 10');
  }
  const started = performance.now();
  const data = loadShippedData();
  const matchId = `rehearsal-${process.pid}-${Date.now()}`;
  const playerIds = Array.from({ length: options.players }, (_, i) => `p${i + 1}`);
  const secret = hmacSecret('rehearsal-secret-that-is-long-enough');
  const auth = { key: secret, algorithms: ['HS256'], issuer: 'void', audience: 'match' };
  const sign = { key: secret, algorithm: 'HS256' as const, issuer: 'void', audience: 'match' };
  let snapshot: MatchSnapshot | undefined;
  const receipts = new Map<string, StoredReceipt>();
  const pool = options.databaseUrl ? new Pool({ connectionString: options.databaseUrl }) : null;
  const matchStore = pool ? new PostgresMatchStore(pool) : null;
  const receiptStore = pool ? new PostgresReceiptStore(pool) : null;
  if (pool) await migrate(pool);
  let durableWrites = 0;
  let hashMismatches = 0;
  let fogViolations = 0;
  const persist = async (next: MatchSnapshot, receipt: StoredReceipt) => {
    await sleep(options.persistDelayMs);
    snapshot = next;
    receipts.set(receipt.actionId, receipt);
    if (matchStore && receiptStore) {
      await matchStore.save(next);
      await receiptStore.save(matchId, receipt);
    }
    durableWrites += 1;
  };
  const makeRoom = () =>
    createDevMatch(data, {
      id: matchId,
      players: playerIds,
      now: () => 1_000,
      time: 1_000,
      gate: new ActionGate({ payloadValidator: isValidActionPayload }),
      persist,
      actionRateMax: 1_000,
      actionRateWindowMs: 1_000,
      ...(snapshot
        ? {
            initialState: snapshot.state,
            initialSeq: snapshot.seq,
            initialReceipts: [...receipts.values()] as ActionReceipt[],
          }
        : {}),
    });
  const tokenFor = (playerId: string) =>
    signJoinToken({ matchId, playerId }, sign, { ttlSeconds: 300 });

  let room = makeRoom();
  let server = createMultiplayerServer({ room, auth });
  let url = await server.listen();
  const clients: WireClient[] = [];
  try {
    for (const playerId of playerIds) {
      clients.push(
        await WireClient.connect(
          `${url}?token=${await tokenFor(playerId)}`,
          matchId,
          playerId,
          options.latencyMs,
          options.timeoutMs,
        ),
      );
    }

    const envelopes = await Promise.all(
      clients.map((client) =>
        client.send('fleet.orbit', { fleetId: `${client.playerId}_1`, orbit: 'near' }),
      ),
    );
    await withTimeout(
      (async () => {
        while (room.sequence !== options.players) await sleep(1);
      })(),
      options.timeoutMs,
      'concurrent actions',
    );

    await clients[0]!.send('fleet.orbit', { fleetId: 'p1_1', orbit: 'near' }, envelopes[0]);
    const duplicateReply = await clients[0]!.nextUntil((message) => message.type === 'state');
    if (duplicateReply.type !== 'state' || room.sequence !== options.players) {
      throw new Error('duplicate action was not replayed idempotently');
    }

    await clients[0]!.close();
    clients[0] = await WireClient.connect(
      `${url}?token=${await tokenFor('p1')}`,
      matchId,
      'p1',
      options.latencyMs,
      options.timeoutMs,
    );

    const missingPayloads = CLIENT_ACTION_TYPES.filter((type) => !(type in WIRE_PAYLOADS));
    const extraPayloads = Object.keys(WIRE_PAYLOADS).filter(
      (type) => !CLIENT_ACTION_TYPES.includes(type),
    );
    if (missingPayloads.length > 0 || extraPayloads.length > 0) {
      throw new Error(
        `wire payload catalog drift (missing: ${missingPayloads.join(', ') || 'none'}; extra: ${extraPayloads.join(', ') || 'none'})`,
      );
    }
    clients[0]!.clearMessages();
    let wireActionsApplied = 0;
    let wireActionsRejectedByRules = 0;
    for (const type of CLIENT_ACTION_TYPES) {
      const before = room.sequence;
      const envelope = await clients[0]!.send(type, WIRE_PAYLOADS[type]);
      const response = await clients[0]!.nextUntil(
        (message) =>
          message.type === 'delta' ||
          (message.type === 'rejection' && message.actionId === envelope.actionId),
      );
      if (response.type === 'rejection') {
        if (response.code === 'E_BAD_PAYLOAD' || response.code === 'E_UNKNOWN_ACTION') {
          throw new Error(`${type} did not reach its reducer (${response.code})`);
        }
        wireActionsRejectedByRules += 1;
      } else {
        wireActionsApplied += 1;
      }
      if (room.sequence !== before + 1) {
        throw new Error(`${type} stopped before exactly one authoritative reducer step`);
      }
    }

    const expectedSequence = options.players + CLIENT_ACTION_TYPES.length;
    if (room.sequence !== expectedSequence) {
      throw new Error(
        `wire catalog did not consume every action (${room.sequence}/${expectedSequence})`,
      );
    }

    const converged = await Promise.all(
      clients.map((client) =>
        waitForClientView(client, baseView(room.state, client.playerId, data), options.timeoutMs),
      ),
    );
    for (const [index, client] of clients.entries()) {
      if (!converged[index]) hashMismatches += 1;
      for (const other of playerIds.filter((id) => id !== client.playerId)) {
        if (client.state?.fleets[`${other}_1`]) fogViolations += 1;
      }
    }

    await Promise.all(clients.map((client) => client.close()));
    await server.close();
    if (!snapshot) throw new Error('durable snapshot was not written');

    if (matchStore && receiptStore) {
      const restored = await matchStore.load(matchId);
      if (!restored) throw new Error('PostgreSQL did not restore the durable snapshot');
      snapshot = restored;
      receipts.clear();
      for (const receipt of await receiptStore.loadAll(matchId)) {
        receipts.set(receipt.actionId, receipt);
      }
    }

    room = makeRoom();
    server = createMultiplayerServer({ room, auth });
    url = await server.listen();
    for (let i = 0; i < playerIds.length; i += 1) {
      const playerId = playerIds[i]!;
      clients[i] = await WireClient.connect(
        `${url}?token=${await tokenFor(playerId)}`,
        matchId,
        playerId,
        options.latencyMs,
        options.timeoutMs,
      );
      const client = clients[i]!;
      if (client.welcome.seq < expectedSequence || !room.state.fleets.p1_1) {
        throw new Error(
          `restart did not restore the durable snapshot (minimum seq ${expectedSequence}, got ${client.welcome.seq})`,
        );
      }
      const expected = baseView(room.state, client.playerId, data);
      if (hashState(client.welcome.state) !== hashState(expected)) hashMismatches += 1;
      for (const other of playerIds.filter((id) => id !== client.playerId)) {
        if (client.welcome.state.fleets[`${other}_1`]) fogViolations += 1;
      }
      await client.close();
    }

    return {
      players: options.players,
      actionsAccepted: options.players,
      duplicatesPrevented: 1,
      reconnects: 1,
      serverRestarts: 1,
      durableWrites,
      wireActionTypes: CLIENT_ACTION_TYPES.length,
      wireActionsApplied,
      wireActionsRejectedByRules,
      hashMismatches,
      fogViolations,
      finalSequence: room.sequence,
      durationMs: performance.now() - started,
      persistenceBackend: pool ? 'postgres' : 'memory',
    };
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    await server.close().catch(() => undefined);
    if (pool) {
      await pool
        .query('DELETE FROM receipts WHERE match_id = $1', [matchId])
        .catch(() => undefined);
      await pool.query('DELETE FROM matches WHERE id = $1', [matchId]).catch(() => undefined);
      await pool.end().catch(() => undefined);
    }
  }
}
