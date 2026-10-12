import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { en } from '../localization/en';
import { ru } from '../localization/ru';
import {
  activePhoneTab,
  DEFAULT_PHONE_BAR,
  parsePhoneBar,
  PHONE_BAR_SLOTS,
  PHONE_EDGE_LABEL,
  PHONE_ITEMS,
  PHONE_PINNABLE,
  phoneBadges,
  phoneItem,
  phoneMoreItems,
  phoneSectionLabel,
  phoneTabs,
  phoneTabTap,
  phoneTileBadge,
  placeInBar,
  serializePhoneBar,
  type PhoneSection,
} from './phoneNav';
import { SECTOR_ZERO_ABSENT_TOOLS, SECTOR_ZERO_ABSENT_TWINS } from './sectorZeroTools';

const MARKUP = readFileSync(new URL('../prototype/build.mjs', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../prototype/src/main.ts', import.meta.url), 'utf8');

/** Кнопки, которых нет: в обычной партии — торговца, досье Роя, сохранения и «Завершить». */
const missing =
  (...ids: string[]) =>
  (selector: string): boolean =>
    !ids.includes(selector);
const MATCH = missing(
  '#rail-trader',
  '#rail-dossier',
  '#devline [data-solo-save]',
  '#rail-abandon',
);
/** Забег Sector Zero: без инструментов мультиплеера и «Производства», зато с торговцем. */
const RUN = missing(
  ...Object.values(SECTOR_ZERO_ABSENT_TOOLS).map((id) => `#${id}`),
  `#${SECTOR_ZERO_ABSENT_TWINS.production}`,
  '#devline [data-solo-save]',
);

describe('нижняя панель телефона (UIX-3.1)', () => {
  it('по умолчанию пять разделов: Карта, Производство, Наука, События, Ещё (правило 1)', () => {
    const tabs = phoneTabs(DEFAULT_PHONE_BAR, () => true);
    expect(tabs).toEqual(['map', 'production', 'science', 'events', 'more']);
    expect(tabs.map((tab) => ru[phoneSectionLabel(tab)])).toEqual([
      'Карта',
      'Производство',
      'Наука',
      'События',
      'Ещё',
    ]);
  });

  it('в забеге Sector Zero «Производства» нет, остальные разделы на месте (правило 2)', () => {
    expect(phoneTabs(DEFAULT_PHONE_BAR, RUN)).toEqual(['map', 'science', 'events', 'more']);
  });

  it('в «Ещё» — Настройки и Выход, которых на телефоне не было (правило 3)', () => {
    const ids = phoneMoreItems(DEFAULT_PHONE_BAR, MATCH).map((item) => item.id);
    expect(ids).toEqual([
      'diplomacy',
      'mail',
      'pings',
      'market',
      'corporation',
      'steward',
      'codex',
      'settings',
      'exit',
    ]);
  });

  it('подписи «Ещё» — полными словами, без «Дипло», «Корп» и «Сон» (правило 3)', () => {
    const label = (id: 'diplomacy' | 'corporation' | 'steward') => ru[phoneItem(id).label];
    expect([label('diplomacy'), label('corporation'), label('steward')]).toEqual([
      'Дипломатия',
      'Корпорация',
      'Хранитель',
    ]);
    for (const item of PHONE_ITEMS)
      expect(ru[item.label], item.id).not.toMatch(/^(Дипло|Корп|Сон)$/);
  });

  it('в забеге «Ещё» без инструментов мультиплеера, но с торговцем и «Завершить» (правило 3)', () => {
    const ids = phoneMoreItems(DEFAULT_PHONE_BAR, RUN).map((item) => item.id);
    expect(ids).toEqual(['diplomacy', 'trader', 'dossier', 'codex', 'settings', 'abandon', 'exit']);
  });

  it('каждый пункт нажимает кнопку, которая есть в разметке', () => {
    // Переименуй кнопку — и пункт молча перестанет открывать окно.
    for (const { opens } of PHONE_ITEMS) {
      const id = /^#([\w-]+)/.exec(opens)?.[1];
      expect(MARKUP, `id="${id}" в build.mjs`).toContain(`id="${id}"`);
    }
    expect(MAIN, 'кнопка сохранения строки статуса').toContain('data-solo-save="1"');
  });

  it('у каждой подписи есть текст в обеих локалях', () => {
    for (const key of [...Object.values(PHONE_EDGE_LABEL), ...PHONE_ITEMS.map((x) => x.label)]) {
      expect(ru[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
  });
});

describe('своя раскладка панели (UIX-3.3)', () => {
  it('на панель ставят любое окно, кроме сохранения и выходов (правило 7)', () => {
    expect(PHONE_PINNABLE).toEqual(
      PHONE_ITEMS.map((item) => item.id).filter((id) => !['save', 'abandon', 'exit'].includes(id)),
    );
    expect(DEFAULT_PHONE_BAR).toHaveLength(PHONE_BAR_SLOTS);
  });

  it('Карта и «Ещё» по краям, между ними — места панели слева направо (правило 7)', () => {
    expect(phoneTabs(['diplomacy', 'mail', 'production'], () => true)).toEqual([
      'map',
      'diplomacy',
      'mail',
      'production',
      'more',
    ]);
  });

  it('снятое с панели окно уходит в «Ещё» на своё место в порядке, ничего не теряется (правило 7)', () => {
    const bar = ['diplomacy', 'mail', 'events'] as const;
    const more = phoneMoreItems(bar, () => true).map((item) => item.id);
    expect(more.slice(0, 3)).toEqual(['production', 'science', 'pings']);
    expect(new Set([...bar, ...more])).toEqual(new Set(PHONE_ITEMS.map((item) => item.id)));
  });

  it('окно на месте без кнопки прячется, как раздел по умолчанию (правила 2 и 7)', () => {
    expect(phoneTabs(['market', 'science', 'mail'], RUN)).toEqual(['map', 'science', 'more']);
  });

  it('новое окно встаёт на место, а окно с панели меняется местами (правило 8)', () => {
    expect(placeInBar(DEFAULT_PHONE_BAR, 1, 'diplomacy')).toEqual([
      'production',
      'diplomacy',
      'events',
    ]);
    expect(placeInBar(DEFAULT_PHONE_BAR, 0, 'events')).toEqual(['events', 'science', 'production']);
    expect(placeInBar(DEFAULT_PHONE_BAR, 2, 'events')).toEqual(DEFAULT_PHONE_BAR);
  });

  it('чужое место и чужое окно раскладку не меняют', () => {
    expect(placeInBar(DEFAULT_PHONE_BAR, 3, 'mail')).toBe(DEFAULT_PHONE_BAR);
    expect(placeInBar(DEFAULT_PHONE_BAR, -1, 'mail')).toBe(DEFAULT_PHONE_BAR);
    expect(placeInBar(DEFAULT_PHONE_BAR, 0.5, 'mail')).toBe(DEFAULT_PHONE_BAR);
    // @ts-expect-error — выход на панель не ставится даже по ошибке вызывающего
    expect(placeInBar(DEFAULT_PHONE_BAR, 0, 'exit')).toBe(DEFAULT_PHONE_BAR);
  });

  it('запись раскладки читается обратно (правило 9)', () => {
    const bar = ['trader', 'codex', 'science'] as const;
    expect(parsePhoneBar(serializePhoneBar(bar))).toEqual(bar);
    expect(parsePhoneBar(null)).toEqual(DEFAULT_PHONE_BAR);
  });

  it('незнакомое, повторное и лишнее отбрасывается, пустое занимает раскладка по умолчанию (правило 9)', () => {
    expect(parsePhoneBar('')).toEqual(DEFAULT_PHONE_BAR);
    expect(parsePhoneBar('mail,mail,exit,nonsense')).toEqual(['mail', 'production', 'science']);
    expect(parsePhoneBar(' science , mail ,codex,steward')).toEqual(['science', 'mail', 'codex']);
    expect(parsePhoneBar('events')).toEqual(['events', 'production', 'science']);
  });
});

describe('подсветка и нажатия разделов', () => {
  const opened =
    (...tabs: PhoneSection[]) =>
    (tab: PhoneSection): boolean =>
      tabs.includes(tab);

  it('подсвечен раздел, чьё окно открыто; иначе «Ещё», пока открыт лист, иначе карта (правило 5)', () => {
    expect(activePhoneTab(DEFAULT_PHONE_BAR, opened())).toBe('map');
    expect(activePhoneTab(DEFAULT_PHONE_BAR, opened('science'))).toBe('science');
    expect(activePhoneTab(DEFAULT_PHONE_BAR, opened('more'))).toBe('more');
    expect(activePhoneTab(DEFAULT_PHONE_BAR, opened('more', 'events'))).toBe('events');
  });

  it('подсвечивается только окно с панели: открытое из «Ещё» подсвечивает Карту (правило 5)', () => {
    expect(activePhoneTab(['diplomacy', 'mail', 'codex'], opened('mail'))).toBe('mail');
    expect(activePhoneTab(DEFAULT_PHONE_BAR, opened('mail'))).toBe('map');
  });

  it('нажатие открывает раздел, а повторное и «Карта» ведут к карте (правило 4)', () => {
    expect(phoneTabTap('science', 'map')).toBe('science');
    expect(phoneTabTap('production', 'science')).toBe('production');
    expect(phoneTabTap('more', 'events')).toBe('more');
    expect(phoneTabTap('science', 'science')).toBeNull();
    expect(phoneTabTap('more', 'more')).toBeNull();
    expect(phoneTabTap('map', 'events')).toBeNull();
    expect(phoneTabTap('diplomacy', 'map')).toBe('diplomacy');
  });

  it('значки: бои на «Событиях», письма на «Ещё», ноль прячет (правило 6)', () => {
    expect(phoneBadges(DEFAULT_PHONE_BAR, { events: 3, mail: 2 }, false)).toEqual({
      events: '3',
      more: '2',
    });
    expect(phoneBadges(DEFAULT_PHONE_BAR, { events: 0, mail: 0 }, false)).toEqual({
      events: '',
      more: '',
    });
    expect(phoneBadges(DEFAULT_PHONE_BAR, { events: Number.NaN, mail: -1 }, false)).toEqual({
      events: '',
      more: '',
    });
  });

  it('пока лист «Ещё» открыт, числа стоят на плитках, а не на разделе (правило 6)', () => {
    expect(phoneBadges(DEFAULT_PHONE_BAR, { events: 1, mail: 4 }, true)).toEqual({
      events: '1',
      more: '',
    });
    expect(phoneTileBadge({ events: 1, mail: 4 }, 'mail')).toBe('4');
    expect(phoneTileBadge({ events: 1, mail: 4 }, 'exit')).toBe('');
  });

  it('число идёт за своим окном: на панели — у раздела, в «Ещё» — в сумме «Ещё» (правило 6)', () => {
    expect(phoneBadges(['mail', 'science', 'codex'], { events: 3, mail: 2 }, false)).toEqual({
      mail: '2',
      more: '3',
    });
    expect(phoneBadges(['diplomacy', 'science', 'codex'], { events: 3, mail: 2 }, false)).toEqual({
      more: '5',
    });
  });
});
