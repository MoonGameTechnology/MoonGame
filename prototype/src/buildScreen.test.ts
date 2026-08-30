import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame, canOrder, data } from './game';
import { buildingLevel } from '../../packages/shared-core/src/index';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import {
  BUILD_CATEGORIES,
  buildCategory,
  buildFx,
  buildRowState,
  buildScreenHtml,
  initBuildScreen,
  type BuildHost,
} from './buildScreen';

// Локаль прибита к RU (как в format.test.ts): у Node нет языка браузера, рантайм
// свалился бы в EN и утверждения по подписям поехали бы.
beforeAll(() => setLocale('ru'));

/** Мой домашний мир — на старте на нём уже что-то стоит (космопорт из newGame). */
function home(s: GameState): string {
  const p = Object.values(s.planets).find((x) => x.owner === 'p1' && x.buildings.length > 0);
  if (!p) throw new Error('нет домашнего мира с постройками');
  return p.id;
}

const probe = (s: GameState) => (a: Action) => canOrder(s, a);
const noQueue = () => false;
const lockText = (code: string) => `код:${code}`;

function html(s: GameState, pid: string) {
  return buildScreenHtml(s, 'p1', pid, probe(s), noQueue, lockText);
}

describe('окно построек — категории из данных', () => {
  it('категория выводится из полей здания, а не из рукописного списка id', () => {
    expect(buildCategory(data.buildings.mine!)).toBe('economy');
    expect(buildCategory(data.buildings.tax_office!)).toBe('economy'); // creditsBonus — тоже экономика
    expect(buildCategory(data.buildings.fort!)).toBe('defense');
    expect(buildCategory(data.buildings.orbital_aa!)).toBe('defense');
    expect(buildCategory(data.buildings.barracks!)).toBe('infra');
    expect(buildCategory(data.buildings.spaceport!)).toBe('infra');
  });

  it('каждое здание каталога попадает ровно в одну из трёх категорий', () => {
    const keys = BUILD_CATEGORIES.map((c) => c.key);
    for (const def of Object.values(data.buildings)) expect(keys).toContain(buildCategory(def));
  });

  // Госпиталь — единственный источник восстановления гарнизона; в каталоге прототипа
  // его не было вовсе, хотя ядро `healRate` умеет считать с самого начала.
  it('полевой госпиталь есть в каталоге и лечит гарнизон', () => {
    const hospital = data.buildings.hospital;
    expect(hospital).toBeDefined();
    expect(buildingLevel(hospital!, 1).healRate).toBeGreaterThan(0);
    expect(buildCategory(hospital!)).toBe('infra'); // не экономика и не оборона
  });
});

describe('окно построек — строка эффекта', () => {
  it('производство и содержание читаются с одного взгляда', () => {
    expect(buildFx(data.buildings.mine!, 1)).toContain('+12');
    expect(buildFx(data.buildings.refinery!, 1)).toContain('−40'); // upkeep — со знаком минус (BAL-3)
    expect(buildFx(data.buildings.fort!, 1)).toContain('к обороне');
    expect(buildFx(data.buildings.spaceport!, 1)).toContain('кораблей');
  });

  it('эффект считается ДЛЯ УРОВНЯ: та же шахта на L3 даёт больше', () => {
    expect(buildFx(data.buildings.mine!, 3)).toContain('+27');
  });

  it('здание без числового эффекта отдаёт пустую строку (ряд возьмёт досье)', () => {
    expect(buildFx(data.buildings.barracks!, 1)).toBe('');
  });
});

describe('окно построек — состояние строки от пробы ядра', () => {
  it('построенное — built с уровнем, доступное — avail, без казны — не оплачиваемое', () => {
    const s = newGame();
    const pid = home(s);
    const built = s.planets[pid]!.buildings[0]!.type;
    const st = buildRowState(s, 'p1', pid, built, probe(s), noQueue);
    expect(st.st).toBe('built');
    const poor = newGame();
    poor.players.p1!.resources = {};
    const pAvail = buildRowState(poor, 'p1', home(poor), 'refinery', probe(poor), noQueue);
    expect(pAvail).toEqual({ st: 'avail', affordable: false });
  });

  it('E_FORBIDDEN прячет строку целиком (CMD-VIS: чего нельзя — того нет)', () => {
    const s = newGame();
    expect(buildRowState(s, 'p1', home(s), 'mine', () => 'E_FORBIDDEN', noQueue).st).toBe('hidden');
  });

  it('локальная соло-очередь читается как «строится» — ядро о ней не знает', () => {
    const s = newGame();
    expect(buildRowState(s, 'p1', home(s), 'mine', probe(s), () => true).st).toBe('queued');
  });

  it('незнакомый код отказа НЕ прячется — строка показывает причину', () => {
    const s = newGame();
    const st = buildRowState(s, 'p1', home(s), 'mine', () => 'E_НОВОЕ_ПРАВИЛО', noQueue);
    expect(st).toEqual({ st: 'lock', code: 'E_НОВОЕ_ПРАВИЛО' });
  });
});

describe('окно построек — разметка', () => {
  const s = newGame();
  const pid = home(s);

  it('шапка: имя мира, тип с честными бонусами и счётчик построенного', () => {
    const out = html(s, pid);
    expect(out).toContain('bw-world');
    expect(out).toContain(`построено: ${s.planets[pid]!.buildings.length}`);
    expect(out).not.toContain('Слоты'); // бюджета слотов у ядра нет — не выдумываем
  });

  it('категории идут заголовками, пустые не рисуются', () => {
    const out = html(s, pid);
    expect(out).toContain('ЭКОНОМИКА');
    expect((out.match(/bw-cath/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('вкладки категорий рисуются, активна — «все»', () => {
    const out = html(s, pid);
    expect(out).toContain('bw-tabs');
    expect(out).toContain('data-bwtab="*"');
    expect(out).toContain('data-bwtab="economy"');
    expect(out).toContain('data-bwtab="defense"');
    // «все» активна по умолчанию — подсвечена
    const at = out.indexOf('data-bwtab="*"');
    expect(out.slice(at - 20, at + 20)).toContain('on');
  });

  it('активная вкладка фильтрует строки — только её категория', () => {
    const out = buildScreenHtml(s, 'p1', pid, probe(s), noQueue, lockText, undefined, 'defense');
    expect(out).toContain('data-bwtab="defense"');
    // в режиме одной вкладки заголовки-секции не рисуются
    expect(out).not.toContain('bw-cath');
    // экономика скрыта — её здания не попадают в вывод
    const atMine = out.indexOf('data-bw="mine"');
    // mine — экономика, при активной «обороне» её не должно быть
    expect(atMine).toBe(-1);
    // fort — оборона, должен быть
    expect(out).toContain('data-bw="fort"');
  });

  it('построенное — галочкой без кнопки, доступное — кнопкой с приказом', () => {
    const out = html(s, pid);
    const built = s.planets[pid]!.buildings[0]!.type;
    const at = out.indexOf(`data-bw="${built}"`);
    const row = out.slice(at, at + 400);
    expect(row).toContain('bw-st done');
    expect(row).not.toContain('data-bw-go');
    expect(out).toMatch(/data-bw-go="fort"(?! disabled)/);
  });

  it('безденежному кнопка гаснет, а не исчезает — причина видна', () => {
    const poor = newGame();
    poor.players.p1!.resources = {};
    const out = html(poor, home(poor));
    expect(out).toContain('data-bw-go="fort" disabled');
    expect(out).toContain('Не хватает ресурсов');
  });

  it('здание с прокачкой несёт римский уровень в имени', () => {
    const out = html(s, pid);
    const at = out.indexOf('data-bw="mine"');
    expect(out.slice(at, at + 200)).toContain('bw-lv');
  });

  it('у построенного в подвале — цена СЛЕДУЮЩЕГО уровня с пометкой ▲', () => {
    // шахта стоит на домашнем мире стартом (newGame) — ряд built из живого состояния
    const out = html(s, pid);
    const at = out.indexOf('data-bw="mine"');
    expect(out.slice(at, at + 900)).toContain('bw-next');
    expect(out.slice(at, at + 400)).toContain('bw-st done');
  });

  it('чужой мир не отдаёт разметку с кнопками заказа', () => {
    const s2 = newGame();
    const enemy = Object.values(s2.planets).find((x) => x.owner && x.owner !== 'p1');
    if (!enemy) return;
    expect(html(s2, enemy.id)).not.toContain('data-bw-go');
  });
});

describe('окно построек — проводка', () => {
  function fakeEl(): HTMLElement & {
    fire: (t: unknown) => void;
    shown: () => boolean;
    html: () => string;
  } {
    let handler: ((ev: unknown) => void) | null = null;
    const classes = new Set<string>();
    const el = {
      innerHTML: '',
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        contains: (c: string) => classes.has(c),
      },
      querySelector: () => null,
      addEventListener: (_t: string, h: (ev: unknown) => void) => {
        handler = h;
      },
      fire: (target: unknown) => handler?.({ target }),
      shown: () => classes.has('show'),
      html: () => (el as { innerHTML: string }).innerHTML,
    };
    return el as unknown as ReturnType<typeof fakeEl>;
  }

  const tap = (sel: string, dataset: Record<string, string> = {}): unknown => ({
    classList: { contains: () => false },
    closest: (q: string) => (q === sel ? { dataset } : null),
  });

  function wire() {
    const root = fakeEl();
    const body = fakeEl();
    const s = newGame();
    const built: Array<[string, string]> = [];
    const opened: string[] = [];
    const host: BuildHost = {
      root: () => root,
      body: () => body,
      state: () => s,
      me: () => 'p1',
      probe: (a) => canOrder(s, a),
      localQueued: () => false,
      build: (pid, id) => built.push([pid, id]),
      openInfo: (id) => opened.push(id),
      lockText,
      dossierBody: () => 'описание',
    };
    return { api: initBuildScreen(host), root, body, s, built, opened };
  }

  it('open() красит тело для нужного мира и показывает окно', () => {
    const { api, root, body, s } = wire();
    api.open(home(s));
    expect(root.shown()).toBe(true);
    expect(body.html()).toContain('bw-list');
  });

  it('кнопка в строке заказывает и НЕ открывает карточку поверх', () => {
    const { api, root, s, built, opened } = wire();
    api.open(home(s));
    root.fire(tap('[data-bw-go]', { bwGo: 'refinery' }));
    expect(built).toEqual([[home(s), 'refinery']]);
    expect(opened).toEqual([]);
  });

  it('тап по строке открывает карточку здания', () => {
    const { api, root, s, opened } = wire();
    api.open(home(s));
    root.fire(tap('[data-bw]', { bw: 'fort' }));
    expect(opened).toEqual(['fort']);
  });

  it('крестик закрывает окно', () => {
    const { api, root, s } = wire();
    api.open(home(s));
    root.fire({ classList: { contains: (c: string) => c === 'tw-close' }, closest: () => null });
    expect(api.isOpen()).toBe(false);
  });

  it('тап по вкладке переключает фильтр категорий', () => {
    const { api, root, s, body } = wire();
    api.open(home(s));
    // по умолчанию «все» — шахта (экономика) видна
    expect(body.html()).toContain('data-bw="mine"');
    // тап по вкладке «оборона»
    root.fire(tap('[data-bwtab]', { bwtab: 'defense' }));
    expect(body.html()).toContain('data-bwtab="defense"');
    // экономика скрыта на активной вкладке обороны
    expect(body.html()).not.toContain('data-bw="mine"');
    // тап по «все» возвращает экономику
    root.fire(tap('[data-bwtab]', { bwtab: '*' }));
    expect(body.html()).toContain('data-bw="mine"');
  });
});

// Подключение к хосту живёт в main.ts без юнит-обвязки — сканом исходника, как в
// cmdVisibility.test.ts: кнопка панели, ступень Back и живая перерисовка кадра.
describe('окно построек — подключение к main.ts', () => {
  const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('кнопка «Построить» панели открывает окно выбранного мира', () => {
    expect(src).toContain("act === 'openbuild'");
    expect(src).toContain('buildWin.open(selPlanet!)');
  });

  it('окно стоит в лестнице Android-Back', () => {
    expect(src).toMatch(/id: 'buildwin',\s*isOpen: \(\) => buildWinEl\.classList\.contains\('show'\)/);
  });

  it('кадровый цикл держит открытое окно живым (стройка достраивается на глазах)', () => {
    expect(src).toContain('buildWin.isOpen() && nowReal - lastBuildAt > 500');
  });

  it('заказ идёт хостовым путём enqueueBuild — сеть и соло не разъезжаются', () => {
    expect(src).toMatch(/build: \(pid, id\) => enqueueBuild\(pid, \{ kind: 'building', id, count: 1 \}\)/);
  });
});
