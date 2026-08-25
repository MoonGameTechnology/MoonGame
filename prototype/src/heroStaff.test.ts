import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import {
  HERO_TABS,
  ownHeroes,
  normalizeHeroView,
  initHeroStaff,
  HERO_CASTABLE,
  heroCdKey,
  nodeDepth,
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

  /** Текст внутри `.hx-name` — шапка досье, единственное место, где героя НАЗЫВАЮТ. */
  const identName = (html: string): string =>
    html.match(/<span class="hx-name">♔ ([^<]*)<\/span>/)?.[1] ?? '';

  it('ШАПКА досье называет роту переводом, а не ключом локали', () => {
    // `hero:p1:2` носит в состоянии `HeroLoadout.name` — то есть КЛЮЧ
    // `hero.arch.destroyer`. Сырой рендер показывал игроку сам ключ.
    const staff = initHeroStaff(hostOf());
    staff.click(click('[data-hsel]', { hsel: 'hero:p1:2' }));
    const html = staff.paneHtml();
    expect(identName(html)).toBe('Разрушитель');
    expect(html).not.toContain('hero.arch.');
  });

  it('ГЛАВНЫЙ герой носит имя места, и имя ДОМА в нём переводится', () => {
    // Главному `matchSetup` кладёт `seat.name`: в соло это имя дома из данных
    // («Azure Compact»), в сети — позывной живого игрока. Ключ роты тут не при чём.
    expect(identName(initHeroStaff(hostOf()).paneHtml())).toBe('Лазурный пакт');
  });

  it('ПОЗЫВНОЙ игрока в шапке не переводится и не теряется', () => {
    const s = staffed();
    s.heroes!['hero:p1:1']!.name = 'Вульфакс';
    expect(identName(initHeroStaff(hostOf({ state: () => s })).paneHtml())).toBe('Вульфакс');
  });

  it('вкладка «Дерево» открыта по умолчанию и показывает узлы', () => {
    const html = initHeroStaff(hostOf()).paneHtml();
    expect(html).toContain('hx-tree');
  });

  it('в дереве трансгуманиста видны ВСЕ ЧЕТЫРЕ узла ветки, включая запертые', () => {
    // Жалоба владельца с живой игры: «не наблюдаю 3 и 4 узлов». Рейка ветки рисует
    // весь каталог, а не только доступное — запертый узел показывается с замком и
    // рассказывает в досье, чего ему не хватает. Сторож держит именно это: добавили
    // узел в данные — он обязан появиться игроку, а не потеряться в UI.
    const html = initHeroStaff(hostOf()).paneHtml();
    for (const node of [
      'hero.tree.neural-lace.name',
      'hero.tree.overclocked-helm.name',
      'hero.tree.corridor-sustained.name',
      'hero.tree.corridor-open.name',
    ]) {
      expect(html, node).toContain(t(node));
    }
    expect(html).toContain('🔒'); // ступени заперты, пока не взят родитель
  });

  it('ветка читается сверху вниз В ПОРЯДКЕ ПРОКАЧКИ, а не по алфавиту', () => {
    // Жалоба владельца: «Общий коридор» стоял выше «Разогнанного шлема», хотя качается
    // последним. Причина — сортировка по ЧИСЛУ родителей: у всей цепочки коридора его
    // по одному, дальше вступал алфавит (`corridor_open` < `corridor_sustained` <
    // `overclocked_helm`). Теперь порядок задаёт ГЛУБИНА цепочки.
    const html = initHeroStaff(hostOf()).paneHtml();
    const order = ['neural-lace', 'overclocked-helm', 'corridor-sustained', 'corridor-open'].map(
      (k) => html.indexOf(t(`hero.tree.${k}.name`)),
    );
    expect(order.every((i) => i >= 0)).toBe(true); // все четыре на экране
    expect(order).toEqual([...order].sort((a, b) => a - b)); // и именно в этом порядке
  });

  it('глубина узла — длина самого длинного пути до корня, цикл в данных не вешает UI', () => {
    const trees = {
      root: { requires: [] },
      mid: { requires: ['root'] },
      leaf: { requires: ['mid'] },
      // Две дороги до корня: считается ДЛИННАЯ, иначе узел встанет выше своего же деда.
      forked: { requires: ['root', 'leaf'] },
      loopA: { requires: ['loopB'] },
      loopB: { requires: ['loopA'] },
    };
    expect(nodeDepth('root', trees)).toBe(0);
    expect(nodeDepth('mid', trees)).toBe(1);
    expect(nodeDepth('leaf', trees)).toBe(2);
    expect(nodeDepth('forked', trees)).toBe(3);
    // Цикл обрывается на повторе узла В ТЕКУЩЕМ пути, а не рекурсирует вечно: обход
    // проходит loopA → loopB и упирается в loopA, то есть длину самого цикла. Важно не
    // конкретное число, а что оно конечно и рендер не виснет.
    expect(nodeDepth('loopA', trees)).toBe(2);
    expect(nodeDepth('unknown', trees)).toBe(0); // нет в каталоге — корень (fail-secure)
  });

  it('переключение вкладки меняет тело панели', () => {
    const staff = initHeroStaff(hostOf());
    const tree = staff.paneHtml();
    staff.click(click('[data-htab]', { htab: 'fittings' }));
    const fittings = staff.paneHtml();
    expect(fittings).not.toBe(tree);
    expect(fittings).toContain('hx-tab on');
  });

  it('у каждой вкладки штаба своя иконка и локализованная подпись', () => {
    for (const tab of HERO_TABS) {
      expect(tab.label, tab.key).toMatch(/^hero\.hq\.tab\./);
      expect(t(tab.label), tab.key).not.toContain('hero.hq.tab');
      expect(tab.icon, tab.key).not.toBe('');
    }
    expect(new Set(HERO_TABS.map((x) => x.icon)).size).toBe(HERO_TABS.length);
    expect(initHeroStaff(hostOf()).paneHtml()).toContain('<i>\u22d4</i>'); // «Дерево»
  });

  it('вкладки идут СЕТКОЙ 2\u00d72, а не четырьмя ячейками в строку', () => {
    // Сторож над CSS: на четверти ширины телефона «Способности» не помещались.
    const rule = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8').match(
      /#herobody \.hx-tabs\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain('grid-template-columns:repeat(2,1fr)');
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
