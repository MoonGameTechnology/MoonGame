import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInitialState,
  createKernel,
  diplomacyModule,
  getOffer,
  getStance,
  pairKey,
  type GameState,
} from '@void/shared-core';
import type { ChatMessage } from '@void/protocol';
import { MatchRoom, type MatchRoomOptions, type RoomPeer } from './matchRoom';
import { loadShippedData } from './scenario';
import { botChatIntent, createBotSocial, type BotSocialOptions } from './botSocial';

class Peer implements RoomPeer {
  messages: { type: string; message?: ChatMessage }[] = [];
  send(raw: string): void {
    this.messages.push(JSON.parse(raw));
  }
  close(): void {}
  texts(): string[] {
    return this.messages.flatMap((m) => (m.message ? [m.message.text] : []));
  }
}

function fixture(
  options: {
    stance?: 'war' | 'peace' | 'pact';
    behavior?: BotSocialOptions['behavior'];
    persist?: MatchRoomOptions['persist'];
    render?: BotSocialOptions['render'];
  } = {},
) {
  const data = loadShippedData();
  const state: GameState = {
    ...createInitialState({
      seed: 'social',
      version: { data: data.version, manifest: '1' },
      time: 0,
    }),
    players: Object.fromEntries(
      ['human', 'other', 'bot', 'bot2'].map((id) => [
        id,
        {
          id,
          name: id,
          faction: 'vanguard',
          status: 'active',
          resources: {},
        },
      ]),
    ),
    planets: {},
    diplomacy: { [pairKey('human', 'bot')]: options.stance ?? 'peace' },
  };
  const observations: string[] = [];
  const room = new MatchRoom({
    id: 'social',
    initialState: state,
    data,
    kernel: createKernel([diplomacyModule]),
    now: () => Date.now(),
    initiallyStarted: true,
    persist: options.persist,
    emitStateHash: false,
    observe: (event) => observations.push(event.kind),
    serverChatAllowed: (id) => id === 'bot' || id === 'bot2',
    onChat: (message) => social.onMessage(message),
  });
  const failures: string[] = [];
  const social = createBotSocial({
    room,
    isBot: (id) => id === 'bot' || id === 'bot2',
    render: options.render ?? ((key) => key),
    behavior: options.behavior,
    now: () => Date.now(),
    onError: (code) => failures.push(code),
  });
  const human = new Peer(),
    other = new Peer();
  room.addPeer('human', human);
  room.addPeer('other', other);
  const send = (text: string, to = 'bot', from = 'human', channel = 'dm') =>
    room.receive(
      from,
      from === 'human' ? human : other,
      JSON.stringify({ type: 'chat.send', text, to, channel }),
    );
  const deliver = () => vi.advanceTimersByTimeAsync(1500);
  return { room, social, human, other, send, deliver, observations, failures };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('small bot conversation grammar', () => {
  it.each([
    ['привет', 'greeting', 'ru'],
    ['Hello commander', 'greeting', 'en'],
    ['давай мир', 'peace', 'ru'],
    ['предлагаю пакт', 'pact', 'ru'],
    ['/peace', 'peace', 'en'],
    ['/мир', 'peace', 'ru'],
    ['make peace', 'peace', 'en'],
    ['offer pact', 'pact', 'en'],
    ['объявляю тебе войну', 'war', 'ru'],
    ['I declare war', 'war', 'en'],
    ['/war', 'war', 'en'],
    ['хочу торговать', 'trade', 'ru'],
    ['trade', 'trade', 'en'],
    ['alliance', 'alliance', 'en'],
  ])('recognises a direct phrase %s', (text, intent, locale) => {
    expect(botChatIntent(text!)).toEqual({ intent, locale });
  });
  it.each([
    'не хочу мира',
    'не объявляй войну',
    'не хочу войны',
    'он написал война',
    'как объявить войну?',
    'война',
    'он написал объявляю войну',
    '«объявляю войну»',
    '"declare war"',
    'declare war?',
    'how do I declare war?',
    'I do not want peace',
    'never make peace',
    'no pact',
    'he said make peace',
    "'make peace'",
    'мир',
    'peace',
    'пакт о ненападении',
    'non aggression pact',
    '`declare war`',
    '(declare war)',
    'declare war？',
    'declare war؟',
  ])('does not turn negation, quotation or discussion into an order: %s', (text) => {
    expect(botChatIntent(text).intent).toBe('help');
  });
});

describe('bounded persistent bot DM responder', () => {
  it('uses ordinary private chat/history without synthetic human connections or reply loops', async () => {
    const f = fixture();
    await f.send('привет');
    expect(f.human.texts()).toEqual(['привет']);
    await f.deliver();
    expect(f.human.texts()).toEqual(['привет', 'bot-chat.greeting']);
    expect(f.other.texts()).toEqual([]);
    expect(f.room.peerCount).toBe(2);
    expect(f.observations.filter((kind) => kind === 'join')).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    f.room.removePeer('human', f.human);
    const reconnected = new Peer();
    f.room.addPeer('human', reconnected);
    expect(reconnected.texts()).toEqual(['привет', 'bot-chat.greeting']);
    expect(f.failures).toEqual([]);
  });

  it('never responds to session/coalition messages, another human or bot-origin traffic', async () => {
    const f = fixture();
    await f.send('hello', 'bot', 'human', 'session');
    await f.send('hello', 'bot', 'human', 'coalition');
    await f.send('hello', 'other');
    f.social.onMessage({
      id: 'internal',
      from: 'bot',
      to: 'human',
      channel: 'dm',
      text: 'hello',
      at: 0,
    });
    await f.deliver();
    expect(f.human.texts().some((text) => text.startsWith('bot-chat.'))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps exactly one pending response per room, and pair/bot cooldowns on real time', async () => {
    const f = fixture();
    await f.send('hello');
    await f.send('hello', 'bot2', 'other');
    expect(vi.getTimerCount()).toBe(1);
    await f.deliver();
    expect(f.other.texts()).toEqual(['hello']);
    await f.send('hello');
    await f.send('hello', 'bot', 'other');
    await f.deliver();
    expect(f.human.texts().filter((text) => text === 'bot-chat.greeting')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(12_000);
    await f.send('hello');
    await f.deliver();
    expect(f.human.texts().filter((text) => text === 'bot-chat.greeting')).toHaveLength(2);
  });

  it('bounds room replies and cooldown bookkeeping under many different accepted senders', async () => {
    const delivered: string[] = [];
    const base = fixture();
    const state = base.room.state;
    for (let i = 0; i < 500; i++)
      state.players['h' + i] = {
        id: 'h' + i,
        name: 'h',
        faction: 'vanguard',
        status: 'active',
        resources: {},
      };
    const social = createBotSocial({
      room: {
        state,
        submitServerAction: async () => ({ ok: false }),
        sendServerChat: (_from, _to, text) => {
          delivered.push(text);
          return true;
        },
      },
      isBot: (id) => id === 'bot' || id === 'bot2',
      render: (key) => key,
    });
    for (let i = 0; i < 500; i++) {
      social.onMessage({
        id: String(i),
        from: 'h' + i,
        to: i % 2 ? 'bot' : 'bot2',
        channel: 'dm',
        text: 'hello',
        at: 0,
      });
      expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
      await vi.advanceTimersByTimeAsync(1600);
      if (i === 29) break;
    }
    expect(delivered.length).toBeLessThanOrEqual(12);
    social.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels delayed work on shutdown, elimination and match end', async () => {
    const stopped = fixture();
    await stopped.send('давай мир');
    stopped.social.stop();
    await stopped.deliver();
    expect(stopped.human.texts()).toEqual(['давай мир']);
    const ended = fixture();
    await ended.send('hello');
    ended.room.state.match.status = 'ended';
    await ended.deliver();
    expect(ended.human.texts()).toEqual(['hello']);
    const dead = fixture();
    await dead.send('hello');
    dead.room.state.players.bot!.status = 'defeated';
    await dead.deliver();
    expect(dead.human.texts()).toEqual(['hello']);
  });

  it('revoked consent cannot act for a new owner of the same seat', async () => {
    const f = fixture({ stance: 'war' });
    await f.send('давай мир');
    f.room.evict('human');
    const next = new Peer();
    f.room.addPeer('human', next);
    await f.deliver();
    expect(getStance(f.room.state, 'human', 'bot')).toBe('war');
    expect(getOffer(f.room.state, 'human', 'bot')).toBeNull();
    expect(next.texts()).toEqual(['давай мир']);
    expect(f.observations.includes('action')).toBe(false);
  });

  it('commits real matching peace offers before confirming, without bypassing consent', async () => {
    const durable: string[] = [];
    const f = fixture({
      stance: 'war',
      persist: async (_snapshot, receipt) => {
        durable.push(receipt.playerId);
      },
    });
    await f.send('/peace');
    await f.deliver();
    expect(durable).toEqual(['human', 'bot']);
    expect(getStance(f.room.state, 'human', 'bot')).toBe('peace');
    expect(getOffer(f.room.state, 'human', 'bot')).toBeNull();
    expect(getOffer(f.room.state, 'bot', 'human')).toBeNull();
    expect(f.human.texts()).toEqual(['/peace', 'bot-chat.peace-accepted']);
  });

  it('refuses via the core decline action and never claims peace when it stayed at war', async () => {
    const f = fixture({ stance: 'war', behavior: () => false });
    await f.send('давай мир');
    await f.deliver();
    expect(getStance(f.room.state, 'human', 'bot')).toBe('war');
    expect(getOffer(f.room.state, 'human', 'bot')).toBeNull();
    expect(f.human.texts()).toEqual(['давай мир', 'bot-chat.negotiation-refused']);
  });

  it('negotiates a real pact, and a unilateral explicit war tears it down', async () => {
    const f = fixture();
    await f.send('предлагаю пакт');
    await f.deliver();
    expect(getStance(f.room.state, 'human', 'bot')).toBe('pact');
    expect(f.human.texts().at(-1)).toBe('bot-chat.pact-accepted');
    await vi.advanceTimersByTimeAsync(15_000);
    await f.send('объявляю войну');
    await f.deliver();
    expect(getStance(f.room.state, 'human', 'bot')).toBe('war');
    expect(f.human.texts().at(-1)).toBe('bot-chat.war-confirmed');
  });

  it('a failed durable write keeps the old stance and produces no false acceptance', async () => {
    const f = fixture({
      stance: 'war',
      persist: async () => {
        throw new Error('private DB detail');
      },
    });
    await f.send('make peace');
    await f.deliver();
    expect(getStance(f.room.state, 'human', 'bot')).toBe('war');
    expect(getOffer(f.room.state, 'human', 'bot')).toBeNull();
    expect(f.human.texts()).toEqual(['make peace', 'bot-chat.negotiation-failed']);
  });

  it('discussion, unsupported alliances and trade never invent game actions or transfers', async () => {
    const f = fixture({ stance: 'war' });
    const before = structuredClone(f.room.state);
    await f.send('как объявить войну?');
    await f.deliver();
    expect(f.human.texts().at(-1)).toBe('bot-chat.help');
    await vi.advanceTimersByTimeAsync(15_000);
    await f.send('trade');
    await f.deliver();
    expect(f.human.texts().at(-1)).toBe('bot-chat.trade');
    await vi.advanceTimersByTimeAsync(15_000);
    await f.send('alliance');
    await f.deliver();
    expect(f.human.texts().at(-1)).toBe('bot-chat.alliance-refused');
    expect(f.room.state).toEqual(before);
    expect(f.observations.includes('action')).toBe(false);
  });

  it('localizes independently per DM, and contains responder failures without a loop', async () => {
    const render = vi.fn((key: string, locale: string) => key + ':' + locale);
    const f = fixture({ render });
    await f.send('привет');
    await f.deliver();
    expect(f.human.texts().at(-1)).toBe('bot-chat.greeting:ru');
    await vi.advanceTimersByTimeAsync(15_000);
    await f.send('hello');
    await f.deliver();
    expect(f.human.texts().at(-1)).toBe('bot-chat.greeting:en');
    render.mockImplementation(() => {
      throw new Error('private');
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await f.send('hello');
    await f.deliver();
    expect(f.failures).toEqual(['E_BOT_REPLY']);
    expect(vi.getTimerCount()).toBe(0);
  });
});
