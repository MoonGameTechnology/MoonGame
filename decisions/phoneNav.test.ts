import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { en } from '../localization/en';
import { ru } from '../localization/ru';
import {
  activePhoneTab,
  PHONE_MORE,
  PHONE_TABS,
  phoneBadges,
  phoneMoreItems,
  phoneTabs,
  phoneTabTap,
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
  it('пять разделов: Карта, Производство, Наука, События, Ещё (правило 1)', () => {
    expect(PHONE_TABS.map((tab) => ru[tab.label])).toEqual([
      'Карта',
      'Производство',
      'Наука',
      'События',
      'Ещё',
    ]);
    expect(phoneTabs(() => true).map((tab) => tab.id)).toEqual([
      'map',
      'production',
      'science',
      'events',
      'more',
    ]);
  });

  it('в забеге Sector Zero «Производства» нет, остальные разделы на месте (правило 2)', () => {
    expect(phoneTabs(RUN).map((tab) => tab.id)).toEqual(['map', 'science', 'events', 'more']);
  });

  it('в «Ещё» — Настройки и Выход, которых на телефоне не было (правило 3)', () => {
    const ids = phoneMoreItems(MATCH).map((item) => item.id);
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
    const label = (id: string) => ru[PHONE_MORE.find((item) => item.id === id)!.label];
    expect([label('diplomacy'), label('corporation'), label('steward')]).toEqual([
      'Дипломатия',
      'Корпорация',
      'Хранитель',
    ]);
    for (const item of PHONE_MORE)
      expect(ru[item.label], item.id).not.toMatch(/^(Дипло|Корп|Сон)$/);
  });

  it('в забеге «Ещё» без инструментов мультиплеера, но с торговцем и «Завершить» (правило 3)', () => {
    const ids = phoneMoreItems(RUN).map((item) => item.id);
    expect(ids).toEqual(['diplomacy', 'trader', 'dossier', 'codex', 'settings', 'abandon', 'exit']);
  });

  it('каждый раздел и пункт нажимает кнопку, которая есть в разметке', () => {
    // Переименуй кнопку — и пункт молча перестанет открывать окно.
    const selectors = [
      ...PHONE_TABS.map((tab) => tab.opens),
      ...PHONE_MORE.map((item) => item.opens),
    ];
    for (const selector of selectors) {
      if (selector === null) continue;
      const id = /^#([\w-]+)/.exec(selector)?.[1];
      expect(MARKUP, `id="${id}" в build.mjs`).toContain(`id="${id}"`);
    }
    expect(MAIN, 'кнопка сохранения строки статуса').toContain('data-solo-save="1"');
  });

  it('у каждой подписи есть текст в обеих локалях', () => {
    for (const key of [...PHONE_TABS, ...PHONE_MORE].map((item) => item.label)) {
      expect(ru[key], key).toBeTruthy();
      expect(en[key], key).toBeTruthy();
    }
  });
});

describe('подсветка и нажатия разделов', () => {
  const opened =
    (...tabs: PhoneSection[]) =>
    (tab: PhoneSection): boolean =>
      tabs.includes(tab);

  it('подсвечен раздел, чьё окно открыто; иначе «Ещё», пока открыт лист, иначе карта (правило 5)', () => {
    expect(activePhoneTab(opened())).toBe('map');
    expect(activePhoneTab(opened('science'))).toBe('science');
    expect(activePhoneTab(opened('more'))).toBe('more');
    expect(activePhoneTab(opened('more', 'events'))).toBe('events');
  });

  it('нажатие открывает раздел, а повторное и «Карта» ведут к карте (правило 4)', () => {
    expect(phoneTabTap('science', 'map')).toBe('science');
    expect(phoneTabTap('production', 'science')).toBe('production');
    expect(phoneTabTap('more', 'events')).toBe('more');
    expect(phoneTabTap('science', 'science')).toBeNull();
    expect(phoneTabTap('more', 'more')).toBeNull();
    expect(phoneTabTap('map', 'events')).toBeNull();
  });

  it('значки: бои на «Событиях», письма на «Ещё», ноль прячет (правило 6)', () => {
    expect(phoneBadges(3, 2, false)).toEqual({ events: '3', more: '2' });
    expect(phoneBadges(0, 0, false)).toEqual({ events: '', more: '' });
    expect(phoneBadges(Number.NaN, -1, false)).toEqual({ events: '', more: '' });
  });

  it('пока лист «Ещё» открыт, число писем стоит на плитке, а не на разделе (правило 6)', () => {
    expect(phoneBadges(1, 4, true)).toEqual({ events: '1', more: '' });
  });
});
