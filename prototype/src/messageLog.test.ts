/**
 * Лента сообщений сессии (REFM-214) — прямой тест владельца.
 *
 * Ленту и счётчик непрочитанного пишут только двери модуля, поэтому здесь проверено то, что
 * текстом не проверить: чем штампуется своя строка, сколько строк держит лента, как сервер
 * назначает личность ретранслированной метке и реплике (эхо и повтор при входе не удваивают
 * строку, метку без провинции не берут, снимают по серверному id), в какой разговор ложится
 * реплика каждого канала, чья строка зажигает значок и куда уходит своя реплика в сети и в
 * соло. Каждый тест — свежая загрузка модуля над своим «экраном».
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../localization/runtime';
import type { MultiplayerChatMessage, MultiplayerPing } from '../../packages/client/src/index';
import { CH_GLOBAL, CH_SESSION, COALITION } from './conversations';

let env: {
  now: number;
  me: string;
  repaints: number;
  net: boolean;
  sent: Array<[string, string, string?]>;
  notes: string[];
};

beforeEach(() => {
  env = { now: 7_200_000, me: 'p1', repaints: 0, net: false, sent: [], notes: [] };
});

/** Свежая загрузка ленты — как после перезагрузки страницы. */
async function boot() {
  vi.resetModules();
  const log = await import('./messageLog');
  log.initMessageLog({
    now: () => env.now,
    me: () => env.me,
    changed: () => void env.repaints++,
    chat: () =>
      env.net ? { sendChat: (channel, text, to) => void env.sent.push([channel, text, to]) } : null,
    note: (text) => void env.notes.push(text),
    provinceName: (loc) => `«${loc}»`,
  });
  return log;
}

const ping = (over: Partial<MultiplayerPing> = {}): MultiplayerPing =>
  ({ id: 'ping:p2:1', owner: 'p2', createdAt: 3_600_000, ...over }) as MultiplayerPing;
const chat = (over: Partial<MultiplayerChatMessage> = {}): MultiplayerChatMessage => ({
  id: 'chat:p2:1',
  from: 'p2',
  channel: 'session',
  text: 'привет',
  at: 3_600_000,
  ...over,
});

describe('REFM-214 — своя строка', () => {
  it('штампуется временем мира, по умолчанию от меня, и перерисовывает ленты', async () => {
    const log = await boot();
    log.pushMsg(COALITION, 'сюда', false, undefined, 'n7');
    expect(log.sessionMessages).toEqual([
      expect.objectContaining({
        at: 7_200_000,
        from: 'p1',
        to: COALITION,
        text: 'сюда',
        sys: false,
        ping: 'n7',
      }),
    ]);
    expect(log.sessionMessages[0]!.realAt).toEqual(expect.any(Number));
    expect(env.repaints).toBe(1);
  });

  it('служебная строка дипломатии идёт от собеседника', async () => {
    const log = await boot();
    log.pushMsg('p3', 'предлагает мир', true, 'p3');
    expect(log.sessionMessages[0]).toMatchObject({ from: 'p3', to: 'p3', sys: true });
  });

  it('лента держит последние 300 строк, самая старая уходит первой', async () => {
    const log = await boot();
    for (let i = 0; i < 301; i++) log.pushMsg(CH_SESSION, `#${i}`, false);
    expect(log.sessionMessages).toHaveLength(300);
    expect(log.sessionMessages[0]!.text).toBe('#1');
    expect(log.sessionMessages[299]!.text).toBe('#300');
  });

  it('замена ленты целиком не зовёт перерисовку: её зовёт тот, кто менял', async () => {
    const log = await boot();
    log.pushMsg(COALITION, 'a', false);
    log.replaceMessages([]);
    expect(log.sessionMessages).toEqual([]);
    expect(env.repaints).toBe(1);
  });
});

describe('REFM-214 — метка от сервера', () => {
  it('ложится в канал коалиции с серверным id и временем метки', async () => {
    const log = await boot();
    log.takePing(ping({ label: 'держим' }), 'n7');
    expect(log.sessionMessages).toEqual([
      expect.objectContaining({
        at: 3_600_000,
        from: 'p2',
        to: COALITION,
        text: 'держим',
        sys: false,
        ping: 'n7',
        pingId: 'ping:p2:1',
      }),
    ]);
    expect(env.repaints).toBe(1);
  });

  it('без подписи называется провинцией', async () => {
    const log = await boot();
    log.takePing(ping(), 'n7');
    expect(log.sessionMessages[0]!.text).toBe(t('chat.ping.mark', { node: '«n7»' }));
  });

  it('эхо своей метки и повтор при входе не удваивают строку', async () => {
    const log = await boot();
    log.takePing(ping(), 'n7');
    log.takePing(ping({ label: 'повтор' }), 'n7');
    expect(log.sessionMessages).toHaveLength(1);
    expect(env.repaints).toBe(1);
  });

  it('метку без провинции не берут', async () => {
    const log = await boot();
    log.takePing(ping(), null);
    expect(log.sessionMessages).toEqual([]);
    expect(env.repaints).toBe(0);
  });

  it('снимается по серверному id, а не по тексту и автору, и перерисовывает обе ленты', async () => {
    const log = await boot();
    log.takePing(ping({ label: 'сюда' }), 'n7');
    log.takePing(ping({ id: 'ping:p2:2', label: 'сюда' }), 'n7');
    log.dropPing('ping:p2:1');
    expect(log.sessionMessages.map((m) => m.pingId)).toEqual(['ping:p2:2']);
    expect(env.repaints).toBe(3);
  });

  it('метка держит тот же предел ленты', async () => {
    const log = await boot();
    for (let i = 0; i < 300; i++) log.pushMsg(CH_SESSION, `#${i}`, false);
    log.takePing(ping(), 'n7');
    expect(log.sessionMessages).toHaveLength(300);
    expect(log.sessionMessages[299]!.pingId).toBe('ping:p2:1');
  });
});

describe('REFM-214 — реплика от сервера', () => {
  it('каждый канал ложится в свой разговор, личка — в тред собеседника', async () => {
    const log = await boot();
    log.takeChat(chat({ id: 'c1', channel: 'session' }));
    log.takeChat(chat({ id: 'c2', channel: 'coalition' }));
    log.takeChat(chat({ id: 'c3', channel: 'dm', to: 'p1' }));
    log.takeChat(chat({ id: 'c4', channel: 'dm', from: 'p1', to: 'p3' }));
    log.takeChat(chat({ id: 'c5', channel: 'dm', to: undefined }));
    expect(log.sessionMessages.map((m) => [m.chatId, m.from, m.to])).toEqual([
      ['c1', 'p2', CH_SESSION],
      ['c2', 'p2', COALITION],
      ['c3', 'p2', 'p1'],
      ['c4', 'p1', 'p3'],
      ['c5', 'p2', 'p2'],
    ]);
    expect(log.sessionMessages[0]).toMatchObject({ at: 3_600_000, text: 'привет', sys: false });
    expect(env.repaints).toBe(5);
  });

  it('значок зажигает чужая реплика, а своё эхо — нет', async () => {
    const log = await boot();
    log.takeChat(chat({ id: 'c1' }));
    log.takeChat(chat({ id: 'c2', from: 'p1' }));
    expect(log.unreadMsgs).toBe(1);
  });

  it('эхо и повтор при входе не удваивают строку и не считаются непрочитанными', async () => {
    const log = await boot();
    log.takeChat(chat());
    log.takeChat(chat({ text: 'повтор' }));
    expect(log.sessionMessages).toHaveLength(1);
    expect(log.unreadMsgs).toBe(1);
    expect(env.repaints).toBe(1);
  });

  it('реплика держит тот же предел ленты', async () => {
    const log = await boot();
    for (let i = 0; i < 300; i++) log.pushMsg(CH_SESSION, `#${i}`, false);
    log.takeChat(chat());
    expect(log.sessionMessages).toHaveLength(300);
    expect(log.sessionMessages[0]!.text).toBe('#1');
  });
});

describe('REFM-214 — непрочитанное', () => {
  it('событие дипломатии добавляет, чтение вкладки обнуляет', async () => {
    const log = await boot();
    log.markUnread();
    log.markUnread();
    expect(log.unreadMsgs).toBe(2);
    log.readMessages();
    expect(log.unreadMsgs).toBe(0);
  });
});

describe('REFM-214 — своя реплика', () => {
  it('в сети уходит серверу своим каналом, а в ленту ляжет эхом', async () => {
    const log = await boot();
    env.net = true;
    log.dispatchChat(CH_SESSION, 'всем');
    log.dispatchChat(COALITION, 'своим');
    log.dispatchChat('p3', 'лично');
    expect(env.sent).toEqual([
      ['session', 'всем', undefined],
      ['coalition', 'своим', undefined],
      ['dm', 'лично', 'p3'],
    ]);
    expect(log.sessionMessages).toEqual([]);
    expect(env.repaints).toBe(0);
  });

  it('в сети глобальный канал не отправляется, игроку говорят почему', async () => {
    const log = await boot();
    env.net = true;
    log.dispatchChat(CH_GLOBAL, 'мир');
    expect(env.sent).toEqual([]);
    expect(env.notes).toEqual([t('comms.global.soon')]);
    expect(log.sessionMessages).toEqual([]);
  });

  it('в соло ложится в ленту сразу, от меня и не служебной', async () => {
    const log = await boot();
    log.dispatchChat('p3', 'лично');
    expect(log.sessionMessages).toEqual([
      expect.objectContaining({ from: 'p1', to: 'p3', text: 'лично', sys: false }),
    ]);
    expect(env.sent).toEqual([]);
  });
});

describe('REFM-214 — проводка в main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('ленту и счётчик пишут только двери владельца', () => {
    expect(MAIN).not.toMatch(
      /\bsessionMessages\s*(=[^=]|\.(push|shift|unshift|splice|pop)\b|\.length\s*=)/,
    );
    expect(MAIN).not.toMatch(/\bunreadMsgs\s*(=[^=]|\+\+|--|\+=|-=)/);
    expect(MAIN).not.toMatch(/\bfunction (pushMsg|dispatchChat)\b/);
  });

  it('сеть отдаёт метки и реплики владельцу целиком', () => {
    // Обработчики клиента — у сетевого цикла (REFM-216), провинцию метки даёт карта хоста.
    const NETS = readFileSync(new URL('./netSession.ts', import.meta.url), 'utf8');
    expect(NETS).toContain('takePing(ping, game.pingProvince(ping.target));');
    expect(MAIN).toContain('pingProvince: (target) => provinceForPing(target, MAP),');
    expect(NETS).toContain('dropPing(pingId);');
    expect(NETS).toContain('takeChat(m);');
  });

  it('любая правка ленты перерисовывает и окно дипломатии, и плавающий чат', () => {
    // Снятая метка оставалась строкой в плавающем чате: снятие перерисовывало только
    // тред окна дипломатии, а добавление — оба.
    const repaint = /\nfunction repaintFeeds\(\): void \{([\s\S]*?)\n\}/.exec(MAIN)?.[1] ?? '';
    expect(repaint).toContain('renderDiploFeed();');
    expect(repaint).toContain('chatWin?.refreshIfVisible();');
    expect(MAIN).toMatch(/\n {2}changed: repaintFeeds,\n/);
    expect(MAIN).toMatch(/\n {6}onFeedChanged: repaintFeeds,\n/);
  });
});
