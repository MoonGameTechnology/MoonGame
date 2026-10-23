import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  createKernel,
  pairKey,
  type GameState,
  type Planet,
  type Player,
} from '@void/shared-core';
import { MatchRoom, type MatchRoomOptions, type RoomPeer } from './matchRoom';
import { DEV_MODULES, loadShippedData } from './scenario';

/**
 * Session chat is an EPHEMERAL server relay (same family as ally pings): the room
 * stamps id/at, clamps the text and decides recipients server-side — `session`
 * reaches everyone, `coalition` the sender's live allies (static team OR an
 * in-state alliance), `dm` exactly the two parties. A bounded back-log replays to
 * a (re)joining peer. These tests assert the privacy boundary, the join replay,
 * the clamp and the (wall-clock) rate limit.
 */

interface WireMsg {
  type: string;
  code?: string;
  message?: { id: string; from: string; channel: string; to?: string; text: string; at: number };
}

class Peer implements RoomPeer {
  readonly msgs: WireMsg[] = [];
  send(data: string): void {
    this.msgs.push(JSON.parse(data) as WireMsg);
  }
  close(): void {}
  ofType(type: string): WireMsg[] {
    return this.msgs.filter((m) => m.type === type);
  }
  chatTexts(): string[] {
    return this.ofType('chat.msg').map((m) => m.message!.text);
  }
}

const planet = (id: string, owner: string, x: number): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  links: [],
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
});

function makeRoom(
  opts: {
    teams?: Record<string, string>;
    alliance?: [string, string];
    now?: () => number;
    onChat?: MatchRoomOptions['onChat'];
    serverChatAllowed?: MatchRoomOptions['serverChatAllowed'];
  } = {},
): MatchRoom {
  const data = loadShippedData();
  const base = createInitialState({
    seed: 'chat',
    version: { data: data.version, manifest: '1' },
    time: 0,
  });
  const players: Record<string, Player> = {
    green: { id: 'green', name: 'G', faction: 'vanguard', status: 'active', resources: {} },
    blue: { id: 'blue', name: 'B', faction: 'vanguard', status: 'active', resources: {} },
    red: { id: 'red', name: 'R', faction: 'vanguard', status: 'active', resources: {} },
  };
  const planets: Record<string, Planet> = {
    home_green: planet('home_green', 'green', 0),
    home_blue: planet('home_blue', 'blue', 100),
    home_red: planet('home_red', 'red', 900),
  };
  const state: GameState = { ...base, players, planets };
  if (opts.alliance) {
    state.diplomacy = { [pairKey(opts.alliance[0], opts.alliance[1])]: 'alliance' };
  }
  return new MatchRoom({
    id: 't',
    initialState: state,
    kernel: createKernel(DEV_MODULES),
    data,
    now: opts.now ?? (() => 0),
    teams: opts.teams,
    onChat: opts.onChat,
    serverChatAllowed: opts.serverChatAllowed,
  });
}

const say = (channel: string, text: string, to?: string): string =>
  JSON.stringify(
    to === undefined
      ? { type: 'chat.send', channel, text }
      : { type: 'chat.send', channel, to, text },
  );

describe('session chat relay', () => {
  it('notifies only for accepted, sanitized human messages and isolates callback errors', async () => {
    const accepted: Readonly<{ text: string }>[] = [];
    const room = makeRoom({
      onChat(message) {
        accepted.push(message);
        throw new Error('private');
      },
    });
    const g = new Peer();
    room.addPeer('green', g);
    await room.receive('green', g, say('dm', '  hello\u0000 ', 'blue'));
    await room.receive('green', g, say('dm', 'invalid', 'ghost'));
    await room.receive('green', g, say('session', ' '));
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.text).toBe('hello');
    expect(Object.isFrozen(accepted[0])).toBe(true);
    expect(g.chatTexts()).toEqual(['hello']);
    expect(g.ofType('error').map((m) => m.code)).toEqual(['E_CHAT_TARGET', 'E_CHAT_TEXT']);
  });

  it('sends server DMs through the ordinary private history without peers or recursive callbacks', async () => {
    let calls = 0;
    const room = makeRoom({
      onChat: () => {
        calls++;
      },
      serverChatAllowed: (id) => id === 'blue',
    });
    const g = new Peer(),
      r = new Peer();
    room.addPeer('green', g);
    room.addPeer('red', r);
    expect(room.sendServerChat('red', 'green', 'forged')).toBe(false);
    expect(room.sendServerChat('blue', 'ghost', 'bad')).toBe(false);
    expect(room.sendServerChat('blue', 'blue', 'self')).toBe(false);
    expect(room.sendServerChat('blue', 'green', '  hello\u0000  ')).toBe(true);
    expect(g.chatTexts()).toEqual(['hello']);
    expect(r.chatTexts()).toEqual([]);
    expect(calls).toBe(0);
    expect(room.peerCount).toBe(2);
    const reconnect = new Peer();
    room.addPeer('green', reconnect);
    expect(reconnect.chatTexts()).toEqual(['hello']);
    for (let i = 0; i < 5; i++) expect(room.sendServerChat('blue', 'green', 'line')).toBe(true);
    expect(room.sendServerChat('blue', 'green', 'flood')).toBe(false);
    expect(makeRoom().sendServerChat('blue', 'green', 'disabled')).toBe(false);
  });

  it('sanitizes controls before relay/history, preserving literal plain-text markup', async () => {
    const room = makeRoom();
    const g = new Peer();
    room.addPeer('green', g);
    await room.receive('green', g, say('session', '  hello\u0000\u200B\u202E world  '));
    await room.receive('green', g, say('session', '<img src=x onerror=alert(1)>'));
    expect(g.chatTexts()).toEqual(['hello world', '<img src=x onerror=alert(1)>']);
    const late = new Peer();
    room.addPeer('blue', late);
    expect(late.chatTexts()).toEqual(g.chatTexts());
    await room.receive('green', g, say('session', '\u0000\u200B'));
    expect(g.ofType('error').at(-1)?.code).toBe('E_CHAT_TEXT');
  });
  it('masks multilingual abuse before delivery, replay and optional human chat callbacks', async () => {
    const seen: string[] = [];
    const room = makeRoom({ onChat: (message) => { seen.push(message.text); } });
    const g = new Peer();
    const b = new Peer();
    room.addPeer('green', g);
    room.addPeer('blue', b);
    await room.receive('green', g, say('session', 'Hello f.u.c.k, scheiße and Scunthorpe!'));
    expect(g.chatTexts()).toEqual(['Hello ***, *** and Scunthorpe!']);
    expect(b.chatTexts()).toEqual(g.chatTexts());
    expect(seen).toEqual(g.chatTexts());

    const reconnect = new Peer();
    room.addPeer('blue', reconnect);
    expect(reconnect.chatTexts()).toEqual(g.chatTexts());
  });

  it('masks host-only chat through the same boundary, without affecting DM privacy', () => {
    const room = makeRoom({ serverChatAllowed: (id) => id === 'blue' });
    const g = new Peer(), r = new Peer();
    room.addPeer('green', g);
    room.addPeer('red', r);
    expect(room.sendServerChat('blue', 'green', 'kurwa and nice move')).toBe(true);
    expect(g.chatTexts()).toEqual(['*** and nice move']);
    expect(r.chatTexts()).toEqual([]);
  });

  it('rejects an abusive coalition description before applying the public state', () => {
    const room = makeRoom();
    const action = (sequence: number, type: string, payload: unknown) => ({
      id: `t:green:${sequence}`, type, playerId: 'green', payload, issuedAt: 0,
    });
    expect(room.submitAction('green', action(1, 'coalition.create', {})).ok).toBe(true);
    const denied = room.submitAction('green',
      action(2, 'coalition.edit', { emblem: 'star', description: 'f.u.c.k the world' }));
    expect(denied).toMatchObject({ ok: false, code: 'E_BAD_PAYLOAD' });
    const accepted = room.submitAction('green',
      action(3, 'coalition.edit', { emblem: 'star', description: 'Peaceful explorers' }));
    expect(accepted.ok).toBe(true);
  });

  it('session channel reaches every seat, including the sender (the echo renders it)', async () => {
    const room = makeRoom();
    const g = new Peer();
    const b = new Peer();
    const r = new Peer();
    room.addPeer('green', g);
    room.addPeer('blue', b);
    room.addPeer('red', r);

    await room.receive('green', g, say('session', 'gl hf'));

    for (const peer of [g, b, r]) expect(peer.chatTexts()).toEqual(['gl hf']);
    const msg = g.ofType('chat.msg')[0]!.message!;
    expect(msg.from).toBe('green');
    expect(msg.channel).toBe('session');
    expect(msg.id).toMatch(/^chat:green:/);
  });

  it("an id tells a reader nothing about talk they weren't sent", async () => {
    // green whispers to red twice, then speaks to everyone. blue must not be able to count
    // the whispers off the session message's id (a counter would read `chat:green:2`).
    const room = makeRoom();
    const g = new Peer();
    const b = new Peer();
    const r = new Peer();
    room.addPeer('green', g);
    room.addPeer('blue', b);
    room.addPeer('red', r);
    await room.receive('green', g, say('dm', 'one', 'red'));
    await room.receive('green', g, say('dm', 'two', 'red'));
    await room.receive('green', g, say('session', 'all'));
    const seen = b.ofType('chat.msg').map((m) => m.message!.id);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^chat:green:[A-Za-z0-9_-]+$/);
    expect(seen[0]!.split(':')[2]).not.toMatch(/^\d+$/);
    // Still unique — the client dedupes by id.
    const ids = g.ofType('chat.msg').map((m) => m.message!.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('coalition reaches static-team allies and LIVE in-state alliances — never enemies', async () => {
    // green+blue allied through the diplomacy stance map (no static teams at all)
    const room = makeRoom({ alliance: ['green', 'blue'] });
    const g = new Peer();
    const b = new Peer();
    const r = new Peer();
    room.addPeer('green', g);
    room.addPeer('blue', b);
    room.addPeer('red', r);

    await room.receive('green', g, say('coalition', 'push mid'));

    expect(g.chatTexts()).toEqual(['push mid']); // own echo
    expect(b.chatTexts()).toEqual(['push mid']); // live ally
    expect(r.chatTexts()).toEqual([]); // enemy is never sent it
  });

  it('a dm reaches exactly the two parties; a bad addressee is E_CHAT_TARGET', async () => {
    const room = makeRoom();
    const g = new Peer();
    const b = new Peer();
    const r = new Peer();
    room.addPeer('green', g);
    room.addPeer('blue', b);
    room.addPeer('red', r);

    await room.receive('green', g, say('dm', 'nice opening', 'blue'));
    expect(g.chatTexts()).toEqual(['nice opening']);
    expect(b.chatTexts()).toEqual(['nice opening']);
    expect(r.chatTexts()).toEqual([]);

    await room.receive('green', g, say('dm', 'to nobody', 'ghost'));
    await room.receive('green', g, say('dm', 'to myself', 'green'));
    expect(g.ofType('error').filter((m) => m.code === 'E_CHAT_TARGET')).toHaveLength(2);
  });

  it('replays the visible back-log on join — dm to its parties, coalition never to enemies', async () => {
    const room = makeRoom({ alliance: ['green', 'blue'] });
    const g = new Peer();
    room.addPeer('green', g);
    await room.receive('green', g, say('session', 'hello all'));
    await room.receive('green', g, say('coalition', 'ally plan'));
    await room.receive('green', g, say('dm', 'for blue only', 'blue'));

    const b = new Peer();
    room.addPeer('blue', b); // ally + dm addressee, joins AFTER the talk
    expect(b.chatTexts()).toEqual(['hello all', 'ally plan', 'for blue only']);

    const r = new Peer();
    room.addPeer('red', r); // enemy: session history only
    expect(r.chatTexts()).toEqual(['hello all']);
  });

  it('clamps oversized text and refuses an empty line (E_CHAT_TEXT)', async () => {
    const room = makeRoom();
    const g = new Peer();
    room.addPeer('green', g);

    await room.receive('green', g, say('session', 'x'.repeat(1000)));
    expect(g.chatTexts()[0]).toHaveLength(240);

    await room.receive('green', g, say('session', '   '));
    expect(g.ofType('error').some((m) => m.code === 'E_CHAT_TEXT')).toBe(true);
  });

  it('rate-limits a flood on the WALL clock (keeps working in a frozen lobby)', async () => {
    const room = makeRoom(); // now() is frozen at 0 — like a lobby-frozen match clock
    const g = new Peer();
    room.addPeer('green', g);
    for (let i = 0; i < 7; i++) await room.receive('green', g, say('session', `line ${i}`));
    expect(g.chatTexts()).toHaveLength(6);
    expect(g.ofType('error').some((m) => m.code === 'E_CHAT_RATE')).toBe(true);
  });
});
