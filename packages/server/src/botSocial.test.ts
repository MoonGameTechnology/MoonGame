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
import {
  botChatIntent,
  botReplyDelayMs,
  botSocialAvailable,
  createBotSocial,
  BOT_REPLY_DELAY_MAX_MS,
  BOT_REPLY_DELAY_MIN_MS,
  type BotSocialOptions,
} from './botSocial';

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
    availability?: BotSocialOptions['availability'];
    replyDelay?: BotSocialOptions['replyDelay'];
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
    render: options.render ?? ((key) => key.replace(/\.(?:casual|short)$/, '')),
    availability: options.availability ?? (() => true),
    replyDelay: options.replyDelay ?? (() => 1500),
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

describe('English-only small bot conversation grammar', () => {
  it.each([
    ['Hello commander', 'greeting'],
    ['yo bro', 'greeting'],
    ['sup', 'greeting'],
    ['/peace', 'peace'],
    ['make peace', 'peace'],
    ['offer pact', 'pact'],
    ['I declare war', 'war'],
    ['/war', 'war'],
    ['trade', 'trade'],
    ['alliance', 'alliance'],
  ])('recognises an English phrase %s', (text, intent) => {
    expect(botChatIntent(text!)).toEqual({ intent, locale: 'en' });
  });
  it.each([
    'привет',
    'давай мир',
    '/мир',
    'предлагаю пакт',
    'объявляю войну',
    'こんにちは',
    '你好',
    'مرحبا',
    'hola amigo',
    'bonjour',
    'buenos días',
    'quiero paz',
    'guten tag',
    'ciao',
    'merhaba',
    'privet',
    'comment ca va',
    'szia baratom',
  ])('asks for English instead of interpreting a foreign message: %s', (text) => {
    expect(botChatIntent(text)).toEqual({ intent: 'english-only', locale: 'en' });
  });
  it.each([
    '"declare war"',
    'declare war?',
    'how do I declare war?',
    'I do not want peace',
    'never make peace',
    'no pact',
    'he said make peace',
    "'make peace'",
    'peace',
    'non aggression pact',
    '`declare war`',
    '(declare war)',
    'declare war？',
    'declare war؟',
    'could we build a café',
  ])('never turns negation, quotation or discussion into an order: %s', (text) => {
    expect(botChatIntent(text).intent).toBe('help');
  });
});

describe('sparse social timing', () => {
  it('gives every bot only five minutes per ninety wall-clock minutes, with separate stable phases', () => {
    const period = 90 * 60_000;
    const phases: number[] = [];
    for (const bot of ['bot', 'bot2', 'bot3', 'bot4']) {
      const active = Array.from({ length: 90 }, (_, minute) =>
        botSocialAvailable(bot, minute * 60_000),
      );
      expect(active.filter(Boolean)).toHaveLength(5);
      expect(active).toEqual(
        Array.from({ length: 90 }, (_, minute) =>
          botSocialAvailable(bot, period + minute * 60_000),
        ),
      );
      phases.push(active.indexOf(true));
    }
    expect(new Set(phases).size).toBeGreaterThan(1);
    expect(botSocialAvailable('bot', Number.NaN)).toBe(false);
  });

  it('varies reply delay from twelve to forty-five seconds deterministically', () => {
    const delays = Array.from({ length: 30 }, (_, index) => {
      const message = { id: 'chat:' + index, from: 'human', to: 'bot' };
      const delay = botReplyDelayMs(message);
      expect(delay).toBe(botReplyDelayMs(message));
      expect(delay).toBeGreaterThanOrEqual(BOT_REPLY_DELAY_MIN_MS);
      expect(delay).toBeLessThanOrEqual(BOT_REPLY_DELAY_MAX_MS);
      return delay;
    });
    expect(new Set(delays).size).toBeGreaterThan(20);
  });

  it('ignores messages while unavailable without waking a timer or answering later', async () => {
    const availability = vi.fn(() => false);
    const f = fixture({ availability });
    await f.send('hello');
    expect(vi.getTimerCount()).toBe(0);
    availability.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(90 * 60_000);
    expect(f.human.texts()).toEqual(['hello']);
    await f.send('hey');
    expect(vi.getTimerCount()).toBe(1);
    await f.deliver();
    expect(f.human.texts().at(-1)).toBe('bot-chat.greeting');
  });

  it('waits the actual chosen delay without blocking and cancels if availability ends first', async () => {
    const f = fixture({ replyDelay: botReplyDelayMs });
    await f.send('hello');
    const message = f.human.messages.find((entry) => entry.message)?.message;
    const delay = botReplyDelayMs(message!);
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(f.human.texts()).toEqual(['hello']);
    expect(f.room.peerCount).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.human.texts().at(-1)).toBe('bot-chat.greeting');
    const availability = vi.fn(() => true);
    const closed = fixture({ availability, replyDelay: () => 45_000 });
    await closed.send('/war');
    availability.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(closed.human.texts()).toEqual(['/war']);
    expect(getStance(closed.room.state, 'human', 'bot')).toBe('peace');
  });
});

describe('bounded persistent bot DM responder', () => {
  it('uses ordinary private chat/history without synthetic human connections or reply loops', async () => {
    const f = fixture();
    await f.send('hello');
    expect(f.human.texts()).toEqual(['hello']);
    await f.deliver();
    expect(f.human.texts()).toEqual(['hello', 'bot-chat.greeting']);
    expect(f.other.texts()).toEqual([]);
    expect(f.room.peerCount).toBe(2);
    expect(f.observations.filter((kind) => kind === 'join')).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    f.room.removePeer('human', f.human);
    const reconnected = new Peer();
    f.room.addPeer('human', reconnected);
    expect(reconnected.texts()).toEqual(['hello', 'bot-chat.greeting']);
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
    await vi.advanceTimersByTimeAsync(300_000);
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
      availability: () => true,
      replyDelay: () => 1500,
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
    await stopped.send('make peace');
    stopped.social.stop();
    await stopped.deliver();
    expect(stopped.human.texts()).toEqual(['make peace']);
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

  it('drains a durable offer in flight without issuing a counter-offer or reply after stop', async () => {
    let finish!: () => void;
    const persisted: string[] = [];
    const f = fixture({
      stance: 'war',
      persist: async (_snapshot, receipt) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        persisted.push(receipt.playerId);
      },
    });
    await f.send('/peace');
    await f.deliver();
    f.social.stop();
    let drained = false;
    const closing = f.social.drain().then(() => {
      drained = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(drained).toBe(false);
    finish();
    await closing;
    expect(persisted).toEqual(['human']);
    expect(getStance(f.room.state, 'human', 'bot')).toBe('war');
    expect(getOffer(f.room.state, 'human', 'bot')).not.toBeNull();
    expect(f.human.texts()).toEqual(['/peace']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(persisted).toEqual(['human']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('revoked consent cannot act for a new owner of the same seat', async () => {
    const f = fixture({ stance: 'war' });
    await f.send('make peace');
    f.room.evict('human');
    const next = new Peer();
    f.room.addPeer('human', next);
    await f.deliver();
    expect(getStance(f.room.state, 'human', 'bot')).toBe('war');
    expect(getOffer(f.room.state, 'human', 'bot')).toBeNull();
    expect(next.texts()).toEqual(['make peace']);
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
    await f.send('make peace');
    await f.deliver();
    expect(getStance(f.room.state, 'human', 'bot')).toBe('war');
    expect(getOffer(f.room.state, 'human', 'bot')).toBeNull();
    expect(f.human.texts()).toEqual(['make peace', 'bot-chat.negotiation-refused']);
  });

  it('negotiates a real pact, and a unilateral explicit war tears it down', async () => {
    const f = fixture();
    await f.send('offer pact');
    await f.deliver();
    expect(getStance(f.room.state, 'human', 'bot')).toBe('pact');
    expect(f.human.texts().at(-1)).toBe('bot-chat.pact-accepted');
    await vi.advanceTimersByTimeAsync(300_000);
    await f.send('declare war');
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
    await f.send('how do I declare war?');
    await f.deliver();
    expect(f.human.texts().at(-1)).toBe('bot-chat.help');
    await vi.advanceTimersByTimeAsync(300_000);
    await f.send('trade');
    await f.deliver();
    expect(f.human.texts().at(-1)).toBe('bot-chat.trade');
    await vi.advanceTimersByTimeAsync(300_000);
    await f.send('alliance');
    await f.deliver();
    expect(f.human.texts().at(-1)).toBe('bot-chat.alliance-refused');
    expect(f.room.state).toEqual(before);
    expect(f.observations.includes('action')).toBe(false);
  });

  it('always renders English, varies short replies, and contains renderer failures without loops', async () => {
    const render = vi.fn((key: string, locale: string) => key + ':' + locale);
    const f = fixture({ render });
    await f.send('привет');
    await f.deliver();
    expect(f.human.texts().at(-1)).toMatch(/^bot-chat\.english-only(?:\.(?:casual|short))?:en$/);
    expect(f.observations.includes('action')).toBe(false);
    for (let index = 0; index < 8; index++) {
      await vi.advanceTimersByTimeAsync(300_000);
      await f.send('hello');
      await f.deliver();
    }
    expect(new Set(render.mock.calls.map(([key]) => key)).size).toBeGreaterThan(2);
    expect(render.mock.calls.every(([, locale]) => locale === 'en')).toBe(true);
    render.mockImplementation(() => {
      throw new Error('private');
    });
    await vi.advanceTimersByTimeAsync(300_000);
    await f.send('hello');
    await f.deliver();
    expect(f.failures).toEqual(['E_BOT_REPLY']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asks for English before acting on foreign diplomacy and never cascades into another reply', async () => {
    const f = fixture({ stance: 'war' });
    const before = structuredClone(f.room.state);
    await f.send('давай мир');
    await f.deliver();
    expect(f.human.texts()).toEqual(['давай мир', 'bot-chat.english-only']);
    expect(f.room.state).toEqual(before);
    expect(f.observations.includes('action')).toBe(false);
    await vi.advanceTimersByTimeAsync(90 * 60_000);
    expect(f.human.texts()).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
