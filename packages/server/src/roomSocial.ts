/**
 * Ally pings and session chat of one match room — ephemeral relays, never part of the
 * deterministic core. Split out of `matchRoom.ts` (SLIM); the room owns the sockets,
 * the clock and the alliance test and hands them in as {@link RoomSocialHost}.
 */
import { randomBytes } from 'node:crypto';
import { censorChatText } from '@void/protocol';
import type { GameData, GameState, PlayerId } from '@void/shared-core';
import {
  CHAT_TEXT_MAX,
  type ChatMessage,
  type ClientChatSendMessage,
  type ClientPingPlaceMessage,
  type Ping,
  type ServerMessage,
} from './protocol';
import { InMemoryEphemeralStore, type EphemeralStore } from './ephemeral';
import { PerKeyWindow } from './rateLimit';
import type { MatchRoomOptions, RoomPeer } from './matchRoomTypes';

/** The unique tail of a ping/chat id. Random, not a counter: a room-wide (or even
 *  per-sender) counter would show a recipient, by its gaps, how many pings and messages
 *  went to OTHER audiences — DMs and coalition talk included. Clients only dedupe by id. */
function opaqueId(): string {
  return randomBytes(9).toString('base64url');
}

/** Ally-ping tuning (ephemeral, server-side; never part of the deterministic core). */
const PING_DEFAULT_TTL_MS = 5 * 60_000;
const PING_MAX_PER_PLAYER = 8;
const PING_RATE_WINDOW_MS = 2_000;
const PING_RATE_MAX = 4;
const PING_LABEL_MAX = 40;

/** Session-chat tuning (ephemeral relay, same family as pings). The rate limit runs
 *  on WALL clock (flood protection must keep working while the lobby clock is
 *  frozen); the visible back-log is a bounded ring replayed to a (re)joining peer. */
const CHAT_RATE_WINDOW_MS = 4_000;
const CHAT_RATE_MAX = 6;
const CHAT_HISTORY_MAX = 100;

/** What the social relays need from their room. */
export interface RoomSocialHost {
  readonly id: string;
  /** Wall clock (rate limits). */
  now(): number;
  /** Match clock (stamps, ping expiry). */
  clock(): number;
  hasPlayer(playerId: PlayerId): boolean;
  areAllied(a: PlayerId, b: PlayerId): boolean;
  readonly peers: ReadonlyMap<PlayerId, ReadonlySet<RoomPeer>>;
  send(peer: RoomPeer, message: ServerMessage): void;
  readonly data: GameData;
  state(): GameState;
  /** Worlds the player can currently identify (a precise ping needs one). */
  identifiedNodes(playerId: PlayerId): ReadonlySet<string>;
}

export class RoomSocial {
  private readonly pingTtlMs: number;
  /** Ally pings live behind the ephemeral store (in-memory now, Redis later) — never
   *  in GameState, so they can't trip hashState / replay / the schedule. */
  private readonly ephemeral: EphemeralStore;
  /** Per-player placement timestamps, for the (local, single-process) rate limit. */
  private readonly pingWindow = new PerKeyWindow<PlayerId>(PING_RATE_MAX, PING_RATE_WINDOW_MS);
  /** Per-player chat timestamps (WALL clock), for the chat rate limit. */
  private readonly chatWindow = new PerKeyWindow<PlayerId>(CHAT_RATE_MAX, CHAT_RATE_WINDOW_MS);
  /** Bounded session-chat back-log, replayed to a (re)joining peer. Room-local and
   *  ephemeral by design (dies with hibernation, like pings); a Redis-backed
   *  EphemeralStore is the seam that would carry it across processes/restarts. */
  private readonly chatHistory: ChatMessage[] = [];
  private readonly onChat?: (message: Readonly<ChatMessage>) => void;
  private readonly serverChatAllowed?: (playerId: PlayerId) => boolean;

  constructor(
    private readonly host: RoomSocialHost,
    options: Pick<MatchRoomOptions, 'pingTtlMs' | 'ephemeral' | 'onChat' | 'serverChatAllowed'>,
  ) {
    this.onChat = options.onChat;
    this.serverChatAllowed = options.serverChatAllowed;
    this.pingTtlMs = options.pingTtlMs ?? PING_DEFAULT_TTL_MS;
    // Align store expiry with the room's (lobby-adjusted) clock, not raw wall time.
    this.ephemeral = options.ephemeral ?? new InMemoryEphemeralStore(() => host.clock());
  }
  // --- ally pings (ephemeral, server-side; never part of the deterministic core) ---


  /** A ping is visible to its owner and the owner's allies; never to enemies. The
   *  privacy guarantee is enforced HERE (server-side): an enemy is never sent the
   *  ping at all, exactly like fog. Allies see it even on tiles they can't see —
   *  that is the whole point ("look here"). */
  private canSeePing(recipient: PlayerId, ping: Ping): boolean {
    return this.host.areAllied(recipient, ping.owner);
  }

  /** Relay a ping message to every connected peer who may see that ping. */
  private relayToViewers(ping: Ping, message: ServerMessage): void {
    for (const [pid, peers] of this.host.peers) {
      if (!this.canSeePing(pid, ping)) continue;
      for (const peer of peers) this.host.send(peer, message);
    }
  }

  private pingKey(pingId: string): string {
    return `match:${this.host.id}:ping:${pingId}`;
  }
  private get pingPrefix(): string {
    return `match:${this.host.id}:ping:`;
  }

  async handlePingPlace(
    playerId: PlayerId,
    peer: RoomPeer,
    message: ClientPingPlaceMessage,
  ): Promise<void> {
    if (!this.host.hasPlayer(playerId)) {
      this.host.send(peer, { type: 'error', matchId: this.host.id, code: 'E_FORBIDDEN' });
      return;
    }
    const now = this.host.clock();
    // rate limit (local, single-process): at most PING_RATE_MAX placements per window.
    // Moves into the ephemeral store as an atomic counter once there's >1 process.
    // WALL clock, like chat: on the frozen lobby clock the window would never
    // expire and PING_RATE_MAX placements would lock the player out for good.
    const wall = this.host.now();
    if (this.pingWindow.limited(playerId, wall)) {
      this.host.send(peer, { type: 'error', matchId: this.host.id, code: 'E_PING_RATE' });
      return;
    }
    const draft = message.ping;
    if (draft.kind === 'move' && draft.to === undefined) {
      this.host.send(peer, { type: 'error', matchId: this.host.id, code: 'E_PING_TARGET' });
      return;
    }
    if (draft.kind === 'build') {
      const building = draft.payload?.building;
      if (typeof building !== 'string' || !this.host.data.buildings[building]) {
        this.host.send(peer, { type: 'error', matchId: this.host.id, code: 'E_PING_BUILD' });
        return;
      }
    }
    // Node anchors must reference a real planet the owner can currently identify —
    // you can't pin a precise marker on a world you've never scouted. Point anchors
    // ({x,y}) are always allowed; they reveal nothing hidden.
    const seen = this.host.identifiedNodes(playerId);
    for (const anchor of [draft.target, draft.to]) {
      if (!anchor || anchor.node === undefined) continue;
      if (!this.host.state().planets[anchor.node]) {
        this.host.send(peer, { type: 'error', matchId: this.host.id, code: 'E_PING_TARGET' });
        return;
      }
      if (!seen.has(anchor.node)) {
        this.host.send(peer, { type: 'error', matchId: this.host.id, code: 'E_PING_UNSEEN' });
        return;
      }
    }
    // Evict this player's oldest pings down to the cap (never hard-block the UX).
    const mine = (await this.ephemeral.entries<Ping>(this.pingPrefix))
      .map((e) => e.value)
      .filter((p) => p.owner === playerId)
      .sort((a, b) => a.createdAt - b.createdAt);
    while (mine.length >= PING_MAX_PER_PLAYER) {
      const old = mine.shift()!;
      await this.ephemeral.delete(this.pingKey(old.id));
      this.relayToViewers(old, {
        type: 'ping.removed',
        matchId: this.host.id,
        pingId: old.id,
        reason: 'cleared',
      });
    }
    const ping: Ping = {
      id: `ping:${playerId}:${opaqueId()}`,
      owner: playerId,
      kind: draft.kind,
      target: draft.target,
      createdAt: now,
      expiresAt: now + this.pingTtlMs,
    };
    if (draft.to) ping.to = draft.to;
    if (draft.payload?.building) ping.payload = { building: draft.payload.building };
    if (draft.label) ping.label = censorChatText(draft.label, PING_LABEL_MAX);
    await this.ephemeral.set(this.pingKey(ping.id), ping, this.pingTtlMs);
    this.pingWindow.record(playerId, wall);
    this.relayToViewers(ping, { type: 'ping.added', matchId: this.host.id, ping });
  }

  async handlePingClear(
    playerId: PlayerId,
    peer: RoomPeer,
    pingId?: string,
  ): Promise<void> {
    const entries = await this.ephemeral.entries<Ping>(this.pingPrefix);
    if (pingId !== undefined && !entries.some(({ value }) => value.id === pingId)) {
      // A ping can expire between the client's last snapshot and this request.
      // Confirm absence ONLY to its requester; never relay an unverified id to allies.
      this.host.send(peer, { type: 'ping.removed', matchId: this.host.id, pingId, reason: 'expired' });
      return;
    }
    for (const { value: ping } of entries) {
      if (ping.owner !== playerId) continue;
      if (pingId !== undefined && ping.id !== pingId) continue;
      await this.ephemeral.delete(this.pingKey(ping.id));
      this.relayToViewers(ping, {
        type: 'ping.removed',
        matchId: this.host.id,
        pingId: ping.id,
        reason: 'cleared',
      });
    }
  }

  /** On join: send the recipient every currently-visible ping. The store drops
   *  expired ones lazily, so there is no separate sweep; the client fades a ping on
   *  its own `expiresAt`. */
  async sendVisiblePings(playerId: PlayerId, peer: RoomPeer): Promise<void> {
    for (const { value: ping } of await this.ephemeral.entries<Ping>(this.pingPrefix)) {
      if (this.canSeePing(playerId, ping)) {
        this.host.send(peer, { type: 'ping.added', matchId: this.host.id, ping });
      }
    }
  }

  // --- session chat (ephemeral relay; never part of the deterministic core) -----

  /** `session` reaches every seat; `dm` exactly the two parties; `coalition` the
   *  sender's CURRENT allies. Enforced HERE (server-side), like fog: a peer outside
   *  the channel is never sent the message at all. */
  private canSeeChat(recipient: PlayerId, message: ChatMessage): boolean {
    if (message.channel === 'session') return true;
    if (message.channel === 'dm') return recipient === message.from || recipient === message.to;
    return this.host.areAllied(recipient, message.from);
  }

  handleChatSend(playerId: PlayerId, peer: RoomPeer, message: ClientChatSendMessage): void {
    if (!this.host.hasPlayer(playerId)) {
      this.host.send(peer, { type: 'error', matchId: this.host.id, code: 'E_FORBIDDEN' });
      return;
    }
    // Rate limit on WALL clock — the lobby freeze stops the match clock, not the
    // need for flood protection (people talk in the lobby; a frozen window would
    // never expire and lock everyone out after CHAT_RATE_MAX lines).
    const wall = this.host.now();
    if (this.chatWindow.limited(playerId, wall)) {
      this.host.send(peer, { type: 'error', matchId: this.host.id, code: 'E_CHAT_RATE' });
      return;
    }
    const text = censorChatText(message.text, CHAT_TEXT_MAX);
    if (!text) {
      this.host.send(peer, { type: 'error', matchId: this.host.id, code: 'E_CHAT_TEXT' });
      return;
    }
    const msg: ChatMessage = {
      id: `chat:${playerId}:${opaqueId()}`,
      from: playerId,
      channel: message.channel,
      text,
      at: this.host.clock(), // display stamp in match time, like Ping.createdAt
    };
    if (message.channel === 'dm') {
      // A DM must name a real, other seat — the sender is a recipient implicitly.
      if (message.to === undefined || message.to === playerId || !this.host.hasPlayer(message.to)) {
        this.host.send(peer, { type: 'error', matchId: this.host.id, code: 'E_CHAT_TARGET' });
        return;
      }
      msg.to = message.to;
    }
    this.chatWindow.record(playerId, wall);
    this.relayChat(msg);
    try {
      this.onChat?.(Object.freeze({ ...msg }));
    } catch {
      // An optional responder must never break an already accepted human message.
    }
  }

  /** Host-only DM, using the ordinary privacy, sanitization, flood limit and
   *  bounded reconnect history. Does not create peers or emit human joins. */
  sendServerChat(from: PlayerId, to: PlayerId, rawText: string): boolean {
    if (
      !this.serverChatAllowed?.(from) ||
      from === to ||
      this.host.state().match.status === 'ended' ||
      this.host.state().players[from]?.status !== 'active' ||
      this.host.state().players[to]?.status !== 'active'
    )
      return false;
    const wall = this.host.now();
    if (this.chatWindow.limited(from, wall)) return false;
    const text = censorChatText(rawText, CHAT_TEXT_MAX);
    if (!text) return false;
    this.chatWindow.record(from, wall);
    this.relayChat({
      id: `chat:${from}:${opaqueId()}`,
      from,
      to,
      channel: 'dm',
      text,
      at: this.host.clock(),
    });
    return true;
  }

  private relayChat(msg: ChatMessage): void {
    this.chatHistory.push(msg);
    if (this.chatHistory.length > CHAT_HISTORY_MAX) this.chatHistory.shift();
    for (const [pid, peers] of this.host.peers) {
      if (!this.canSeeChat(pid, msg)) continue;
      for (const p of peers) this.host.send(p, { type: 'chat.msg', matchId: this.host.id, message: msg });
    }
  }

  /** On join: replay the visible back-log so a (re)connecting player has the talk.
   *  Channel visibility is re-evaluated NOW — a fresh ally reads coalition history,
   *  an ex-ally no longer does. The client dedupes by message id. */
  sendVisibleChat(playerId: PlayerId, peer: RoomPeer): void {
    for (const msg of this.chatHistory) {
      if (this.canSeeChat(playerId, msg)) {
        this.host.send(peer, { type: 'chat.msg', matchId: this.host.id, message: msg });
      }
    }
  }

  /** A released empire may be inherited by another account; private talk may not
   *  (`MatchRoom.evict`). Drops every DM to or from the seat out of the back-log. */
  forgetDirectMessages(playerId: PlayerId): void {
    for (let i = this.chatHistory.length - 1; i >= 0; i -= 1) {
      const message = this.chatHistory[i]!;
      if (message.channel === 'dm' && (message.from === playerId || message.to === playerId))
        this.chatHistory.splice(i, 1);
    }
  }
}
