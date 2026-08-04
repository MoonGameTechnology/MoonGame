import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import {
  ownHeroes,
  normalizeHeroView,
  initHeroStaff,
  HERO_CASTABLE,
  heroCdKey,
  type HeroView,
  type HeroStaffHost,
} from './heroStaff';

// REFM-14: locale pinned RU (see format.test.ts — Node has no browser language, so the
// runtime would fall back to EN and the label assertions would drift).
beforeAll(() => setLocale('ru'));

/** A match where p1 has a roster and can afford what the staff offers. */
function staffed(): GameState {
  const s = newGame();
  s.players.p1!.resources = {
    ...s.players.p1!.resources,
    metal: 9000,
    credits: 9000,
    energy: 9000,
    food: 9000,
    microelectronics: 9000,
  };
  return s;
}

const viewOf = (over: Partial<HeroView> = {}): HeroView => ({
  sel: null,
  tab: 'tree',
  dossier: null,
  ...over,
});

/** A click whose `closest(sel)` answers only for the selector we mean to hit. */
function click(sel: string, dataset: Record<string, string> = {}): HTMLElement {
  return { closest: (q: string) => (q === sel ? { dataset } : null) } as unknown as HTMLElement;
}

function hostOf(over: Partial<HeroStaffHost> = {}): HeroStaffHost {
  return {
    state: () => staffed(),
    me: () => 'p1',
    order: () => {},
    note: () => {},
    armCast: () => {},
    armSpawn: () => {},
    ...over,
  };
}

describe('штаб героев — свой ростер', () => {
  it('видны только свои герои, в устойчивом порядке', () => {
    const s = staffed();
    const mine = ownHeroes(s, 'p1');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((h) => h.owner === 'p1')).toBe(true);
    expect(mine.map((h) => h.id)).toEqual([...mine.map((h) => h.id)].sort());
    // чужой ростер — не наш
    expect(ownHeroes(s, 'p2').some((h) => mine.includes(h))).toBe(false);
  });

  it('у игрока без героев ростер пуст, а не падает', () => {
    const s = staffed();
    s.heroes = {};
    expect(ownHeroes(s, 'p1')).toEqual([]);
  });
});

describe('штаб героев — нормализация вида', () => {
  it('фокус проставляется сам — первый свой герой', () => {
    const s = staffed();
    const v = normalizeHeroView(s, 'p1', viewOf());
    expect(v.sel).toBe(ownHeroes(s, 'p1')[0]!.id);
  });

  it('фокус на своём герое переживает нормализацию', () => {
    const s = staffed();
    const second = ownHeroes(s, 'p1')[1] ?? ownHeroes(s, 'p1')[0]!;
    const v = normalizeHeroView(s, 'p1', viewOf({ sel: second.id }));
    expect(v.sel).toBe(second.id);
  });

  it('фокус на чужом/пропавшем герое снимается на своего', () => {
    const s = staffed();
    const v = normalizeHeroView(s, 'p1', viewOf({ sel: 'hero:p2:1' }));
    expect(ownHeroes(s, 'p1').some((h) => h.id === v.sel)).toBe(true);
  });

  it('без единого героя фокус честно пуст, а не указывает в никуда', () => {
    const s = staffed();
    s.heroes = {};
    expect(normalizeHeroView(s, 'p1', viewOf({ sel: 'hero:p1:1' })).sel).toBeNull();
  });

  it('нормализация не правит переданный вид (он — значение)', () => {
    const s = staffed();
    const src = viewOf();
    normalizeHeroView(s, 'p1', src);
    expect(src).toEqual(viewOf());
  });

  it('вкладка и досье нормализацию переживают', () => {
    const s = staffed();
    const v = normalizeHeroView(s, 'p1', viewOf({ tab: 'fittings', dossier: 'fit:x' }));
    expect(v.tab).toBe('fittings');
    expect(v.dossier).toBe('fit:x');
  });
});

describe('штаб героев — словарь способностей', () => {
  it('кастуемые типы — только те, что движок правда умеет', () => {
    expect(HERO_CASTABLE.has('recall')).toBe(true);
    expect(HERO_CASTABLE.has('temp_lane')).toBe(true);
    expect(HERO_CASTABLE.has('нет-такого-типа')).toBe(false);
  });

  it('ключ кулдауна зеркалит ядро: две встроенные ветки и префикс для эффектов', () => {
    expect(heroCdKey('temp_lane')).toBe('path');
    expect(heroCdKey('annihilate')).toBe('annihilate');
    expect(heroCdKey('recall')).toBe('fx:recall');
  });
});

describe('штаб героев — разметка панели', () => {
  it('панель несёт свой контейнер, чипы ростера и вкладки', () => {
    const html = initHeroStaff(hostOf()).paneHtml();
    expect(html).toContain('id="herobody"');
    expect(html).toContain('data-hsel=');
    expect(html).toContain('data-htab=');
  });

  it('без героев панель честно говорит, что ростер пуст', () => {
    const s = staffed();
    s.heroes = {};
    const html = initHeroStaff(hostOf({ state: () => s })).paneHtml();
    expect(html).toContain('hx-note');
    expect(html).not.toContain('data-hsel=');
  });

  it('отрисовка НЕ выбирает героя молча — вид правит только нормализация', () => {
    const s = staffed();
    const staff = initHeroStaff(hostOf({ state: () => s }));
    const before = JSON.stringify(s);
    staff.paneHtml();
    expect(JSON.stringify(s)).toBe(before); // состояние матча не тронуто
  });

  it('вкладка «Дерево» открыта по умолчанию и показывает узлы', () => {
    const html = initHeroStaff(hostOf()).paneHtml();
    expect(html).toContain('hx-tree');
  });

  it('переключение вкладки меняет тело панели', () => {
    const staff = initHeroStaff(hostOf());
    const tree = staff.paneHtml();
    staff.click(click('[data-htab]', { htab: 'fittings' }));
    const fittings = staff.paneHtml();
    expect(fittings).not.toBe(tree);
    expect(fittings).toContain('hx-tab on');
  });
});

describe('штаб героев — клики', () => {
  it('выбор героя перекрашивает панель и сбрасывает досье', () => {
    const s = staffed();
    const staff = initHeroStaff(hostOf({ state: () => s }));
    staff.click(click('[data-hnode]', { hnode: 'n1' }));
    const other = ownHeroes(s, 'p1')[1] ?? ownHeroes(s, 'p1')[0]!;
    expect(staff.click(click('[data-hsel]', { hsel: other.id }))).toBe('repaint');
    expect(staff.paneHtml()).not.toContain('hx-dossier');
  });

  it('крестик досье закрывает его', () => {
    const staff = initHeroStaff(hostOf());
    expect(staff.click(click('[data-hdclose]'))).toBe('repaint');
  });

  it('чужой клик не трогает панель — «нечего делать» возвращает null', () => {
    const staff = initHeroStaff(hostOf());
    expect(staff.click(click('.something-else'))).toBeNull();
  });

  it('дальний каст не шлёт приказ, а взводит карту и закрывает окно', () => {
    const s = staffed();
    const hero = ownHeroes(s, 'p1')[0]!;
    const armed: Array<[string, string]> = [];
    const sent: Action[] = [];
    const notes: string[] = [];
    const staff = initHeroStaff(
      hostOf({
        state: () => s,
        order: (a) => sent.push(a),
        note: (m) => notes.push(m),
        armCast: (h, ab) => armed.push([h, ab]),
      }),
    );
    // `corridor` — дальнобойная (range 600 в data/heroAbilities.json): цель выбирается тапом
    expect(staff.click(click('[data-hcast]', { hcast: hero.id, ab: 'corridor' }))).toBe('close');
    expect(armed).toEqual([[hero.id, 'corridor']]);
    expect(sent).toEqual([]); // приказ уйдёт после тапа по карте, не сейчас
    expect(notes.length).toBe(1); // игроку сказали, чего от него ждут
  });

  it('каст в упор уходит приказом сразу, окно остаётся открытым', () => {
    const s = staffed();
    const hero = ownHeroes(s, 'p1')[0]!;
    const armed: string[] = [];
    const sent: Action[] = [];
    const staff = initHeroStaff(
      hostOf({ state: () => s, order: (a) => sent.push(a), armCast: (h) => armed.push(h) }),
    );
    // `recall` — range 0: цель не нужна, карту взводить незачем
    expect(staff.click(click('[data-hcast]', { hcast: hero.id, ab: 'recall' }))).toBe('repaint');
    expect(armed).toEqual([]);
    expect(sent.length).toBe(1);
    expect(sent[0]!.type).toBe('hero.ability');
  });

  it('развёртывание взводит карту, закрывает окно и объясняет, куда тапать', () => {
    const s = staffed();
    const hero = ownHeroes(s, 'p1')[0]!;
    const armed: string[] = [];
    const notes: string[] = [];
    const staff = initHeroStaff(
      hostOf({ state: () => s, armSpawn: (h) => armed.push(h), note: (m) => notes.push(m) }),
    );
    expect(staff.click(click('[data-hspawn]', { hspawn: hero.id }))).toBe('close');
    expect(armed).toEqual([hero.id]);
    expect(notes.length).toBe(1);
  });

  it('покупка узла уходит приказом в ядро и гасит досье', () => {
    const s = staffed();
    const hero = ownHeroes(s, 'p1')[0]!;
    const sent: Action[] = [];
    const staff = initHeroStaff(hostOf({ state: () => s, order: (a) => sent.push(a) }));
    staff.click(click('[data-hnode]', { hnode: 'node-x' }));
    expect(staff.click(click('[data-hskill]', { hskill: hero.id, node: 'node-x' }))).toBe(
      'repaint',
    );
    expect(sent.length).toBe(1);
    expect(sent[0]!.type).toBe('hero.skill.unlock');
    expect(staff.paneHtml()).not.toContain('hx-dossier');
  });

  it('установка фиттинга уходит приказом в ядро', () => {
    const s = staffed();
    const hero = ownHeroes(s, 'p1')[0]!;
    const sent: Action[] = [];
    const staff = initHeroStaff(hostOf({ state: () => s, order: (a) => sent.push(a) }));
    expect(staff.click(click('[data-hfit]', { hfit: hero.id, fit: 'fit-x' }))).toBe('repaint');
    expect(sent.length).toBe(1);
    expect(sent[0]!.type).toBe('hero.fit');
  });
});
