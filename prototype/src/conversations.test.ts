import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame } from './game';
import { getStance, pairKey, type GameState } from '../../packages/shared-core/src/index';
import {
  initConversations,
  COALITION,
  CH_SESSION,
  CH_GLOBAL,
  GROUP_CHANNELS,
  type SessionMsg,
  type ConversationsHost,
} from './conversations';

// REFM-15: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

const msg = (over: Partial<SessionMsg> = {}): SessionMsg => ({
  at: 0,
  from: 'p1',
  to: COALITION,
  text: 'текст',
  sys: false,
  ...over,
});

function hostOf(over: Partial<ConversationsHost> = {}): ConversationsHost {
  const state = newGame();
  return {
    state: () => state,
    me: () => 'p1',
    messages: () => [],
    nameOf: (id) => `имя-${id}`,
    seats: () => Object.keys(state.players),
    seatBadge: () => ({ icon: '◆', tag: 'tag' }),
    fmtStamp: (at) => `T${at}`,
    ownerColor: () => '#0ff',
    ...over,
  };
}

describe('конверсации — словарь каналов', () => {
  it('групповые комнаты перечислены явно, личка в них не входит', () => {
    expect(GROUP_CHANNELS.has(COALITION)).toBe(true);
    expect(GROUP_CHANNELS.has(CH_SESSION)).toBe(true);
    expect(GROUP_CHANNELS.has(CH_GLOBAL)).toBe(true);
    expect(GROUP_CHANNELS.has('p2')).toBe(false); // seat id — это личка
  });
});

describe('конверсации — что попадает в переписку', () => {
  const log = [
    msg({ at: 1, from: 'p1', to: COALITION, text: 'коалиции' }),
    msg({ at: 2, from: 'p2', to: CH_SESSION, text: 'всем' }),
    msg({ at: 3, from: 'p1', to: 'p2', text: 'ему' }),
    msg({ at: 4, from: 'p2', to: 'p1', text: 'от него' }),
    msg({ at: 5, from: 'p2', to: 'p3', text: 'чужая личка' }),
  ];
  const conv = () => initConversations(hostOf({ messages: () => log }));

  it('групповой канал собирает адресованное ЕМУ, и только его', () => {
    expect(conv().messagesOf(COALITION).map((m) => m.text)).toEqual(['коалиции']);
    expect(conv().messagesOf(CH_SESSION).map((m) => m.text)).toEqual(['всем']);
  });

  it('личка собирает обе стороны переписки', () => {
    expect(conv().messagesOf('p2').map((m) => m.text)).toEqual(['ему', 'от него']);
  });

  it('чужая личка не видна — это чужая переписка', () => {
    expect(conv().messagesOf('p2').some((m) => m.text === 'чужая личка')).toBe(false);
    expect(conv().messagesOf('p3')).toEqual([]);
  });

  it('групповое сообщение не протекает в личку и наоборот', () => {
    expect(conv().messagesOf('p2').some((m) => m.to === COALITION)).toBe(false);
    expect(conv().messagesOf(COALITION).some((m) => m.to === 'p2')).toBe(false);
  });
});

describe('конверсации — строка сообщения', () => {
  it('своё сообщение помечено как своё, чужое — нет', () => {
    const c = initConversations(hostOf());
    expect(c.lineHtml(msg({ from: 'p1' }))).toContain('dp-line me');
    expect(c.lineHtml(msg({ from: 'p2' }))).not.toContain('dp-line me');
  });

  it('системная строка отдельного вида и без ника', () => {
    const html = initConversations(hostOf()).lineHtml(msg({ sys: true, text: 'связь потеряна' }));
    expect(html).toContain('dp-line sys');
    expect(html).not.toContain('dp-nick');
  });

  it('пинг рисуется кликабельным маркером', () => {
    const html = initConversations(hostOf()).lineHtml(msg({ from: 'p2', ping: 'A1' }));
    expect(html).toContain('dp-jump');
    expect(html).toContain('A1');
  });

  it('текст сообщения экранируется — это ввод живого игрока (CWE-79)', () => {
    const html = initConversations(hostOf()).lineHtml(
      msg({ from: 'p2', text: '<img src=x onerror=alert(1)>' }),
    );
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
  });

  it('ник живого соседа кликабелен, свой — нет', () => {
    const c = initConversations(hostOf());
    expect(c.lineHtml(msg({ from: 'p2' }))).toContain('dp-nick');
    expect(c.lineHtml(msg({ from: 'p1' }))).not.toContain('dp-nick');
  });

  it('отметка времени берётся у хозяина, а не изобретается заново', () => {
    const c = initConversations(hostOf({ fmtStamp: () => 'ОТМЕТКА' }));
    expect(c.lineHtml(msg({ at: 42 }))).toContain('ОТМЕТКА');
  });
});

describe('конверсации — коалиция', () => {
  it('в коалицию входите вы сами', () => {
    expect(initConversations(hostOf()).coalition()).toContain('p1');
  });

  it('без союзов коалиция — это только вы', () => {
    expect(initConversations(hostOf()).coalition()).toEqual(['p1']);
  });

  it('союзник попадает в коалицию, а НЕ-союзник — нет', () => {
    const state: GameState = newGame();
    // ключ пары строится ядром (`pairKey`), поэтому союз ставим его же функцией
    state.diplomacy = { ...(state.diplomacy ?? {}), [pairKey('p1', 'p2')]: 'alliance' };
    expect(getStance(state, 'p1', 'p2')).toBe('alliance'); // страховка от смены формата ключа
    const members = initConversations(hostOf({ state: () => state })).coalition();
    expect(members).toContain('p2'); // союзник — в коалиции
    expect(members).toContain('p1');
    expect(members).not.toContain('p3'); // с ним союза нет
  });

  it('пакт и мир коалицию НЕ образуют — делится только альянс', () => {
    const state: GameState = newGame();
    state.diplomacy = { ...(state.diplomacy ?? {}), [pairKey('p1', 'p2')]: 'pact' };
    expect(initConversations(hostOf({ state: () => state })).coalition()).not.toContain('p2');
  });
});

describe('конверсации — открытая переписка', () => {
  it('по умолчанию открыт коалиционный канал', () => {
    expect(initConversations(hostOf()).current()).toBe(COALITION);
  });

  it('open() переключает переписку, и лента следует за ней', () => {
    const log = [
      msg({ at: 1, to: COALITION, text: 'коалиции' }),
      msg({ at: 2, from: 'p2', to: 'p1', text: 'личное' }),
    ];
    const c = initConversations(hostOf({ messages: () => log }));
    expect(c.feedInnerHtml()).toContain('коалиции');
    c.open('p2');
    expect(c.current()).toBe('p2');
    expect(c.feedInnerHtml()).toContain('личное');
    expect(c.feedInnerHtml()).not.toContain('коалиции');
  });

  it('лента конкретного канала не зависит от того, что открыто', () => {
    const log = [msg({ at: 1, to: CH_SESSION, text: 'всем' })];
    const c = initConversations(hostOf({ messages: () => log }));
    expect(c.feedInnerHtml(CH_SESSION)).toContain('всем');
  });

  it('пустая переписка читается как пустая, а не как поломка', () => {
    const c = initConversations(hostOf());
    expect(c.feedInnerHtml()).not.toContain('dp-line');
  });
});

describe('конверсации — список и заголовок', () => {
  it('в списке есть общий канал, коалиция и личка соседа', () => {
    const html = initConversations(hostOf()).listHtml();
    expect(html).toContain(`data-convo="${CH_SESSION}"`);
    expect(html).toContain(`data-convo="${COALITION}"`);
    expect(html).toContain('data-convo="p2"');
  });

  it('открытая переписка подсвечена в списке', () => {
    const c = initConversations(hostOf());
    c.open('p2');
    expect(c.listHtml()).toContain('data-convo="p2"');
    expect(c.listHtml()).toMatch(/class="dp-cv on" data-convo="p2"/);
  });

  it('себя в списке личек нет — с собой не переписываются', () => {
    expect(initConversations(hostOf()).listHtml()).not.toContain('data-convo="p1"');
  });

  it('имя соседа экранируется в списке (CWE-79)', () => {
    const html = initConversations(
      hostOf({ nameOf: (id) => (id === 'p2' ? '<img src=x>' : id) }),
    ).listHtml();
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
  });

  it('в коалиционной ветке есть кнопка пинга, в личке — нет', () => {
    const c = initConversations(hostOf());
    expect(c.threadHtml()).toContain('dp-ping');
    c.open('p2');
    expect(c.threadHtml()).not.toContain('dp-ping');
  });

  it('ветка всегда несёт поле ввода и кнопку отправки', () => {
    const html = initConversations(hostOf()).threadHtml();
    expect(html).toContain('id="dp-text"');
    expect(html).toContain('dp-send');
  });
});
