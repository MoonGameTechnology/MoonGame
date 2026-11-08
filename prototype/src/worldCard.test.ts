/**
 * Карточка мира (REFM-223) — прямой тест владельца.
 *
 * Карточка рисует известный мир (окно «i», только сведения: UIX-10.12), мир вне зрения
 * (память скана или «нет телеметрии»), развилку тропы и ангар с карточками эскадр, а мир,
 * место и имена берёт у игры хуками. Здесь проверено то, что текстом не проверить: чего в «i»
 * больше нет (очередей, каталогов, приказов мира), что свёрнуто и что раскрывается, кому
 * видны доход и «Построить», что помнит туман, какие двери закрыты в забеге Sector Zero и как
 * карточки эскадр меняют кнопки под взведённое слияние. Каждый тест — свежая загрузка модуля
 * над своим миром. В конце — стык с `main.ts`.
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
import { buildingName, fmtEta, resLine } from './format';
import { data } from './gameData';
import { fleetHangar, planetHangar } from './hangarPanel';
import { liveRender, liveText } from './liveTimers.fixture';
import type { SectorType } from './map';
import { worldName } from './planetName';
import type { Snapshot } from './scanMemory';
import { HOUR } from './time';

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
    radar: {} as Record<string, number>,
    units: ['cruiser', 'militia', 'interceptor'] as readonly string[],
    dev: false,
    kinds: {} as Record<string, string>,
    types: {} as Record<string, SectorType>,
    hidden: false,
    pc: true,
    merge: null as { from: string } | null,
    memory: {} as Record<string, Snapshot>,
    surveyed: {} as Record<string, { kind?: string; at: number }>,
    intel: [] as Array<{ kind: string; target: string; until: number }>,
    stewardTech: false,
    relocate: false,
    ...over,
  };

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
    surveyed: (id: string) => env.surveyed[id],
    myIntel: () => env.intel,
    known: () => true,
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
    buildUnits: () => env.units,
    devUi: () => env.dev,
    sectorOf: (id) => env.kinds[id],
    sectorType: (id) => env.types[id],
    sectorZeroToolsHidden: () => env.hidden,
    radar: (p) => ({ reach: env.radar[p.id] ?? 0, identify: (env.radar[p.id] ?? 0) / 2 }),
  });
  /** Свёрнутые блоки «i» — тот же экземпляр модуля, что у карточки. */
  const folds = await import('./dossierFolds');
  /** Карточка известного мира. */
  const card = (id: string): string => m.planetPanelHtml(env.s.planets[id]!);
  return { m, env, folds, card };
}

/** Подзаголовок шапки: всё, что стоит в `<span>` рядом с именем. */
const sub = (html: string): string =>
  /<div class="ptitle"><b>[^<]*<\/b><span>([^<]*)<\/span>/.exec(html)![1]!;
/** Кнопка действия панели по `data-act` и `data-arg`. */
const act = (name: string, arg: string): string => `data-act="${name}" data-arg="${arg}"`;
/** Что увидит игрок после живого патча к моменту `now` (`liveTimers.ts`): текст без тегов. */
const seen = (html: string, now: number): string => liveText(html, now);

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
  it('имя места из игры, хозяина подпись не называет; код узла — только в режиме отладки', async () => {
    const { env, card } = await boot();
    const html = card('A');
    expect(html).toContain(`<b>${worldName(env.s, 'A')}</b>`);
    expect(sub(html)).not.toContain('Орион');
    expect(sub(card('N'))).not.toContain('Багровые');
    env.dev = true;
    expect(sub(card('A'))).toMatch(/^A·/);
  });

  it('одно имя в подписи пишется один раз (UIX-10.10)', async () => {
    const { env, card } = await boot();
    const sector = env.s.planets.A!.terrain;
    env.types.A = { name: data.sectors[sector ?? '']?.name ?? 'x' } as SectorType;
    const parts = sub(card('A')).split('·');
    expect(new Set(parts).size).toBe(parts.length);
  });

  it('хозяин чужого мира — кнопка с ником, у своего и ничейного её нет (UIX-10.10)', async () => {
    const { card } = await boot();
    const owner = t('side.world.owner', { name: 'Багровые' });
    expect(card('N')).toContain(`${act('seat', 'p2')} >${owner}</button>`);
    expect(card('A')).not.toContain('data-act="seat"');
    expect(card('Z')).not.toContain('data-act="seat"');
  });

  it('«Построить»: телефон кладёт его в действия своего мира, ПК — вниз карточки (UIX-10.10)', async () => {
    const { env, card } = await boot({ pc: false });
    const pacts = (html: string) => /<div class="pacts">.*?<\/div>/.exec(html)?.[0] ?? '';
    expect(pacts(card('A'))).toContain('data-act="openbuild"');
    expect(card('N')).not.toContain('data-act="openbuild"');
    env.pc = true;
    expect(pacts(card('A'))).not.toContain('data-act="openbuild"');
    expect(card('A')).toMatch(/<button class="bw-open btn-main" data-act="openbuild">[^<]+<\/button>$/);
    expect(card('N')).not.toContain('data-act="openbuild"');
  });

  it('род узла — тип сектора с карты, без него — сырой род, без обоих не пишется', async () => {
    const { env, card } = await boot();
    const typeName = tData(data.planetTypes.terran!.name ?? 'terran');
    env.types.A = { name: 'Asteroid Field' } as SectorType;
    env.kinds.A = 'raw-kind';
    expect(sub(card('A'))).toMatch(new RegExp(`^${tData('Asteroid Field')}·${typeName}`));
    delete env.types.A;
    expect(sub(card('A'))).toMatch(new RegExp(`^raw-kind·${typeName}`));
    delete env.kinds.A;
    // Прочерк на месте рода ничего не сообщал (UIX-10.5): подпись начинается с типа мира.
    expect(sub(card('A'))).toMatch(new RegExp(`^${typeName}`));
    expect(sub(card('A'))).not.toContain('—');
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

  it('факты мира: планета за лимитом управления отмечена, столица — нет (BAL-19)', async () => {
    const { env, card } = await boot();
    expect(card('A')).not.toContain('data-desc="fact:uncontrolled"');
    // Пять соседей столицы в прыжке от неё: вместе со столицей это лимит, и мир A, до
    // которого дорог нет, уходит за него.
    for (const id of ['P1', 'P2', 'P3', 'P4', 'P5']) {
      env.s.planets[id] = planet(id, 'p1', { links: ['C'] });
      env.s.planets.C!.links!.push(id);
    }
    expect(card('A')).toContain('data-desc="fact:uncontrolled"');
    expect(card('C')).not.toContain('data-desc="fact:uncontrolled"');
  });

  it('освоение: у взявшего — доля выхода, у потерявшего — право отбить с отсчётом (BAL-19)', async () => {
    const { env, card } = await boot();
    const since = env.s.time - 36 * HOUR; // середина трёх дней: (25% + 100%) / 2
    env.s.planets.A!.integration = { claim: 'p2', since, until: since + 72 * HOUR };
    expect(card('A')).toContain('data-desc="fact:integrating"');
    expect(seen(card('A'), env.s.time)).toContain('Освоение 63%');
    expect(card('A')).not.toContain('data-desc="fact:reclaim"');
    env.s.planets.N!.integration = { claim: 'p1', since, until: since + 72 * HOUR };
    expect(card('N')).toContain('data-desc="fact:reclaim"');
    expect(seen(card('N'), env.s.time)).toMatch(/Можно отбить 36(\.0)?ч/);
    // Освоение кончилось, а событие конца ещё не пришло: фишек нет.
    env.s.planets.A!.integration = { claim: 'p2', since: 0, until: env.s.time };
    expect(card('A')).not.toContain('data-desc="fact:integrating"');
  });
});

describe('действия мира', () => {
  it('столица и точка удержания — не в «i»: это приказы мира окна «Построить» (UIX-10.12)', async () => {
    const { env, card } = await boot({ stewardTech: true });
    env.s.players.p1!.stewardHoldPoints = ['A'];
    for (const id of ['A', 'C', 'N']) {
      expect(card(id)).not.toContain('data-act="capital"');
      expect(card(id)).not.toContain('data-act="holdpoint"');
    }
  });

  it('приказы шпионов чужого мира — под кнопкой «Шпионаж», один приказ — без неё (UIX-10.11)', async () => {
    const { m, card } = await boot();
    const closed = card('N');
    expect(closed).toContain(`${act('spymenu', 'N')} aria-expanded="false">${t('side.world.spy-menu')} ▸`);
    expect(closed).not.toContain('data-act="spyplanet"');
    expect(closed).not.toContain('spy-menu"');
    m.toggleSpyMenu('N');
    const open = card('N');
    expect(open).toContain('aria-expanded="true"');
    expect(open).toMatch(/<div class="spy-menu">.*data-act="spyplanet" data-arg="recon"/);
    // Свой мир: одна «Контрразведка» — меню не нужно.
    expect(card('A')).not.toContain('data-act="spymenu"');
    m.toggleSpyMenu('N');
    expect(card('N')).toBe(closed);
  });

  it('разведка чужого мира — кнопкой, а открытое окно — отсчётом вместо неё', async () => {
    const { env, m, card } = await boot();
    m.toggleSpyMenu('N');
    expect(card('N')).toContain(act('spyplanet', 'recon'));
    expect(card('A')).not.toContain(act('spyplanet', 'recon'));
    expect(card('A')).toContain(act('spyplanet', 'counter')); // SPY-11: свой мир охраняют
    // SPY-19: шанс и риск у операций чужого мира, у своего — нет
    expect(card('N')).toContain(t('side.scan.odds', { s: 60, r: 35 }));
    expect(card('A')).not.toContain(t('side.scan.odds', { s: 60, r: 35 }));
    env.intel = [{ kind: 'planet', target: 'N', until: env.s.time + 3 * HOUR }];
    const html = card('N');
    expect(html).toContain(t('side.world.spy-window'));
    expect(html).not.toContain(act('spyplanet', 'recon'));
  });

  it('саботаж и кража ресурсов — свои кнопки, и при открытом окне тоже (SPY-9)', async () => {
    const { env, m, card } = await boot();
    m.toggleSpyMenu('N');
    env.intel = [{ kind: 'planet', target: 'N', until: env.s.time + 3 * HOUR }];
    const html = card('N');
    expect(html).toContain(act('spyplanet', 'sabotage'));
    expect(html).toContain(act('spyplanet', 'theft'));
    expect(html).toContain(act('spyplanet', 'research'));
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

// Цифры отсчёта в разметке меняли её с каждым шагом часов, и лист пересобирался вместе с
// кнопками под курсором (как «Штурм» на высадке, #1801). В разметке — срок, цифры ставит патч.
describe('живые сроки не пересобирают лист', () => {
  it('окно разведки и саботаж своего мира: разметка та же, отсчёт идёт', async () => {
    const { env, m, card } = await boot();
    m.toggleSpyMenu('N');
    const t0 = env.s.time;
    env.intel = [{ kind: 'planet', target: 'N', until: t0 + 3 * HOUR }];
    env.s.planets.A!.disruptedUntil = t0 + 2 * HOUR;
    const spy = card('N');
    const own = card('A');
    expect(seen(spy, t0)).toContain(t('side.world.spy-window.left', { left: fmtEta(3) }));
    expect(seen(own, t0)).toContain(t('side.world.disrupted', { left: fmtEta(2) }));
    env.s.time = t0 + HOUR;
    expect(card('N')).toBe(spy);
    expect(card('A')).toBe(own);
    expect(seen(spy, env.s.time)).toContain(t('side.world.spy-window.left', { left: fmtEta(2) }));
    expect(seen(own, env.s.time)).toContain(t('side.world.disrupted', { left: fmtEta(1) }));
  });

  it('обстрел своего мира: фишка и подсказка со сроком залпа', async () => {
    const { env, card } = await boot();
    const t0 = env.s.time;
    env.s.diplomacy = { 'p1|p2': 'war' } as unknown as GameState['diplomacy'];
    Object.assign(env.s.fleets.F2!, { orbit: 'near', bombarding: true, bombardNextAt: t0 + HOUR });
    const html = card('A');
    expect(liveRender(html, t0)).toContain(`title="${t('side.world.bombard-next', { t: '1:00:00' })}"`);
    expect(seen(html, t0)).toContain('⊗ 1:00:00');
    env.s.time = t0 + 0.75 * HOUR;
    expect(card('A')).toBe(html);
    expect(seen(html, env.s.time)).toContain('⊗ 0:15:00');
  });

  it('патруль над ангаром: срок висения живой, кнопки «Держать» и «Вернуть» стоят', async () => {
    const { env, m } = await boot();
    const t0 = env.s.time;
    env.s.strikes = [
      {
        id: 'st:1',
        owner: 'p1',
        base: { kind: 'planet', id: 'A' },
        squadronId: 'sq:7',
        units: [{ unit: 'interceptor', count: 1 }],
        target: { kind: 'point' },
        to: { x: 0, y: 0 },
        leg: 'patrol',
        departedAt: 0,
        arrivesAt: t0 + 2 * HOUR,
        patrol: { radius: 50 },
      } as unknown as ShuttleStrike,
    ];
    const port = planetHangar(env.s.planets.A!, data)!;
    const html = m.hangarSectionHtml(port, 'A', true);
    expect(seen(html, t0)).toContain(fmtEta(2));
    env.s.time = t0 + HOUR;
    expect(m.hangarSectionHtml(port, 'A', true)).toBe(html);
    expect(seen(html, env.s.time)).toContain(fmtEta(1));
  });
});

describe('окно «i» — только сведения (UIX-10.12)', () => {
  it('вкладок, очередей, каталогов и приказов мира в нём нет', async () => {
    const { env, card } = await boot({ stewardTech: true });
    env.s.planets.A!.buildQueue = [{ id: 11, kind: 'unit', playerId: 'p1', unit: 'cruiser', count: 2 }];
    const html = card('A');
    for (const gone of ['data-act="tab"', 'data-act="openunits"', 'data-act="rally"', 'data-act="fortress"', 'class="conveyor"', 'data-act="dequeue"'])
      expect(html, gone).not.toContain(gone);
  });

  it('полоса дохода — только у своего мира, тап открывает разбор «откуда»', async () => {
    const { card } = await boot();
    expect(card('A')).toContain('<button class="dband" data-codex="income:A">');
    expect(card('A')).toContain(t('side.dossier.income.why'));
    expect(card('N')).not.toContain('class="dband"');
  });

  it('оборона: радар с кругом опознания, свой флот на орбите — кнопкой выбора', async () => {
    const { env, card } = await boot();
    expect(card('A')).not.toContain(t('side.dossier.radar'));
    env.radar.A = 330;
    const html = card('A');
    expect(html).toContain(t('side.dossier.radar.v', { d: 330, i: 165 }));
    expect(html).toContain(act('selfleet', 'F1'));
    expect(html).not.toContain(act('selfleet', 'F2'));
    expect(html).toContain(t('side.world.fleet-ships', { n: 2 }));
    expect(card('Z')).not.toContain(t('side.world.fleets'));
  });

  it('гарнизон сеткой: число отряда, полоска здоровья и тап в досье юнита', async () => {
    const { card } = await boot();
    const html = card('A');
    expect(html).toContain(`${t('side.dossier.garrison')} <b>4</b>`);
    expect(html).toMatch(/data-codex="u:militia"[^>]*><span class="dunit-t"><span>[^<]+<\/span><b>×3<\/b>/);
    expect(html).toContain('<span class="dhp full">');
    expect(card('Z')).toContain(`${t('side.dossier.garrison')} <b>0</b>`);
  });

  it('постройки свёрнуты, и каждая группа раскрывается отдельно; доход — на фишке', async () => {
    const { folds, card } = await boot();
    const mine = buildingName(data.buildings.mine!.name, 'mine');
    const income = resLine(buildingLevel(data.buildings.mine!, 2).produces, { per: 'h' });
    expect(income).not.toBe('');
    expect(card('A')).toContain(`${act('dossier', 'buildings')} aria-expanded="false"><span>${t('side.tab.buildings')}</span><b>2</b>`);
    expect(card('A')).not.toContain(mine);
    folds.toggleDossierBlock('buildings');
    expect(card('A')).toContain(act('dossier', 'grp:economy'));
    expect(card('A')).not.toContain(mine);
    folds.toggleDossierBlock('grp:economy');
    expect(card('A')).toContain(`data-codex="b:mine:2"`);
    expect(card('A')).toContain(income);
    // Пустой группы и пустого блока нет.
    expect(card('A')).not.toContain(act('dossier', 'grp:defense'));
    expect(card('N')).not.toContain(act('dossier', 'buildings'));
  });

  it('эскадра порта — свёрнутым блоком с приказами внутри; без порта блока нет', async () => {
    const { folds, card } = await boot();
    expect(card('A')).toContain(act('dossier', 'wing'));
    expect(card('A')).not.toContain('data-act="wingstrike"');
    folds.toggleDossierBlock('wing');
    expect(card('A')).toContain('data-act="wingstrike"');
    expect(card('Z')).not.toContain(act('dossier', 'wing'));
  });

  it('единственный свой носитель у мира: перегрузка адресует флот, а не мир', async () => {
    const { env, folds, card } = await boot();
    folds.toggleDossierBlock('wing');
    // Трюм есть и у крейсеров F1: два кандидата — и кнопок нет, кому грузить, не угадывают.
    env.s.fleets.K = fleet('K', 'p1', 'A', [{ unit: 'shuttle_carrier', count: 1 }]);
    expect(card('A')).not.toContain('data-act="wingload"');
    delete env.s.fleets.F1;
    expect(card('A')).toContain(act('wingload', 'K'));
  });
});

describe('мир вне зрения', () => {
  it('память скана экранирует недоверенные имена и неизвестные постройки (CWE-79)', async () => {
    const { env, m } = await boot();
    const payload = '<img src=x onerror="alert(1)">';
    env.names.p2 = payload;
    env.memory.N = { owner: 'p2', garrison: 5, buildings: [{ type: payload, level: 1 }] };
    const folds = await import('./dossierFolds');
    folds.toggleDossierBlock('buildings');
    folds.toggleDossierBlock('grp:infra');
    const html = m.unknownPlanetHtml(env.s.planets.N!);
    expect(html).not.toContain(payload);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('L1');
  });

  it('память скана: ник хозяина, гарнизон без состава, постройки и разведка чужого мира', async () => {
    const { env, m, folds } = await boot();
    env.memory.N = { owner: 'p2', garrison: 5, buildings: [{ type: 'mine', level: 1 }] };
    folds.toggleDossierBlock('buildings');
    folds.toggleDossierBlock('grp:economy');
    const html = m.unknownPlanetHtml(env.s.planets.N!);
    expect(html).toContain(t('side.scan.stale'));
    expect(html).toContain(`${act('seat', 'p2')} >${t('side.world.owner', { name: 'Багровые' })}</button>`);
    expect(html).toContain(`${t('side.dossier.garrison')} <b>≈5</b>`);
    expect(html).toContain(t('side.scan.garrison.hidden'));
    expect(html).toContain(buildingName(data.buildings.mine!.name, 'mine'));
    expect(html).toContain('data-codex="b:mine:1"');
    // Доход чужой постройки разведка не знает.
    expect(html).not.toContain('class="inc"');
    expect(html).toContain(act('spymenu', 'N'));
    m.toggleSpyMenu('N');
    const opened = m.unknownPlanetHtml(env.s.planets.N!);
    expect(opened).toContain(act('spyplanet', 'recon'));
    expect(opened).toContain(act('spyplanet', 'theft'));
    env.memory.N = { owner: 'p1', garrison: 0, buildings: [] };
    const own = m.unknownPlanetHtml(env.s.planets.N!);
    expect(own).not.toContain(act('dossier', 'buildings'));
    expect(own).not.toContain('data-act="spyplanet"');
  });

  it('снимок со временем называет свой возраст вместо строки «мог устареть»', async () => {
    const { env, m } = await boot();
    env.memory.N = { owner: 'p2', garrison: 5, buildings: [], at: env.s.time - 3.5 * HOUR };
    const html = m.unknownPlanetHtml(env.s.planets.N!);
    expect(html).toContain(t('side.scan.age', { n: 3 }));
    expect(html).not.toContain(t('side.scan.stale'));
    env.memory.N!.at = env.s.time - 0.2 * HOUR;
    expect(m.unknownPlanetHtml(env.s.planets.N!)).toContain(t('side.scan.age.fresh'));
  });

  it('без памяти — «нет телеметрии», с пингом', async () => {
    const { env, m } = await boot();
    const html = m.unknownPlanetHtml(env.s.planets.Z!);
    expect(html).toContain(t('side.notelemetry.title'));
    expect(html).toContain(act('ping', ''));
    env.hidden = true;
    expect(m.unknownPlanetHtml(env.s.planets.Z!)).not.toContain('data-act="ping"');
  });

  it('провинция, куда залетал корабль, называет свой тип, но не хозяина', async () => {
    const { env, m } = await boot();
    const { SECTOR_TYPES } = await import('./map');
    expect(m.unknownPlanetHtml(env.s.planets.Z!)).not.toContain(
      tData(SECTOR_TYPES.graveyard!.name),
    );
    env.surveyed.Z = { kind: 'graveyard', at: 1 };
    const html = m.unknownPlanetHtml(env.s.planets.Z!);
    expect(html).toContain(t('side.notelemetry.title'));
    expect(html).toContain(tData(SECTOR_TYPES.graveyard!.name));
    expect(html).not.toContain('data-act="seat"');
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
      'buildUnits: () => PRODUCTION_UNITS,',
      'devUi: () => DEV_UI,',
      'sectorOf: (id) => SECTOR_OF[id],',
      'sectorType: sectorTypeOf,',
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
