/**
 * Карточка мира (REFM-223) — прямой тест владельца.
 *
 * Карточка рисует известный мир (шапка, вкладки, очереди стройки), мир вне зрения (память
 * скана или «нет телеметрии»), развилку тропы и ангар с карточками эскадр, а мир, место,
 * имена, открытую вкладку и плитки гарнизона берёт у игры хуками. Здесь проверено то, что
 * текстом не проверить: какая вкладка открыта и что на ней, кому видны очередь, каталог и
 * окно построек, что помнит туман, какие двери закрыты в забеге Sector Zero и как карточки
 * эскадр меняют кнопки под взведённое слияние. Каждый тест — свежая загрузка модуля над своим
 * миром. В конце — стык с `main.ts`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { setLocale, t, tData } from '../../localization/runtime';
import {
  buildingLevel,
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
  type ShuttleStrike,
  type UnitStack,
} from '../../packages/shared-core/src/index';
import { buildingName, resLine } from './format';
import { data } from './gameData';
import { fleetHangar, planetHangar } from './hangarPanel';
import type { SectorType } from './map';
import { worldName } from './planetName';
import type { Snapshot } from './scanMemory';
import { HOUR } from './time';
import type { PlanetTab } from './worldCard';

// Под Node нет языка браузера: рантайм свалился бы в EN, и подписи разъехались бы с ожиданиями.
beforeAll(() => setLocale('ru'));

const planet = (id: string, owner: string | null, extra: Partial<Planet> = {}): Planet =>
  ({
    id,
    owner,
    kind: 'planet',
    planetType: 'terran',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    links: [],
    ...extra,
  }) as Planet;

const player = (id: string, extra: Partial<Player> = {}): Player =>
  ({
    id,
    name: id,
    faction: 'azure',
    status: 'active',
    resources: { credits: 5000, metal: 5000 },
    ...extra,
  }) as Player;

const fleet = (
  id: string,
  owner: string,
  location: string,
  units: UnitStack[],
  extra = {},
): Fleet =>
  ({
    id,
    owner,
    location,
    movement: null,
    units,
    traits: [],
    battleId: null,
    ...extra,
  }) as unknown as Fleet;

const sq = (id: string, unit = 'interceptor', count = 2) => ({ id, units: [{ unit, count }] });

/** Я — p1: столица C и мир A с портом и рудником; N — мир соперника p2; Z — ничейный. */
function world(): GameState {
  const st = createInitialState({ seed: 'worldcard', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...st,
    time: 10 * HOUR,
    capital: { p1: 'C' },
    planets: {
      A: planet('A', 'p1', {
        buildings: [
          { type: 'mine', level: 2, hp: 1000 },
          { type: 'spaceport', level: 1, hp: 1000 },
        ],
        garrison: [
          { unit: 'militia', count: 3 },
          { unit: 'cruiser', count: 1 },
        ],
        hangar: [sq('sq:1'), sq('sq:2')],
      }),
      C: planet('C', 'p1'),
      N: planet('N', 'p2', { garrison: [{ unit: 'militia', count: 4 }] }),
      Z: planet('Z', null),
    },
    players: { p1: player('p1'), p2: player('p2') },
    fleets: {
      F1: fleet('F1', 'p1', 'A', [{ unit: 'cruiser', count: 2 }]),
      F2: fleet('F2', 'p2', 'A', [{ unit: 'cruiser', count: 1 }]),
    },
  } as unknown as GameState;
}

/** Свежая загрузка карточки над миром и игрой, которая записывает, что от неё просили. */
async function boot(over: Record<string, unknown> = {}) {
  vi.resetModules();
  const env = {
    s: world(),
    names: { p1: 'Орион', p2: 'Багровые' } as Record<string, string>,
    tab: 'buildings' as PlanetTab,
    units: ['cruiser', 'militia', 'interceptor'] as readonly string[],
    dev: false,
    kinds: {} as Record<string, string>,
    types: {} as Record<string, SectorType>,
    hidden: false,
    pc: true,
    merge: null as { from: string } | null,
    memory: {} as Record<string, Snapshot>,
    intel: [] as Array<{ kind: string; target: string; until: number }>,
    stewardTech: false,
    relocate: false,
    ...over,
  };
  const rec = { tiles: [] as Array<[string | null, UnitStack[]]> };

  // Окна, прицелы, туман и выбор тянут холст и окно браузера — подменены: карточка берёт у них
  // только эти флаги.
  vi.doMock('./graphicsPrefs', () => ({ pcUi: () => env.pc }));
  vi.doMock('./interaction', () => ({
    get squadMerge() {
      return env.merge;
    },
  }));
  vi.doMock('./mapAim', () => ({ squadronRelocateSpots: () => (env.relocate ? [{}] : []) }));
  vi.doMock('./mapFog', () => ({
    memory: { get: (id: string) => env.memory[id] },
    myIntel: () => env.intel,
  }));
  vi.doMock('./stewardScreen', () => ({ stewardTechDone: () => env.stewardTech }));
  // Палитра держит свою связь с игрой и стойки; карточке нужен только цвет стороны.
  vi.doMock('./mapPalette', () => ({
    ownerColor: (owner: string | null) => (owner ? `#side-${owner}` : '#neutral'),
    youColor: '#you',
  }));

  // Свежая загрузка берёт и свежий рантайм локали: без языка браузера он встал бы на EN.
  (await import('../../localization/runtime')).setLocale('ru');
  // Очередь стройки и кошелёк карточка читает через запросы к миру (REFM-242).
  (await import('./worldQueries')).initWorldQueries({
    world: () => env.s,
    me: () => 'p1',
    note: () => {},
    placeName: (id) => id,
    playerOrder: () => true,
    buildingLocked: () => null as never,
  });
  const m = await import('./worldCard');
  m.initWorldCard({
    world: () => env.s,
    me: () => 'p1',
    names: () => env.names,
    planetTab: () => env.tab,
    buildUnits: () => env.units,
    devUi: () => env.dev,
    sectorOf: (id) => env.kinds[id],
    sectorType: (id) => env.types[id],
    garrisonTiles: (owner, stacks) => {
      rec.tiles.push([owner, stacks]);
      return `<i class="tiles">${owner}:${stacks.map((x) => `${x.unit}×${x.count}`).join(',')}</i>`;
    },
    sectorZeroToolsHidden: () => env.hidden,
  });
  /** Карточка известного мира на открытой вкладке. */
  const card = (id: string, tab: PlanetTab = env.tab): string => {
    env.tab = tab;
    return m.planetPanelHtml(env.s.planets[id]!);
  };
  return { m, env, rec, card };
}

/** Подзаголовок шапки: всё, что стоит в `<span>` рядом с именем. */
const sub = (html: string): string =>
  /<div class="ptitle"><b>[^<]*<\/b><span>([^<]*)<\/span>/.exec(html)![1]!;
/** Кнопка действия панели по `data-act` и `data-arg`. */
const act = (name: string, arg: string): string => `data-act="${name}" data-arg="${arg}"`;

// Первая загрузка карточки тянет ядро, данные и решения — секунды под нагрузкой полного гейта.
// Граф греется один раз; тесты после `vi.resetModules()` берут его из кеша трансформаций.
beforeAll(async () => {
  vi.stubGlobal('__PLAYER_BUILD__', false);
  await boot();
  vi.unstubAllGlobals();
}, 60_000);
beforeEach(() => {
  vi.stubGlobal('__PLAYER_BUILD__', false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('шапка известного мира', () => {
  it('имя места и владелец по имени из игры; код узла — только в режиме отладки', async () => {
    const { env, card } = await boot();
    const html = card('A');
    expect(html).toContain(`<b>${worldName(env.s, 'A')}</b>`);
    expect(sub(html)).toMatch(/^Орион·/);
    env.dev = true;
    expect(sub(card('A'))).toMatch(/^A·Орион·/);
  });

  it('род узла — тип сектора с карты, без него — сырой род, без обоих — прочерк', async () => {
    const { env, card } = await boot();
    const typeName = tData(data.planetTypes.terran!.name ?? 'terran');
    env.types.A = { name: 'Asteroid Field' } as SectorType;
    env.kinds.A = 'raw-kind';
    expect(sub(card('A'))).toContain(`·${tData('Asteroid Field')}·${typeName}`);
    delete env.types.A;
    expect(sub(card('A'))).toContain(`·raw-kind·${typeName}`);
    delete env.kinds.A;
    expect(sub(card('A'))).toContain(`·—·${typeName}`);
  });

  it('ничейный мир подписан ничейным', async () => {
    const { card } = await boot();
    expect(sub(card('Z'))).toMatch(new RegExp(`^${t('side.neutral')}·`));
  });

  it('очки победы стоят у имени, в забеге Sector Zero их нет', async () => {
    const { env, card } = await boot();
    expect(card('A')).toContain('data-desc="fact:vp"');
    env.hidden = true;
    expect(card('A')).not.toContain('data-desc="fact:vp"');
  });

  it('факты мира: своя столица отмечена, чужая — нет', async () => {
    const { card } = await boot();
    expect(card('C')).toContain('data-desc="fact:capital"');
    expect(card('A')).not.toContain('data-desc="fact:capital"');
  });
});

describe('действия мира', () => {
  it('столицу предлагают на своём мире, кроме самой столицы, и не на чужом', async () => {
    const { card } = await boot();
    expect(card('A')).toContain(act('capital', ''));
    expect(card('C')).not.toContain(act('capital', ''));
    expect(card('N')).not.toContain(act('capital', ''));
  });

  it('точка удержания — с изученным Хранителем; лимит гасит кнопку, а снять можно всегда', async () => {
    const { env, card } = await boot();
    expect(card('A')).not.toContain('data-act="holdpoint"');
    env.stewardTech = true;
    expect(card('A')).toContain(`${act('holdpoint', 'on')} >`);
    expect(card('N')).not.toContain('data-act="holdpoint"');
    env.s.players.p1!.stewardHoldPoints = ['C', 'Z'];
    expect(card('A')).toContain(`${act('holdpoint', 'on')} disabled>`);
    env.s.players.p1!.stewardHoldPoints = ['A', 'C'];
    expect(card('A')).toContain(`${act('holdpoint', 'off')} >`);
  });

  it('разведка чужого мира — кнопкой, а открытое окно — отсчётом вместо неё', async () => {
    const { env, card } = await boot();
    expect(card('N')).toContain(act('spyplanet', 'p2'));
    expect(card('A')).not.toContain('data-act="spyplanet"');
    env.intel = [{ kind: 'planet', target: 'N', until: env.s.time + 3 * HOUR }];
    const html = card('N');
    expect(html).toContain(t('side.world.spy-window'));
    expect(html).not.toContain('data-act="spyplanet"');
  });

  it('в забеге Sector Zero нет ни пинга, ни разведки', async () => {
    const { env, card } = await boot();
    expect(card('N')).toContain(act('ping', ''));
    env.hidden = true;
    const html = card('N');
    expect(html).not.toContain('data-act="ping"');
    expect(html).not.toContain('data-act="spyplanet"');
  });
});

describe('вкладки', () => {
  it('открытая вкладка подсвечена, у каждой — счётчик', async () => {
    const { card } = await boot();
    const html = card('A', 'ships');
    expect(html).toContain(`<button class="ptab on" ${act('tab', 'ships')}`);
    expect(html).toContain(`<button class="ptab" ${act('tab', 'ground')}`);
    expect(html).toMatch(/data-arg="ground" data-desc="tab:ground">[^<]+<b>3<\/b>/);
  });

  it('земля: плитки гарнизона рисует игра, очередь и каталог юнитов — только своему миру', async () => {
    const { rec, card } = await boot();
    const mine = card('A', 'ground');
    expect(rec.tiles.at(-1)).toEqual(['p1', [{ unit: 'militia', count: 3 }]]);
    expect(mine).toContain('<i class="tiles">p1:militia×3</i>');
    expect(mine).toContain(t('side.units.conveyor'));
    expect(mine).toContain(act('openunits', 'ground'));
    const foe = card('N', 'ground');
    expect(foe).toContain('<i class="tiles">p2:militia×4</i>');
    expect(foe).not.toContain(t('side.units.conveyor'));
    expect(foe).not.toContain('data-act="openunits"');
  });

  it('каталог юнитов открывается только там, где ростер игры что-то предлагает', async () => {
    const { env, card } = await boot({ units: ['cruiser'] });
    expect(card('A', 'ground')).not.toContain('data-act="openunits"');
    expect(card('A', 'ships')).toContain(act('openunits', 'ships'));
    env.units = [];
    expect(card('A', 'ships')).not.toContain('data-act="openunits"');
  });

  it('подсказка вкладки — только на телефоне: на ПК она в досье по наведению', async () => {
    const { env, card } = await boot();
    expect(card('A', 'ground')).not.toContain(t('dossier.tab.ground.desc'));
    env.pc = false;
    expect(card('A', 'ground')).toContain(t('dossier.tab.ground.desc'));
  });

  it('орбита: флоты у мира, свой — с кнопкой выбора; корабли гарнизона — плитками', async () => {
    const { rec, card } = await boot();
    const html = card('A', 'ships');
    expect(html).toContain(t('side.world.fleet-ships', { n: 2 }));
    expect(html).toContain(act('selfleet', 'F1'));
    expect(html).not.toContain(act('selfleet', 'F2'));
    expect(rec.tiles.at(-1)).toEqual(['p1', [{ unit: 'cruiser', count: 1 }]]);
  });

  it('пустая орбита говорит словами, а не пропадает', async () => {
    const { card } = await boot();
    const html = card('Z', 'ships');
    expect(html).toContain(
      `<div class="sec">${t('side.world.fleets')}</div><div class="row dim">${t('side.none')}</div>`,
    );
  });

  it('эскадра без порта прямо говорит, что держать её негде', async () => {
    const { card } = await boot();
    expect(card('Z', 'shuttle')).toContain(t('side.wing.no-port'));
    expect(card('A', 'shuttle')).not.toContain(t('side.wing.no-port'));
  });

  it('единственный свой носитель у мира: перегрузка адресует флот, а не мир', async () => {
    const { env, card } = await boot();
    // Трюм есть и у крейсеров F1: два кандидата — и кнопок нет, кому грузить, не угадывают.
    env.s.fleets.K = fleet('K', 'p1', 'A', [{ unit: 'shuttle_carrier', count: 1 }]);
    expect(card('A', 'shuttle')).not.toContain('data-act="wingload"');
    delete env.s.fleets.F1;
    expect(card('A', 'shuttle')).toContain(act('wingload', 'K'));
  });

  it('постройки: доход уровня у плитки, окно построек — только своему миру', async () => {
    const { card } = await boot();
    const mine = card('A', 'buildings');
    const income = resLine(buildingLevel(data.buildings.mine!, 2).produces, { per: 'h' });
    expect(income).not.toBe('');
    expect(mine).toContain(income);
    expect(mine).toContain(buildingName(data.buildings.mine!.name, 'mine'));
    expect(mine).toContain('data-act="openbuild"');
    expect(mine).toContain(t('side.build.conveyor'));
    const foe = card('N', 'buildings');
    expect(foe).toContain(t('side.none'));
    expect(foe).not.toContain('data-act="openbuild"');
    expect(foe).not.toContain(t('side.build.conveyor'));
  });
});

describe('очередь стройки', () => {
  it('ждущий заказ и пауза стоят на своей полосе', async () => {
    const { env, card } = await boot();
    const a = env.s.planets.A!;
    a.buildQueue = [{ id: 11, kind: 'unit', playerId: 'p1', unit: 'cruiser', count: 2 }];
    a.pausedConstruction = [
      {
        id: 7,
        kind: 'building',
        playerId: 'p1',
        building: 'farm',
        progress: 0.5,
        remainingHours: 2,
        remainingCost: {},
      },
    ];
    const units = card('A', 'ground');
    expect(units).toContain(act('dequeue', '11'));
    expect(units).not.toContain(act('resumebuild', '7'));
    const blds = card('A', 'buildings');
    expect(blds).toContain(act('resumebuild', '7'));
    expect(blds).not.toContain(act('dequeue', '11'));
  });
});

describe('мир вне зрения', () => {
  it('память скана: владелец, гарнизон, постройки и разведка чужого мира', async () => {
    const { env, m } = await boot();
    env.memory.N = { owner: 'p2', garrison: 5, buildings: [{ type: 'mine', level: 1 }] };
    const html = m.unknownPlanetHtml(env.s.planets.N!);
    expect(html).toContain(t('side.scan.stale'));
    expect(html).toContain('<b>Багровые</b>');
    expect(html).toContain('<b>5</b>');
    expect(html).toContain(`${buildingName(data.buildings.mine!.name, 'mine')} L1`);
    expect(html).toContain(act('spyplanet', 'p2'));
    env.memory.N = { owner: 'p1', garrison: 0, buildings: [] };
    const own = m.unknownPlanetHtml(env.s.planets.N!);
    expect(own).toContain(t('side.scan.no-buildings'));
    expect(own).not.toContain('data-act="spyplanet"');
  });

  it('без памяти — «нет телеметрии», с пингом', async () => {
    const { env, m } = await boot();
    const html = m.unknownPlanetHtml(env.s.planets.Z!);
    expect(html).toContain(t('side.notelemetry.title'));
    expect(html).toContain(act('ping', ''));
    env.hidden = true;
    expect(m.unknownPlanetHtml(env.s.planets.Z!)).not.toContain('data-act="ping"');
  });

  it('в забеге Sector Zero память скана не предлагает разведку', async () => {
    const { env, m } = await boot({ hidden: true });
    env.memory.N = { owner: 'p2', garrison: 5, buildings: [] };
    expect(m.unknownPlanetHtml(env.s.planets.N!)).not.toContain('data-act="spyplanet"');
  });
});

describe('развилка', () => {
  it('тропа называет выходы по именам; в чужой провинции крепость не ставят', async () => {
    const { env, m } = await boot();
    env.s.planets.N!.roads = { trails: [{ exits: ['A', 'Z'] }] } as never;
    const html = m.forkPanelHtml({ province: 'N', trail: 0 });
    expect(html).toContain(`<b>${worldName(env.s, 'A')}</b>, <b>${worldName(env.s, 'Z')}</b>`);
    expect(html).toContain(t('side.fork.not-owned'));
    expect(html).not.toContain('data-act="forkfortress"');
  });
});

describe('ангар', () => {
  it('порт и трюм называют себя сами', async () => {
    const { env, m } = await boot();
    const port = planetHangar(env.s.planets.A!, data)!;
    const ship = fleet('K', 'p1', 'A', [{ unit: 'shuttle_carrier', count: 1 }], {
      hangar: [sq('sq:9')],
    });
    env.s.fleets.K = ship;
    const hold = fleetHangar(ship, data, env.s)!;
    expect(m.hangarSectionHtml(port, 'A', true)).toContain(
      t('side.wing.hangar', { used: port.used, bay: port.bay }),
    );
    const holdHtml = m.hangarSectionHtml(hold, 'K', true);
    expect(holdHtml).toContain(t('side.wing.hold', { used: hold.used, bay: hold.bay }));
    expect(holdHtml).not.toContain(t('side.wing.hangar', { used: hold.used, bay: hold.bay }));
  });

  it('карточка эскадры: позывной, места и удар; чужой ангар — без кнопок', async () => {
    const { env, m } = await boot();
    const port = planetHangar(env.s.planets.A!, data)!;
    const html = m.hangarSectionHtml(port, 'A', true);
    expect(html.match(/data-act="wingstrike"/g)).toHaveLength(2);
    expect(html).toContain(act('wingstrike', 'sq:1'));
    expect(html).toContain(t('side.wing.places', { n: 2 }));
    expect(m.hangarSectionHtml(port, 'A', false)).not.toContain('data-act="wingstrike"');
  });

  it('пустой ангар говорит словами — одной строкой, без второй причины «поднимать нечего»', async () => {
    const { env, m } = await boot();
    env.s.planets.A!.hangar = [];
    const port = planetHangar(env.s.planets.A!, data)!;
    const html = m.hangarSectionHtml(port, 'A', true);
    expect(html.endsWith(`<div class="row dim">${t('side.wing.empty')}</div>`)).toBe(true);
    expect(html).not.toContain(t('side.wing.blocked.empty'));
  });

  it('слияние: источник ждёт выбора, остальные звенья его принимают', async () => {
    const { env, m } = await boot();
    const port = planetHangar(env.s.planets.A!, data)!;
    expect(m.hangarSectionHtml(port, 'A', true)).toContain(act('wingmerge', 'sq:2'));
    env.merge = { from: 'sq:1' };
    const html = m.hangarSectionHtml(port, 'A', true);
    expect(html).toContain(act('wingmergeto', 'sq:2'));
    expect(html).toContain(t('side.wing.merge.pick'));
  });

  it('перелёт — только когда есть куда', async () => {
    const { env, m } = await boot();
    const port = planetHangar(env.s.planets.A!, data)!;
    expect(m.hangarSectionHtml(port, 'A', true)).not.toContain('data-act="wingrelocate"');
    env.relocate = true;
    expect(m.hangarSectionHtml(port, 'A', true)).toContain(act('wingrelocate', 'sq:1'));
  });

  it('патрули своей базы стоят над ангаром: удержание и возврат', async () => {
    const { env, m } = await boot();
    const strike = {
      id: 'st:1',
      owner: 'p1',
      base: { kind: 'planet', id: 'A' },
      squadronId: 'sq:7',
      units: [{ unit: 'interceptor', count: 1 }],
      target: { kind: 'point' },
      to: { x: 0, y: 0 },
      leg: 'patrol',
      departedAt: 0,
      arrivesAt: env.s.time + 2 * HOUR,
      patrol: { radius: 50 },
    } as unknown as ShuttleStrike;
    env.s.strikes = [strike];
    const port = planetHangar(env.s.planets.A!, data)!;
    const html = m.hangarSectionHtml(port, 'A', true);
    expect(html).toContain(act('wingkeep', 'st:1'));
    expect(html).toContain(act('wingrecall', 'st:1'));
    expect(m.hangarSectionHtml(port, 'A', false)).not.toContain('data-act="wingrecall"');
    env.s.strikes = [{ ...strike, base: { kind: 'planet', id: 'C' } } as ShuttleStrike];
    expect(m.hangarSectionHtml(port, 'A', true)).not.toContain('data-act="wingrecall"');
  });
});

describe('строки состава', () => {
  it('наземный и космический юнит помечены своим словом; пусто — «нет»', async () => {
    const { m } = await boot();
    const html = m.unitRows([
      { unit: 'militia', count: 2 },
      { unit: 'interceptor', count: 1 },
    ]);
    expect(html).toContain(t('side.unit.ground'));
    expect(html).toContain(t('side.unit.space'));
    expect(m.unitRows([])).toContain(t('side.none'));
  });
});

describe('стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('main поднимает карточку один раз и отдаёт ей своё состояние', () => {
    expect(MAIN.match(/\ninitWorldCard\(\{/g)).toHaveLength(1);
    for (const hook of [
      'world: () => s,',
      'planetTab: () => planetTab,',
      'buildUnits: () => BUILD_UNITS,',
      'devUi: () => DEV_UI,',
      'sectorOf: (id) => SECTOR_OF[id],',
      'sectorType: sectorTypeOf,',
      'garrisonTiles: garrisonTilesHtml,',
    ]) {
      expect(MAIN).toContain(hook);
    }
  });

  it('панель и карточка флота зовут карточки модуля', () => {
    // Выбор карточки листа — у хозяина боковой панели (`sidePanel.ts`, REFM-225).
    const PANEL = readFileSync(new URL('./sidePanel.ts', import.meta.url), 'utf8');
    expect(PANEL).toContain('if (selFork) return forkPanelHtml(selFork);');
    expect(PANEL).toContain(
      'return pick.known ? planetPanelHtml(pick.planet) : unknownPlanetHtml(pick.planet);',
    );
    // Секцию ангара зовёт карточка флота — с REFM-224 она в `fleetCard.ts`.
    const FLEET = readFileSync(new URL('./fleetCard.ts', import.meta.url), 'utf8');
    expect(FLEET).toContain('hangarSectionHtml(hold, f.id, true)');
  });

  it('копий карточки в main не осталось', () => {
    for (const gone of [
      'function planetPanelHtml',
      'function unknownPlanetHtml',
      'function forkPanelHtml',
      'function hangarSectionHtml',
      'function squadronCardHtml',
      'function patrolRowsHtml',
      'function conveyorHtml',
      'function unitCatalogButton',
      'function incomeOf',
      'function unitRows',
      'function tabButton',
      'type PlanetTab =',
    ]) {
      expect(MAIN).not.toContain(gone);
    }
  });
});
