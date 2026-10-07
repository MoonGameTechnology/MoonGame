/**
 * Окно дипломатии (REFM-214, второй PR) — прямой тест владельца.
 *
 * Состояние окна меняют только функции модуля и его обработчики, поэтому здесь проверено то,
 * что текстом не проверить: какая вкладка открывается и когда «Шпионаж» прячется, в каком
 * порядке идут места и кого прячут фильтры, какие приказы уходят из ростера и из карточки
 * места, куда ведут ✉ и досье, чем штампуется журнал разведки, куда уходит реплика и метка,
 * что досказывает разница снимков после обрыва и кто считается ботом. Каждый тест — свежая
 * загрузка модулей над своей «страницей» из заглушек элементов. В конце — стык с `main.ts`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { t } from '../../localization/runtime';
import type { Action, DiplomaticStance, GameState } from '../../packages/shared-core/src/index';
import { COALITION } from './conversations';
import { declareWar, newGame, shareMap, spyOn, START_CANDIDATES } from './game';

interface El {
  id: string;
  innerHTML: string;
  value: string;
  scrollTop: number;
  scrollHeight: number;
  dataset: Record<string, string>;
  classes: Set<string>;
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  fire(type: string, ev?: unknown): void;
  click(): void;
  focus(): void;
}

let page: Map<string, El>;

function stub(id: string): El {
  const on = new Map<string, Array<(ev: unknown) => void>>();
  const el: El = {
    id,
    innerHTML: '',
    value: '',
    scrollTop: 0,
    scrollHeight: 0,
    dataset: {},
    classes: new Set(),
    classList: {
      add: (c) => void el.classes.add(c),
      remove: (c) => void el.classes.delete(c),
      contains: (c) => el.classes.has(c),
    },
    addEventListener: (type, fn) => void on.set(type, [...(on.get(type) ?? []), fn]),
    fire: (type, ev = {}) => {
      for (const fn of on.get(type) ?? []) fn(ev);
    },
    click: () => el.fire('click', { target: { id: '', closest: () => null } }),
    focus: () => {},
  };
  return el;
}
const el = (id: string): El => {
  if (!page.has(id)) page.set(id, stub(id));
  return page.get(id)!;
};
/** Цель нажатия: `closest` находит селекторы из `hits` с их `data-*`. */
const hit = (hits: Record<string, Record<string, string>>, id = '') => ({
  id,
  closest: (sel: string) => (sel in hits ? { dataset: hits[sel]! } : null),
});
const tap = (root: string, hits: Record<string, Record<string, string>>, id = ''): void =>
  el(root).fire('click', { target: hit(hits, id) });

function stubPage(): void {
  page = new Map();
  vi.stubGlobal('document', { getElementById: el });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('location', { pathname: '/', href: '' });
  vi.stubGlobal('__PLAYER_BUILD__', false);
}

// Первая загрузка окна тянет игру и экран настройки — секунды. Граф греется один раз; тесты
// после `vi.resetModules()` загружают его заново из кеша трансформаций.
beforeAll(async () => {
  stubPage();
  await import('./diploWindow');
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(stubPage);
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Мир на троих: я (p1), бот p2 и человек p3. */
function world(): GameState {
  const s = newGame({
    seats: [
      { id: 'p1', name: 'Orion', faction: 'azure', start: START_CANDIDATES[0]!, ai: false },
      { id: 'p2', name: 'Crimson', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
      { id: 'p3', name: 'Vega', faction: 'amber', start: START_CANDIDATES[2]!, ai: false },
    ],
  });
  return s;
}
/** Приказ без номера: создатели действий нумеруют id, сравнивать их незачем. */
const intent = (a: Action) => ({ type: a.type, playerId: a.playerId, payload: a.payload });
const withStance = (s: GameState, pair: string, st: DiplomaticStance): GameState => ({
  ...s,
  diplomacy: { ...s.diplomacy, [pair]: st },
});

/** Свежая загрузка окна и ленты над игрой-заглушкой, которая записывает, что от неё просили. */
async function boot() {
  vi.resetModules();
  const log = await import('./messageLog');
  const win = await import('./diploWindow');
  const interaction = await import('./interaction');
  const env = {
    s: world(),
    net: false,
    online: false,
    szHidden: false,
    localAi: new Set<string>(),
    names: { p1: 'Орион', p2: 'Багровые', p3: 'Вега' } as Record<string, string>,
    orders: [] as Action[],
    notes: [] as string[],
    intros: [] as string[],
    profiles: [] as Array<string | undefined>,
    pings: [] as Array<[string, string]>,
    focus: [] as string[],
    jumps: [] as string[],
    chatRefresh: 0,
    sent: [] as Array<[string, string, string?]>,
  };
  log.initMessageLog({
    now: () => env.s.time,
    me: () => 'p1',
    changed: () => {},
    chat: () =>
      env.net ? { sendChat: (channel, text, to) => void env.sent.push([channel, text, to]) } : null,
    note: (text) => void env.notes.push(text),
    provinceName: (loc) => `«${loc}»`,
  });
  win.initDiploWindow({
    state: () => env.s,
    me: () => 'p1',
    net: () => env.net,
    online: () => env.online,
    names: () => env.names,
    localAi: (id) => env.localAi.has(id),
    seats: [{ id: 'p1', faction: 'azure' }],
    scoreLimit: () => 1000,
    killStats: () => ({ destroyed: 3, lost: 1 }),
    ownerColor: () => '#fff',
    stanceCol: () => '#888',
    myIntel: () => [],
    placeName: (id) => `«${id}»`,
    note: (text) => void env.notes.push(text),
    playerOrder: (a) => (env.orders.push(a), true),
    maybeIntro: (id) => void env.intros.push(id),
    sectorZeroToolsHidden: () => env.szHidden,
    sendProvincePing: (loc, label) => void env.pings.push([loc, label]),
    focusWorld: (id) => void env.focus.push(id),
    jumpToPing: (id) => void env.jumps.push(id),
    openProfile: (login) => void env.profiles.push(login),
    refreshChat: () => void env.chatRefresh++,
  });
  return { win, log, interaction, env };
}

/** Имена мест в ростере по порядку строк. */
const rosterNames = (): string[] =>
  [...el('diplo').innerHTML.matchAll(/class="dp-name">([^ <]+)/g)].map((m) => m[1]!);

describe('REFM-214 — окно и вкладки', () => {
  it('дверь открывает окно на вкладке; крестик и подложка закрывают', async () => {
    const { win } = await boot();
    win.openDiplo('msgs');
    expect([win.diploOpen, win.diploTab]).toEqual([true, 'msgs']);
    expect(el('diplo').classes.has('show')).toBe(true);
    expect(el('diplo').innerHTML).toContain('dp-convo');
    tap('diplo', { '.dp-close': {} });
    expect(win.diploOpen).toBe(false);
    expect(el('diplo').classes.has('show')).toBe(false);
    win.openDiplo('diplo');
    tap('diplo', {}, 'diplo');
    expect(win.diploOpen).toBe(false);
  });

  it('вкладка переключается тапом и перерисовывает окно', async () => {
    const { win } = await boot();
    win.openDiplo('diplo');
    tap('diplo', { '.dp-tab': { tab: 'intel' } });
    expect(win.diploTab).toBe('intel');
    expect(el('diplo').innerHTML).toContain(t('spy.log.title'));
  });

  it('в забеге Sector Zero вкладки «Шпионаж» нет, открытая уступает ростеру', async () => {
    const { win, env } = await boot();
    env.szHidden = true;
    win.openDiplo('intel');
    expect(win.diploTab).toBe('diplo');
    expect(el('diplo').innerHTML).not.toContain('data-tab="intel"');
    expect(el('diplo').innerHTML).not.toContain('class="dp-spy"');
  });

  it('кнопки полосы: «Дипломатия» — ростер и подсказка, «Сообщения» гасят значок', async () => {
    const { win, log, env } = await boot();
    log.markUnread();
    el('rail-msgs').click();
    expect([win.diploTab, log.unreadMsgs]).toEqual(['msgs', 0]);
    el('rail-diplo').click();
    expect(win.diploTab).toBe('diplo');
    expect(env.intros).toEqual(['diplomacy']);
  });
});

describe('REFM-214 — ростер', () => {
  it('я первым, дальше по стойке (война раньше мира), сортировка по имени', async () => {
    const { win, env } = await boot();
    env.s = withStance(withStance(env.s, 'p1|p2', 'peace'), 'p1|p3', 'war');
    win.openDiplo('diplo');
    expect(rosterNames()).toEqual(['Орион', 'Вега', 'Багровые']);
    tap('diplo', { '.dp-sortb': { sort: 'name' } });
    expect(rosterNames()).toEqual(['Орион', 'Багровые', 'Вега']);
  });

  it('фильтр стойки прячет и меня, фильтр рода делит людей и ботов, сброс снимает оба', async () => {
    const { win, env } = await boot();
    env.s = withStance(withStance(env.s, 'p1|p2', 'peace'), 'p1|p3', 'war');
    win.openDiplo('diplo');
    tap('diplo', { '.dp-fchip[data-fstance]': { fstance: 'peace' } });
    expect(rosterNames()).toEqual(['Багровые']);
    tap('diplo', { '.dp-fchip[data-fstance]': { fstance: 'peace' } });
    tap('diplo', { '.dp-fchip[data-ftype]': { ftype: 'human' } });
    expect(rosterNames()).toEqual(['Орион', 'Вега']);
    tap('diplo', { '.dp-fchip[data-fstance]': { fstance: 'alliance' } });
    expect(el('diplo').innerHTML).toContain(t('comms.filter.empty'));
    tap('diplo', { '.dp-fclear': {} });
    expect(rosterNames()).toHaveLength(3);
  });

  it('строка раскрывается тапом, а спрятанная фильтром не раскрывается снова сама', async () => {
    const { win, env } = await boot();
    env.s = withStance(env.s, 'p1|p2', 'peace');
    win.openDiplo('diplo');
    tap('diplo', { '.dp-row': { seat: 'p2' } });
    expect(el('diplo').innerHTML).toContain('data-seat="p2" style');
    tap('diplo', { '.dp-fchip[data-ftype]': { ftype: 'human' } });
    tap('diplo', { '.dp-fchip[data-ftype]': { ftype: 'human' } });
    expect(el('diplo').innerHTML).not.toContain('class="dp-actions"');
  });
});

describe('REFM-214 — стойки, договор карт и шпионаж', () => {
  it('предложение стойки уходит приказом; та же стойка и коалиция боту — нет', async () => {
    const { win, env } = await boot();
    env.s = withStance(env.s, 'p1|p3', 'war');
    win.openDiplo('diplo');
    tap('diplo', { '.dp-act': { seat: 'p3', stance: 'peace' } });
    tap('diplo', { '.dp-act': { seat: 'p3', stance: 'war' } });
    tap('diplo', { '.dp-act': { seat: 'p2', stance: 'alliance' } });
    expect(env.orders.map(intent)).toEqual([intent(declareWar('p1', 'p3', 'peace'))]);
    expect(env.notes).toEqual([t('comms.bots-no-coalition')]);
  });

  it('договор карт и шпион уходят приказом от моего места', async () => {
    const { win, env } = await boot();
    win.openDiplo('diplo');
    tap('diplo', { '.dp-map': { mapseat: 'p3' } });
    tap('diplo', { '.dp-spy': { seat: 'p3', spy: 'fleets' } });
    expect(env.orders.map(intent)).toEqual([
      intent(shareMap('p1', 'p3', true)),
      intent(spyOn('p1', 'p3', 'fleets')),
    ]);
  });

  it('✉ в строке ростера открывает тред этого места', async () => {
    const { win, env } = await boot();
    win.openDiplo('diplo');
    tap('diplo', { '.dp-msg': { msgseat: 'p3' } });
    expect([win.diploTab, win.conversations.current()]).toEqual(['msgs', 'p3']);
    expect(env.orders).toEqual([]);
  });

  it('мир в окне разведки ведёт камеру к миру и закрывает окно', async () => {
    const { win, env } = await boot();
    win.openDiplo('intel');
    tap('diplo', { '[data-iw]': { iw: 'n7' } });
    expect([win.diploOpen, env.focus]).toEqual([false, ['n7']]);
  });
});

describe('REFM-214 — карточки', () => {
  it('своё место открывает свою карточку: досье матча без места', async () => {
    const { win } = await boot();
    win.openSeatCard('p1');
    expect(el('playercard').dataset.seat).toBeUndefined();
    expect(el('playercard').innerHTML).toContain(t('card.commander'));
    expect(el('playercard').classes.has('show')).toBe(true);
  });

  it('стойка из карточки места уходит приказом и перерисовывает карточку, окно и чат', async () => {
    const { win, env } = await boot();
    env.s = withStance(env.s, 'p1|p3', 'war');
    win.openDiplo('diplo');
    win.openSeatCard('p3');
    expect(el('playercard').dataset.seat).toBe('p3');
    el('diplo').innerHTML = '';
    tap('playercard', { '.dp-act': { seat: 'p3', stance: 'peace' } });
    expect(env.orders.map(intent)).toEqual([intent(declareWar('p1', 'p3', 'peace'))]);
    expect(el('playercard').innerHTML).toContain('dp-actions');
    expect(el('diplo').innerHTML).not.toBe('');
    expect(env.chatRefresh).toBe(1);
  });

  it('✉ из карточки закрывает её и открывает тред собеседника', async () => {
    const { win, env } = await boot();
    win.openSeatCard('p3');
    tap('playercard', { '.dp-msg': { msgseat: 'p3' } });
    expect(el('playercard').classes.has('show')).toBe(false);
    expect([win.diploOpen, win.diploTab, win.conversations.current()]).toEqual([
      true,
      'msgs',
      'p3',
    ]);
    expect(env.orders).toEqual([]);
  });

  it('досье ведёт в профиль аккаунта: чужое по логину места, своё без логина', async () => {
    const { win, env } = await boot();
    win.openSeatCard('p3');
    tap('playercard', { '.pc-dossier': {} });
    win.openPlayerCard();
    tap('playercard', { '.pc-dossier': {} });
    expect(env.profiles).toEqual(['Vega', undefined]);
    expect(el('playercard').classes.has('show')).toBe(false);
  });

  it('кнопки стоек на своей карточке не работают: места нет', async () => {
    const { win, env } = await boot();
    env.s = withStance(env.s, 'p1|p3', 'war');
    win.openPlayerCard();
    tap('playercard', { '.dp-act': { seat: 'p3', stance: 'peace' } });
    expect(env.orders).toEqual([]);
  });
});

describe('REFM-214 — журнал разведки', () => {
  it('строка штампуется временем мира, новые сверху, перерисовка — только на своей вкладке', async () => {
    const { win, env } = await boot();
    win.openDiplo('diplo');
    el('diplo').innerHTML = 'ростер';
    win.pushSpyLog('первая');
    expect(el('diplo').innerHTML).toBe('ростер');
    env.s = { ...env.s, time: env.s.time + 3_600_000 };
    win.openDiplo('intel');
    win.pushSpyLog('вторая');
    const html = el('diplo').innerHTML;
    expect(html.indexOf('вторая')).toBeLessThan(html.indexOf('первая'));
    expect(html).not.toContain(t('spy.log.empty'));
  });
});

describe('REFM-214 — реплика и метка', () => {
  it('реплика уходит в открытый разговор и чистит поле; Enter отправляет так же', async () => {
    const { win, log } = await boot();
    win.openDiplo('msgs');
    win.conversations.open('p3');
    el('dp-text').value = '  привет  ';
    tap('diplo', { '.dp-send': {} });
    expect(el('dp-text').value).toBe('');
    el('dp-text').value = 'ещё';
    el('diplo').fire('keydown', { key: 'Enter', target: { id: 'dp-text' }, preventDefault() {} });
    el('dp-text').value = '   ';
    tap('diplo', { '.dp-send': {} });
    expect(log.sessionMessages.map((m) => [m.to, m.text])).toEqual([
      ['p3', 'привет'],
      ['p3', 'ещё'],
    ]);
    expect(el('dp-text').value).toBe('   ');
  });

  it('метка: без провинции — подсказка; в соло — строка коалиции; в сети — серверу', async () => {
    const { win, log, interaction, env } = await boot();
    win.openDiplo('msgs');
    tap('diplo', { '.dp-ping': {} });
    expect(env.notes).toEqual([t('chat.ping.need-province')]);
    const home = Object.keys(env.s.planets)[0]!;
    interaction.pickWorld(home);
    tap('diplo', { '.dp-ping': {} });
    expect(log.sessionMessages.slice(0, 1)).toEqual([
      expect.objectContaining({
        to: COALITION,
        from: 'p1',
        ping: home,
        text: t('chat.ping.mark', { node: `«${home}»` }),
      }),
    ]);
    // Сеть без поднятого клиента ставит метку у себя, как соло.
    env.net = true;
    tap('diplo', { '.dp-ping': {} });
    expect(log.sessionMessages).toHaveLength(2);
    env.online = true;
    el('dp-text').value = 'сюда';
    tap('diplo', { '.dp-ping': {} });
    expect(env.pings).toEqual([[home, 'сюда']]);
    expect(log.sessionMessages).toHaveLength(2);
  });

  it('ник в строке открывает карточку места, строка метки ведёт камеру', async () => {
    const { win, env } = await boot();
    win.openDiplo('msgs');
    tap('diplo', { '[data-nickseat]': { nickseat: 'p3' } });
    tap('diplo', { '.dp-line.ping': { ping: 'n7' } });
    expect(el('playercard').dataset.seat).toBe('p3');
    expect(env.jumps).toEqual(['n7']);
  });
});

describe('REFM-214 — разница дипломатии после обрыва', () => {
  it('входящее предложение — одна строка ленты, одна в треде и один значок', async () => {
    const { win, log, env } = await boot();
    const before = env.s;
    const after = { ...before, diplomacyOffers: { 'p3>p1': 'peace' as const } };
    expect(win.diffNetDiplomacy(before, after)).toBe(true);
    expect(env.notes).toHaveLength(1);
    expect(log.sessionMessages).toEqual([
      expect.objectContaining({ from: 'p3', to: 'p3', sys: true }),
    ]);
    expect(log.unreadMsgs).toBe(1);
  });

  it('без перемен — ни строки, ни перерисовки', async () => {
    const { win, log, env } = await boot();
    expect(win.diffNetDiplomacy(env.s, env.s)).toBe(false);
    expect([env.notes, log.sessionMessages, log.unreadMsgs]).toEqual([[], [], 0]);
  });
});

describe('REFM-214 — кто бот', () => {
  it('бот — по флагу состояния; местный признак — запасной только в соло', async () => {
    const { win, env } = await boot();
    env.localAi.add('p3');
    expect([win.isAiSeat('p2'), win.isAiSeat('p3')]).toEqual([true, true]);
    env.net = true;
    expect([win.isAiSeat('p2'), win.isAiSeat('p3')]).toEqual([true, false]);
    expect(win.seatBadge('p1').tag).toBe(t('comms.you'));
  });
});

describe('REFM-214 — проводка в main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('состояние окна и журнал разведки пишут только функции окна', () => {
    expect(MAIN).not.toMatch(/\b(diploOpen|diploTab|diploSort|diploExpanded)\s*=[^=]/);
    expect(MAIN).not.toMatch(/\bdiplo(Stance|Type)Filter\b/);
    expect(MAIN).not.toMatch(/\bspyLog\s*[:=]/);
    expect(MAIN).not.toContain('pushSpyEntry(');
    expect(MAIN).not.toMatch(
      /\bfunction (renderDiplo|openDiplo|closeDiplo|proposeStance|toggleMapShare|playerCardHtml|seatCardHtml|intelTabHtml|diffNetDiplomacy|sendDiploMsg|pingSelected|pushSpyLog)\b/,
    );
  });

  it('обработчики окна, карточки и кнопок полосы живут у окна', () => {
    expect(MAIN).not.toContain("getElementById('rail-diplo')");
    expect(MAIN).not.toContain("getElementById('rail-msgs')");
    expect(MAIN).not.toMatch(/\b(diploEl|playerCardEl)\b/);
    expect(MAIN).toContain('initDiploWindow({');
  });

  it('снимок досказывает дипломатию только после обрыва (правило 6 `netWelcome.ts`)', () => {
    // Живая дельта везёт дипломатию событиями: сравнение на каждом снимке удваивало
    // входящее предложение, а сравнение на первом входе выдавало «Стойка изменена» от
    // каждого бота.
    expect(MAIN.match(/\bdiffNetDiplomacy\(/g)).toHaveLength(1);
    expect(MAIN).toContain(
      'const diploShift = plan.catchUp && s !== snap.state && diffNetDiplomacy(s, snap.state);',
    );
  });
});
