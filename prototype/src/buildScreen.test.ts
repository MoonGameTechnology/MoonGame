import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { newGame, canOrder, data, order } from './game';
import { buildBuilding, upgradeBuilding } from '../../decisions/actions';
import { cost } from './format';
import { buildingLevel } from '../../packages/shared-core/src/index';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import {
  BUILD_CATEGORIES,
  buildCategory,
  buildFx,
  buildRowState,
  buildScreenHtml,
  initBuildScreen,
  unitScreenHtml,
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

/** Разметка одной строки окна: от её `bw-item` до следующей. */
function rowOf(out: string, id: string): string {
  const at = out.indexOf(`data-bw="${id}"`);
  if (at < 0) return '';
  const next = out.indexOf('<div class="bw-item', at);
  return out.slice(out.lastIndexOf('<div class="bw-item', at), next < 0 ? undefined : next);
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
    // Доля защиты мира (решение владельца 2026-09-26): у форта своя, по уровню.
    expect(buildFx(data.buildings.fort!, 1)).toContain('−15% урона по миру');
    expect(buildFx(data.buildings.fort!, 3)).toContain('−45% урона по миру');
    // 5% есть у каждого здания — это дефолт, а не эффект: строкой не пишется, в «оборону»
    // обычное здание не уводит.
    expect(buildFx(data.buildings.mine!, 1)).not.toContain('урона по миру');
    expect(buildCategory(data.buildings.mine!)).toBe('economy');
    expect(buildCategory(data.buildings.barracks!)).toBe('infra');
    // YARD-1: «строит корабли» — примета ВЕРФИ, а у порта своя строка про ангар. До
    // разделения обе висели на одном здании, и про челноки экран не говорил ничего.
    expect(buildFx(data.buildings.shipyard!, 1)).toContain('кораблей');
    expect(buildFx(data.buildings.spaceport!, 1)).toContain('шаттлы');
    expect(buildFx(data.buildings.spaceport!, 1)).not.toContain('кораблей');
  });

  it('эффект считается ДЛЯ УРОВНЯ: та же шахта на L3 даёт больше', () => {
    expect(buildFx(data.buildings.mine!, 3)).toContain('+27');
  });

  it('прибавка налоговой — с её уровня, а не с первого (+25 → +35 → +50%)', () => {
    expect(buildFx(data.buildings.tax_office!, 1)).toContain('+25%');
    expect(buildFx(data.buildings.tax_office!, 2)).toContain('+35%');
    expect(buildFx(data.buildings.tax_office!, 3)).toContain('+50%');
    expect(buildFx(data.buildings.refinery!, 3)).toContain('+18');
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

  it('органы Роя у не-Роя прячутся: строить их может только Рой (E_SWARM_ONLY)', () => {
    const s = newGame();
    for (const organ of ['biomass_pit', 'swarm_synapse', 'swarm_hive'])
      expect(buildRowState(s, 'p1', home(s), organ, probe(s), noQueue).st).toBe('hidden');
    expect(html(s, home(s))).not.toContain('data-bw="biomass_pit"');
  });

  it('вид провинции не пускает здание — строки нет, а не замок (решение владельца 2026-09-26)', () => {
    const s = newGame();
    const pid = home(s);
    // Астероид строит только добывающую станцию: верфь и форт на нём не предлагаются,
    // даже если ядро отказало бы им раньше по другой причине.
    s.planets[pid]!.kind = 'asteroid';
    const standing = new Set(s.planets[pid]!.buildings.map((b) => b.type));
    const barred = ['shipyard', 'fort', 'radar', 'refinery', 'power_plant'].filter((id) => !standing.has(id));
    expect(barred.length).toBeGreaterThan(0);
    for (const id of barred)
      expect(buildRowState(s, 'p1', pid, id, () => 'E_TECH_LOCKED', noQueue).st).toBe('hidden');
    expect(buildRowState(s, 'p1', pid, 'metal_station', () => 'E_TECH_LOCKED', noQueue).st).toBe('lock');
    expect(html(s, pid)).not.toContain(`data-bw="${barred[0]}"`);
    // Уже стоящее остаётся: его улучшают, даже если вид мира сменился после постройки.
    const built = s.planets[pid]!.buildings[0]!.type;
    expect(html(s, pid)).toContain(`data-bw="${built}"`);
  });

  // Ядро крепости ставит `station.deploy`, а не стройка: в ростере крепости его нет, и проба
  // «поставить ещё одно» отвечает видом раньше, чем «уже стоит».
  it('стоящее ядро крепости — построенное, а не замок «неверный тип сектора»', () => {
    const s = newGame();
    const pid = home(s);
    s.planets[pid]!.kind = 'void_station';
    s.planets[pid]!.buildings.push({ type: 'starfort', level: 2, hp: 110 });
    expect(canOrder(s, buildBuilding('p1', pid, 'starfort'))).toBe('E_WRONG_SECTOR');
    expect(buildRowState(s, 'p1', pid, 'starfort', probe(s), noQueue)).toMatchObject({
      st: 'built',
      level: 2,
      count: 1,
    });
    expect(html(s, pid)).not.toContain('код:E_WRONG_SECTOR');
  });

  it('заказ в очереди хоста читается как «строится»', () => {
    const s = newGame();
    expect(buildRowState(s, 'p1', home(s), 'fort', probe(s), () => true).st).toBe('queued');
  });

  // Очередь хоста (main.ts) знает и улучшения: у стоящего здания в ней лежит следующий
  // уровень, и строка горела «строится» с первым уровнем вместо своего.
  it('идущее улучшение — «улучшается», ждущее — «в очереди», оба со своим уровнем', () => {
    const s0 = newGame();
    const pid = home(s0);
    const a = order(s0, upgradeBuilding('p1', pid, 'mine'), s0.time);
    expect(a.error).toBeUndefined();
    const b = order(a.state, upgradeBuilding('p1', pid, 'radar'), a.state.time);
    expect(b.error).toBeUndefined();
    const s = b.state;
    // Полоса зданий занята улучшением шахты — радар ждёт в очереди мира.
    expect(s.planets[pid]!.buildQueue?.map((q) => [q.kind, q.building])).toEqual([
      ['upgrade', 'radar'],
    ]);
    const hostQueued = (p: string, id: string) =>
      (s.planets[p]?.buildQueue ?? []).some((q) => q.building === id);
    const out = buildScreenHtml(s, 'p1', pid, probe(s), hostQueued, lockText);
    for (const [id, waiting, label] of [
      ['mine', false, '⏳ улучшается'],
      ['radar', true, '⏳ в очереди'],
    ] as const) {
      expect(buildRowState(s, 'p1', pid, id, probe(s), hostQueued)).toMatchObject({
        st: 'built',
        level: 1,
        up: { up: 'queued', waiting },
      });
      const row = rowOf(out, id);
      expect(row, id).toContain(label);
      expect(row, id).toContain('Ур. 1 / 3');
      expect(row, id).not.toContain('строится');
      expect(row, id).not.toContain('data-bw-up');
    }
  });

  it('новое здание: идущая стройка — «строится», ждущая в очереди мира — «в очереди»', () => {
    const s0 = newGame();
    const pid = home(s0);
    const a = order(s0, buildBuilding('p1', pid, 'fort'), s0.time);
    expect(a.error).toBeUndefined();
    const b = order(a.state, buildBuilding('p1', pid, 'refinery'), a.state.time);
    expect(b.error).toBeUndefined();
    const s = b.state;
    expect(s.planets[pid]!.buildQueue?.map((q) => [q.kind, q.building])).toEqual([
      ['building', 'refinery'],
    ]);
    expect(buildRowState(s, 'p1', pid, 'fort', probe(s), noQueue)).toEqual({
      st: 'queued',
      waiting: false,
    });
    expect(buildRowState(s, 'p1', pid, 'refinery', probe(s), noQueue)).toEqual({
      st: 'queued',
      waiting: true,
    });
    const out = html(s, pid);
    expect(rowOf(out, 'fort')).toContain('⏳ строится');
    expect(rowOf(out, 'refinery')).toContain('⏳ в очереди');
  });

  it('стоящее здание остаётся построенным, чем бы ни отказала проба «поставить ещё одно»', () => {
    const s = newGame();
    const pid = home(s);
    // Места кончились, технология не изучена — улучшению это не мешает, и строка не замок.
    for (const code of ['E_NO_BUILD_SLOTS', 'E_TECH_LOCKED']) {
      const answer = (a: Action) => (a.type === 'building.construct' ? code : canOrder(s, a));
      expect(buildRowState(s, 'p1', pid, 'mine', answer, noQueue), code).toMatchObject({
        st: 'built',
        up: { up: 'ready', affordable: true },
      });
    }
  });

  it('незнакомый код отказа НЕ прячется — строка показывает причину', () => {
    const s = newGame();
    const st = buildRowState(s, 'p1', home(s), 'fort', () => 'E_НОВОЕ_ПРАВИЛО', noQueue);
    expect(st).toEqual({ st: 'lock', code: 'E_НОВОЕ_ПРАВИЛО' });
    // У стоящего здания та же причина встаёт на место «Улучшить».
    const built = buildRowState(s, 'p1', home(s), 'mine', () => 'E_НОВОЕ_ПРАВИЛО', noQueue);
    expect(built).toMatchObject({ st: 'built', up: { up: 'lock', code: 'E_НОВОЕ_ПРАВИЛО' } });
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
    expect(out).toContain('Экономика');
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

  // Сообщение владельца 2026-10-03: у построенного горело «Построено», и не было видно,
  // что у здания есть уровни.
  it('построенное — с уровнем и кнопкой «Улучшить», доступное — кнопкой «Строить»', () => {
    const out = html(s, pid);
    const row = rowOf(out, 'mine');
    expect(row).toContain('st-up');
    expect(row).toContain('Ур. 1 / 3');
    expect(row).toContain('<button class="bw-take btn-main" data-bw-up="mine">▲ Улучшить</button>');
    expect(row).not.toContain('data-bw-go');
    expect(row).not.toContain('bw-st done');
    expect(out).toMatch(/data-bw-go="fort"(?! disabled)/);
  });

  it('на пределе уровней — «Макс. уровень», без кнопки и без цены', () => {
    const s2 = newGame();
    const pid2 = home(s2);
    s2.planets[pid2]!.buildings.find((b) => b.type === 'mine')!.level = 3;
    expect(buildRowState(s2, 'p1', pid2, 'mine', probe(s2), noQueue)).toMatchObject({
      st: 'built',
      level: 3,
      up: { up: 'max' },
    });
    const row = rowOf(html(s2, pid2), 'mine');
    expect(row).toContain('Ур. 3 / 3');
    expect(row).toContain('✓ Макс. уровень');
    expect(row).toContain('st-built');
    expect(row).not.toContain('data-bw-up');
    expect(row).not.toContain('bw-foot');
  });

  it('здание без уровней — «Построено», без значка уровня', () => {
    const s2 = newGame();
    const pid2 = home(s2);
    const hp = data.buildings.spaceport!.hp;
    s2.planets[pid2]!.buildings.push({ type: 'spaceport', level: 1, hp });
    const row = rowOf(html(s2, pid2), 'spaceport');
    expect(row).toContain('✓ Построено');
    expect(row).not.toContain('bw-lv');
    expect(row).not.toContain('data-bw-up');
  });

  it('без казны «Улучшить» гаснет, а не исчезает — причина видна', () => {
    const poor = newGame();
    poor.players.p1!.resources = {};
    const row = rowOf(html(poor, home(poor)), 'mine');
    expect(row).toContain('data-bw-up="mine" disabled');
    expect(row).toContain('Не хватает ресурсов');
  });

  it('безденежному кнопка гаснет, а не исчезает — причина видна', () => {
    const poor = newGame();
    poor.players.p1!.resources = {};
    const out = html(poor, home(poor));
    expect(out).toContain('data-bw-go="fort" disabled');
    expect(out).toContain('Не хватает ресурсов');
  });

  it('уровень — у стоящего здания и словами, у нестоящего уровня нет', () => {
    const out = html(s, pid);
    expect(rowOf(out, 'mine')).toContain('<i class="bw-lv">Ур. 1 / 3</i>');
    expect(rowOf(out, 'shipyard')).toContain('<i class="bw-lv">Ур. 2 / 3</i>');
    expect(rowOf(out, 'fort')).not.toContain('bw-lv');
  });

  it('у построенного в подвале — цена СЛЕДУЮЩЕГО уровня с пометкой ▲', () => {
    // шахта стоит на домашнем мире стартом (newGame) — ряд built из живого состояния
    const row = rowOf(html(s, pid), 'mine');
    expect(row).toContain('<i class="bw-next">▲ Ур. 2</i>');
    const next = buildingLevel(data.buildings.mine!, 2).cost;
    expect(row).toContain(cost(next, s.players.p1!.resources));
  });

  it('чужой мир не отдаёт разметку с кнопками заказа', () => {
    const s2 = newGame();
    const enemy = Object.values(s2.planets).find((x) => x.owner && x.owner !== 'p1');
    if (!enemy) return;
    expect(html(s2, enemy.id)).not.toContain('data-bw-go');
    expect(html(s2, enemy.id)).not.toContain('data-bw-up');
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
    const upgraded: Array<[string, string]> = [];
    const opened: string[] = [];
    const host: BuildHost = {
      root: () => root,
      body: () => body,
      state: () => s,
      me: () => 'p1',
      probe: (a) => canOrder(s, a),
      localQueued: () => false,
      build: (pid, id) => built.push([pid, id]),
      upgrade: (pid, id) => upgraded.push([pid, id]),
      unitIds: () => ['militia'],
      buildUnit: (pid, id) => built.push([pid, id]),
      openUnitInfo: (id) => opened.push(id),
      openInfo: (id) => opened.push(id),
      lockText,
      dossierBody: () => 'описание',
    };
    return { api: initBuildScreen(host), root, body, s, built, upgraded, opened };
  }

  it('units reuse the catalog and send a unit order, without opening the dossier', () => {
    const { api, root, body, s, built, opened } = wire();
    api.open(home(s), 'ground');
    expect(body.html()).toContain('bw-list');
    expect(body.html()).toContain('data-unit-info="militia"');
    root.fire(tap('[data-unit-go]', { unitGo: 'militia' }));
    expect(built).toEqual([[home(s), 'militia']]);
    expect(opened).toEqual([]);
  });

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

  it('«Улучшить» в строке улучшает и НЕ открывает карточку поверх', () => {
    const { api, root, s, built, upgraded, opened } = wire();
    api.open(home(s));
    root.fire(tap('[data-bw-up]', { bwUp: 'mine' }));
    expect(upgraded).toEqual([[home(s), 'mine']]);
    expect(built).toEqual([]);
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
    expect(src).toMatch(
      /id: 'buildwin',\s*isOpen: \(\) => buildWinEl\.classList\.contains\('show'\)/,
    );
  });

  it('кадровый цикл держит открытое окно живым (стройка достраивается на глазах)', () => {
    // Дроссель вынесен в `liveWindows.ts` (REFM-194); сторож проверяет ту же связку —
    // окно открыто, отметка СВОЯ (`lastBuildAt`), срок — полсекунды окон с прогрессом.
    expect(src).toContain('repaintDue(buildWin.isOpen(), nowReal, lastBuildAt, PROGRESS_MS)');
  });

  it('заказ идёт хостовым путём enqueueBuild — сеть и соло не разъезжаются', () => {
    expect(src).toMatch(
      /build: \(pid, id\) => enqueueBuild\(pid, \{ kind: 'building', id, count: 1 \}\)/,
    );
  });

  it('улучшение — тем же enqueueBuild, что «Улучшить» в карточке здания', () => {
    expect(src).toMatch(
      /upgrade: \(pid, id\) => enqueueBuild\(pid, \{ kind: 'upgrade', id, count: 1 \}\)/,
    );
    expect(src).toContain("enqueueBuild(selPlanet, { kind: 'upgrade', id: upg, count: 1 })");
  });
});

describe('окно юнитов — десантный челнок строится с бойцом (SHU-5.2)', () => {
  /** Мой мир с портом, казармами (если просят) и полной казной. */
  function staged(barracks: boolean): { s: GameState; pid: string } {
    const s = newGame();
    const pid = home(s);
    const p = s.planets[pid]!;
    p.buildings = [
      ...p.buildings.filter((b) => b.type !== 'spaceport' && b.type !== 'barracks'),
      { type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp },
      ...(barracks ? [{ type: 'barracks', level: 1, hp: data.buildings.barracks!.hp }] : []),
    ];
    s.players.p1!.resources = {
      metal: 9000,
      credits: 9000,
      energy: 9000,
      food: 9000,
      microelectronics: 9000,
    };
    return { s, pid };
  }

  it('ВМЕСТО ОДНОЙ КНОПКИ — по кнопке на бойца, которого ядро примет на этом мире', () => {
    const { s, pid } = staged(true);
    const out = unitScreenHtml(s, 'p1', pid, ['landing_shuttle'], probe(s), lockText);
    expect(out).toContain('data-unit-troop="militia"');
    // Танку нужен завод, а его на мире нет — такого бойца не предлагают.
    expect(out).not.toContain('data-unit-troop="tank"');
    // Каждая предложенная кнопка — приказ, который ядро и правда примет.
    for (const m of out.matchAll(/data-unit-troop="([^"]+)"/g)) {
      const a = {
        id: 'x',
        type: 'unit.build',
        playerId: 'p1',
        issuedAt: 0,
        payload: { planetId: pid, unit: 'landing_shuttle', count: 1, troop: m[1] },
      };
      expect(canOrder(s, a), m[1]).toBeNull();
    }
  });

  it('НЕКОГО ПОСАДИТЬ — строка заперта кодом отказа ядра, кнопок нет', () => {
    const { s, pid } = staged(false);
    const out = unitScreenHtml(s, 'p1', pid, ['landing_shuttle'], probe(s), lockText);
    expect(out).toContain('bw-st lock');
    expect(out).not.toContain('data-unit-troop=');
  });
});

describe('каталог юнитов окна производства — с портретами', () => {
  // Портреты кораблей пропали, когда каталог переехал из боковой панели в это окно:
  // строка осталась с текстовым значком (замечание владельца 2026-09-29).
  it('у корабля и у десантного челнока в строке — портрет корпуса', () => {
    const s = newGame();
    const pid = Object.values(s.planets).find((p) => p.owner === 'p1')!.id;
    const out = unitScreenHtml(s, 'p1', pid, ['frigate', 'cruiser', 'landing_shuttle'], probe(s), lockText);
    for (const art of ['frigate', 'cruiser', 'dropship'])
      expect(out, art).toContain(`data-ship-art="${art}"`);
    expect(out.match(/bw-item[^"]*with-art/g)).toHaveLength(3);
  });
});
