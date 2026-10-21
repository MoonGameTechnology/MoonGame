/**
 * Карточка флота (REFM-224) — прямой тест владельца.
 *
 * Карточка рисует свой флот (корпус и щит, параметры, метки эффектов, плитки состава, трюм,
 * маршрут, удар по миру и сводку армии рядом), чужой флот (без приказов, неопознанный — одной
 * сигнатурой), консоль ПК, паспорта мин и ракеты, карточку группы, карточку эскадры в
 * воздухе и всплывашку надбавок, а мир, место, имена, открытую сводку, окно консоли, видимые
 * мины, часы, имя флота, эскадру вылета, флот листа и досье берёт у игры хуками. Здесь
 * проверено то, что текстом не проверить: какая карточка достаётся какому флоту, что видно
 * своему и чужому, когда горят ремонт, мины и метки, куда ведут плитки, какой приказ и какие
 * кнопки у эскадры в воздухе и когда всплывашка открыта. Каждый тест — свежая загрузка
 * модуля над своим миром. В конце — стык с `main.ts`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { setLocale, t } from '../../localization/runtime';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
  type ShuttleStrike,
  type UnitStack,
} from '../../packages/shared-core/src/index';
import { statSourceKey } from '../../decisions/statModifiers';
import type { Dossier } from './dossiers';
import type { SectorType } from './map';
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
  location: string | null,
  units: UnitStack[],
  extra: Partial<Fleet> = {},
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

/** Я — p1: мир A с верфью, столица C; N — мир соперника p2; Z — ничейный между ними. */
function world(): GameState {
  const st = createInitialState({ seed: 'fleetcard', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...st,
    time: 10 * HOUR,
    capital: { p1: 'C' },
    planets: {
      A: planet('A', 'p1', {
        buildings: [{ type: 'shipyard', level: 1, hp: 1000 }],
        garrison: [{ unit: 'militia', count: 3 }],
        links: ['Z'],
      }),
      C: planet('C', 'p1'),
      N: planet('N', 'p2', { garrison: [{ unit: 'militia', count: 4 }], links: ['Z'] }),
      Z: planet('Z', null, { links: ['A', 'N'] }),
    },
    players: { p1: player('p1'), p2: player('p2') },
    fleets: {
      F1: fleet('F1', 'p1', 'A', [{ unit: 'cruiser', count: 2 }]),
      F2: fleet('F2', 'p2', 'A', [{ unit: 'cruiser', count: 1 }]),
    },
  } as unknown as GameState;
}

/** Свежая загрузка карточки над миром и игрой, которая отвечает на её вопросы. */
async function boot(over: Record<string, unknown> = {}) {
  vi.resetModules();
  const env = {
    s: world(),
    names: { p1: 'Орион', p2: 'Багровые' } as Record<string, string>,
    info: null as string | null,
    console: null as string | null,
    ordnance: undefined as GameState['ordnance'],
    types: {} as Record<string, SectorType>,
    pc: false,
    unknown: [] as string[],
    march: [] as string[],
    troops: [] as string[],
    run: false,
    panel: null as string | null,
    relocate: false,
    ...over,
  };

  // Туман, выбор, приказы и забег тянут холст и окно браузера — подменены: карточка берёт у
  // них только эти ответы.
  vi.doMock('./graphicsPrefs', () => ({ pcUi: () => env.pc }));
  vi.doMock('./interaction', () => ({ squadMerge: null, troopsPlan: null }));
  vi.doMock('./mapAim', () => ({ squadronRelocateSpots: () => (env.relocate ? [{}] : []) }));
  vi.doMock('./mapFog', () => ({
    fleetKnown: (f: Fleet) => !env.unknown.includes(f.id),
    fleetNode: (f: Fleet) => f.location,
    memory: { get: () => undefined },
    myIntel: () => [],
  }));
  vi.doMock('./stewardScreen', () => ({ stewardTechDone: () => false }));
  vi.doMock('./chainComposer', () => ({ marchFlagged: (id: string) => env.march.includes(id) }));
  vi.doMock('./groupOrders', () => ({
    troopsInputFor: (id: string) => (env.troops.includes(id) ? {} : null),
  }));
  vi.doMock('./sectorRun', () => ({ isSectorZeroRun: () => env.run }));
  vi.doMock('./heroStaff', () => ({ heroDisplayName: (h: { id: string }) => `герой ${h.id}` }));
  // Палитра держит свою связь с игрой и стойки; карточке нужен только цвет стороны.
  vi.doMock('./mapPalette', () => ({
    ownerColor: (owner: string | null) => (owner ? `#side-${owner}` : '#neutral'),
    youColor: '#you',
  }));

  // Свежая загрузка берёт и свежий рантайм локали: без языка браузера он встал бы на EN.
  (await import('../../localization/runtime')).setLocale('ru');
  (await import('./worldQueries')).initWorldQueries({
    world: () => env.s,
    me: () => 'p1',
    note: () => {},
    placeName: (id) => id,
    playerOrder: () => true,
    buildingLocked: () => null as never,
  });
  const m = await import('./fleetCard');
  // Секцию ангара карточка берёт у карточки мира (REFM-223).
  (await import('./worldCard')).initWorldCard({
    world: () => env.s,
    me: () => 'p1',
    names: () => env.names,
    planetTab: () => 'buildings',
    buildUnits: () => [],
    devUi: () => false,
    sectorOf: () => undefined,
    sectorType: (id) => env.types[id],
    garrisonTiles: m.garrisonTilesHtml,
    sectorZeroToolsHidden: () => false,
  });
  m.initFleetCard({
    world: () => env.s,
    me: () => 'p1',
    names: () => env.names,
    fleetInfoFor: () => env.info,
    consoleFleet: () => (env.console ? (env.s.fleets[env.console] ?? null) : null),
    mineView: () => env.ordnance,
    mapNow: () => env.s.time,
    fleetTitleOf: (id) => `Флот «${id}»`,
    sectorType: (id) => env.types[id],
    strikeSquadron: (st) => ({
      id: st.squadronId,
      units: st.units,
      ...(st.cargo ? { cargo: st.cargo } : {}),
    }),
    strikeFrom: (st) =>
      st.base.kind === 'planet' ? { planetId: st.base.id } : { fleetId: st.base.id },
    panelFleet: () => env.panel,
    dossier: (key) => ({ name: `досье ${key}`, body: '' }) as Dossier,
  });
  /** Карточка флота по id. */
  const card = (id: string): string => m.fleetPanelHtml(env.s.fleets[id]!);
  /** Положить флот в мир. */
  const put = (f: Fleet): Fleet => (env.s.fleets[f.id] = f);
  return { m, env, card, put };
}

/** Кнопка действия панели по `data-act`. */
const act = (name: string): string => `data-act="${name}"`;
/** Подзаголовок шапки: всё, что стоит в `<span>` рядом с именем. */
const sub = (html: string): string =>
  /<div class="ptitle">.*?<span>([^<]*)<\/span>/s.exec(html)![1]!;

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

describe('какую карточку получает флот', () => {
  it('обычный флот — карточка с именем от игры и сводкой по тапу на имя', async () => {
    const { card } = await boot();
    const html = card('F1');
    expect(html).toContain('Флот «F1»');
    expect(html).toContain('data-act="fleetinfo"');
    expect(html).not.toContain('class="object-brief"');
  });

  it('открытая сводка встаёт рядом с карточкой, а не вместо неё', async () => {
    const { env, card } = await boot({ info: 'F1' });
    const html = card('F1');
    expect(html).toContain('<div class="object-brief">');
    expect(html).toContain('<div class="object-detail"><div class="sec detail-head">');
    expect(html).toContain(act('summaryback'));
    // Сводка другого флота открыта — у этого обычная карточка.
    env.info = 'F2';
    expect(card('F1')).not.toContain('class="object-detail"');
  });

  it('флот, который окно показывает консолью, рисуется консолью', async () => {
    const { env, card } = await boot({ console: 'F1', pc: true });
    expect(card('F1')).toContain('<div class="fconsole">');
    // Консоль только у того флота, на который указала игра.
    env.console = 'F2';
    expect(card('F1')).not.toContain('class="fconsole"');
  });

  it('мина — свой паспорт: заряды, доля за подрыв, без приказов', async () => {
    const { card, put } = await boot();
    put(fleet('M1', 'p2', 'A', [{ unit: 'mine', count: 3 }]));
    const html = card('M1');
    expect(html).toContain(t('mine.card.title'));
    expect(html).toContain(t('mine.card.rule'));
    expect(html).not.toContain('data-act="fleetinfo"');
  });

  it('ракетная мина без модуля не рисуется, хозяину — режим из доклада ядра и снятие', async () => {
    const { env, card, put } = await boot();
    put(fleet('R1', 'p1', 'A', [{ unit: 'rocket_mine', count: 1 }]));
    expect(card('R1')).toBe('');
    put(
      fleet('R1', 'p1', 'A', [{ unit: 'rocket_mine', count: 1, modules: ['rocket_mine_layer'] }]),
    );
    env.ordnance = {
      installations: [],
      controls: { R1: { owner: 'p1', mode: 'confirmed' } },
      warheads: {},
    } as unknown as GameState['ordnance'];
    const html = card('R1');
    expect(html).toContain(t('data.rocket-mine'));
    expect(html).toContain('data-act="rmmode" data-arg="confirmed" aria-pressed="true"');
    expect(html).toContain(act('rmdisarm'));
  });

  it('ракета в полёте — остаток полёта и взрыв, приказов нет', async () => {
    const { env, card, put } = await boot();
    const now = env.s.time;
    put(
      fleet('X1', 'p1', null, [{ unit: 'missile', count: 1, modules: ['rocket_mine_layer'] }], {
        flight: {
          from: { x: 0, y: 0 },
          to: { x: 40, y: 0 },
          departedAt: now,
          arrivesAt: now + HOUR,
        },
      } as Partial<Fleet>),
    );
    const html = card('X1');
    expect(html).toContain(t('missile.card.rule'));
    expect(html).toContain('1:00:00');
    expect(html).not.toContain('class="chip"');
  });
});

describe('свой флот', () => {
  it('подзаголовок: корабли и десант, на ПК — короткая форма', async () => {
    const { env, card, put } = await boot();
    put(
      fleet('F3', 'p1', 'A', [{ unit: 'cruiser', count: 2 }], {
        landing: [{ unit: 'militia', count: 5 }],
      }),
    );
    expect(sub(card('F3'))).toContain(t('side.fleet.sub', { s: 2, tr: 5 }));
    env.pc = true;
    // Узкая шапка ПК сжимает « · » до «·» (`panelKit.ts`).
    expect(sub(card('F3'))).toContain(t('side.fleet.sub.pc', { s: 2, tr: 5 }).replace(/ · /g, '·'));
  });

  it('хромой флот помечен в шапке, полоса корпуса краснеет', async () => {
    const { card, put } = await boot();
    put(fleet('F3', 'p1', 'Z', [{ unit: 'cruiser', count: 2, hp: 10 }]));
    const html = card('F3');
    expect(sub(html)).toContain('⚠');
    expect(html).toContain('<span class="hbar low">');
  });

  it('полоса щита — только у флота со щитом', async () => {
    const { card, put } = await boot();
    expect(card('F1')).not.toContain('data-desc="stat:shield"');
    put(fleet('F3', 'p1', 'A', [{ unit: 'swarm_leviathan', count: 1 }]));
    expect(card('F3')).toContain('data-desc="stat:shield"');
  });

  it('форс-марш: ход своего уже с надбавкой, чужого — с меткой ×1.5', async () => {
    const { env, card } = await boot();
    env.march = ['F1', 'F2'];
    expect(card('F1')).not.toContain('⚡×');
    expect(card('F2')).toContain('⚡×1.5');
  });

  it('плитки состава: корабль ведёт в карточку стека, десант — в справочник', async () => {
    const { card, put } = await boot();
    put(
      fleet(
        'F3',
        'p1',
        'Z',
        [
          { unit: 'scout', count: 1 },
          { unit: 'cruiser', count: 2 },
        ],
        {
          landing: [{ unit: 'militia', count: 3 }],
        },
      ),
    );
    const html = card('F3');
    expect(html).toContain('data-shipcard="F3|1"');
    expect(html).toContain('data-codex="u:militia"');
    expect(html).toContain(`<div class="sec">${t('side.fleet.troops')}</div>`);
  });

  it('ветеран — шевроны на плитке, модули — значками', async () => {
    const { card, put } = await boot();
    put(
      fleet('F3', 'p1', 'Z', [{ unit: 'frigate', count: 1, battles: 12, modules: ['mine_layer'] }]),
    );
    const html = card('F3');
    expect(html).toContain('class="ptile vet"');
    expect(html).toContain('<span class="pt-mods">');
  });

  it('ремонт: у своей верфи — за металл, повреждённый вне дока — за кредиты', async () => {
    const { card, put } = await boot();
    put(fleet('F3', 'p1', 'A', [{ unit: 'cruiser', count: 2, hp: 100 }]));
    put(fleet('F4', 'p1', 'Z', [{ unit: 'cruiser', count: 2, hp: 100 }]));
    expect(card('F3')).toContain(act('dockrepair'));
    expect(card('F4')).not.toContain(act('dockrepair'));
    expect(card('F4')).toContain(act('instantrepair'));
    // Целому флоту чинить нечего.
    expect(card('F1')).not.toContain(act('instantrepair'));
  });

  it('в забеге Sector Zero платный ремонт — за Суверены', async () => {
    const { card, put } = await boot({ run: true });
    put(fleet('F4', 'p1', 'Z', [{ unit: 'cruiser', count: 2, hp: 100 }]));
    const html = card('F4');
    expect(html).toContain(act('premiumrepair'));
    expect(html).not.toContain(act('instantrepair'));
  });

  it('заградитель ставит мины, пока поле не ставится; на перезарядке — отсчёт', async () => {
    const { env, card, put } = await boot();
    put(fleet('F3', 'p1', 'Z', [{ unit: 'frigate', count: 1, modules: ['mine_layer'] }]));
    expect(card('F3')).toContain(`${act('laymines')} data-arg="F3" title=`);
    env.s.minefields = { readyAt: { F3: env.s.time + HOUR } } as unknown as GameState['minefields'];
    const html = card('F3');
    expect(html).toContain(`${act('laymines')} data-arg="F3" disabled`);
    expect(html).toContain(t('side.fleet.mines.cooldown', { in: '1:00:00' }));
    // Без заградителя строки нет.
    expect(card('F1')).not.toContain(act('laymines'));
  });

  it('метки эффектов: бой, голод при десанте и долге; спокойный флот — без полосы', async () => {
    const { env, card, put } = await boot();
    expect(card('F1')).not.toContain('class="row effects"');
    put(
      fleet('F3', 'p1', 'A', [{ unit: 'cruiser', count: 1 }], { battleId: 'B1' } as Partial<Fleet>),
    );
    const battle = card('F3');
    expect(battle).toContain(t('effect.in-battle'));
    expect(battle).toContain(`${act('openbattle')} data-arg="B1"`);
    env.s.players.p1 = { ...env.s.players.p1!, arrears: ['food'] };
    put(
      fleet('F4', 'p1', 'Z', [{ unit: 'cruiser', count: 1 }], {
        landing: [{ unit: 'militia', count: 2 }],
      }),
    );
    expect(card('F4')).toContain(t('effect.hunger'));
    // Голодать некому — метки нет.
    expect(card('F1')).not.toContain(t('effect.hunger'));
  });

  it('герой на борту назван и его аура отмечена', async () => {
    const { env, card, put } = await boot();
    env.s.heroes = { H1: { id: 'H1', owner: 'p1' } } as unknown as GameState['heroes'];
    put(fleet('F3', 'p1', 'Z', [{ unit: 'hero', count: 1 }]));
    const html = card('F3');
    expect(html).toContain('♔ герой H1');
    expect(html).toContain(t('side.fleet.hero-aura'));
  });

  it('в пути — цель и срок прибытия заглушкой под живой патч', async () => {
    const { env, card, put } = await boot();
    const now = env.s.time;
    put(
      fleet('F3', 'p1', null, [{ unit: 'cruiser', count: 1 }], {
        movement: { from: 'A', to: 'Z', departedAt: now, arrivesAt: now + HOUR },
      } as Partial<Fleet>),
    );
    const html = card('F3');
    expect(html).toContain(`data-arrive="${now + HOUR}"`);
    expect(html).toContain('class="pn-eta"');
  });

  it('на тропе — отрезок и доля пути', async () => {
    const { card, put } = await boot();
    put(
      fleet('F3', 'p1', null, [{ unit: 'cruiser', count: 1 }], {
        edge: { from: 'A', to: 'Z', t: 0.25 },
      }),
    );
    expect(card('F3')).toContain('25');
  });

  it('у своего мира — сводка десанта без кнопок, удара нет', async () => {
    const { card, put } = await boot();
    put(
      fleet('F3', 'p1', 'A', [{ unit: 'cruiser', count: 1 }], {
        landing: [{ unit: 'militia', count: 2 }],
      }),
    );
    const html = card('F3');
    expect(html).toContain(t('side.ground.title'));
    expect(html).toContain('3 ▸ 2');
    expect(html).not.toContain(t('side.strike.title'));
  });

  it('у чужого мира — удар: бомбардировка, штурм и прогноз', async () => {
    const { card, put } = await boot({ types: { N: { capturable: true, orbit: true } } });
    put(
      fleet('F3', 'p1', 'N', [{ unit: 'cruiser', count: 3 }], {
        orbit: 'near',
        landing: [{ unit: 'militia', count: 6 }],
      } as Partial<Fleet>),
    );
    const html = card('F3');
    expect(html).toContain(t('side.strike.title'));
    expect(html).toContain(`${act('bombard')} data-arg="on"`);
    expect(html).toContain(act('assault'));
    expect(html).toContain(t('side.strike.forecast.hint'));
    expect(html).not.toContain(t('side.ground.title'));
  });

  it('носитель с трюмом показывает ангар', async () => {
    const { card, put } = await boot();
    put(
      fleet('F3', 'p1', 'Z', [{ unit: 'shuttle_carrier', count: 1 }], {
        hangar: [{ id: 'sq:1', units: [{ unit: 'interceptor', count: 2 }] }],
      } as Partial<Fleet>),
    );
    expect(card('F3')).toContain(`${act('wingstrike')} data-arg="sq:1"`);
  });
});

describe('чужой флот', () => {
  it('подпись чужого владельца экранирует недоверенное имя (CWE-79)', async () => {
    const { env, card } = await boot();
    const payload = '<img src=x onerror="alert(1)">';
    env.names.p2 = payload;
    const html = card('F2');
    expect(html).not.toContain(payload);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('опознанный — состав и подпись владельца, приказов и трюма нет', async () => {
    const { card } = await boot();
    const html = card('F2');
    expect(html).toContain('data-shipcard="F2|0"');
    expect(html).toContain(t('side.fleet.foreign.hint', { who: 'Багровые' }));
    expect(html).not.toContain(t('side.ground.title'));
  });

  it('неопознанный — одна сигнатура вместо состава', async () => {
    const { card } = await boot({ unknown: ['F2'] });
    const html = card('F2');
    expect(html).toContain(t('side.fleet.signature', { n: 1 }));
    expect(html).not.toContain('data-shipcard=');
  });

  it('сводка армии и у чужого — рядом с карточкой', async () => {
    const { card } = await boot({ info: 'F2' });
    const html = card('F2');
    expect(html).toContain('<div class="object-detail">');
    expect(html).toContain(t('side.fleet.foreign.hint', { who: 'Багровые' }));
  });
});

describe('консоль ПК', () => {
  it('корпус, щит «нет», состав с именами и низ окна', async () => {
    const { card } = await boot({ console: 'F1', pc: true });
    const html = card('F1');
    expect(html).toContain(t('fleet.console.shield.none'));
    expect(html).toContain('<section class="fc-comp">');
    expect(html).toContain('<span class="pt-n">');
    expect(html).toContain('<div class="fc-foot">');
  });

  it('колонка «Десант» — только когда есть что в ней показать', async () => {
    const { env, card, put } = await boot({ pc: true, types: { N: { capturable: true } } });
    env.console = 'F3';
    put(fleet('F3', 'p1', 'Z', [{ unit: 'cruiser', count: 1 }]));
    expect(card('F3')).not.toContain('<section class="fc-land">');
    put(
      fleet('F3', 'p1', 'N', [{ unit: 'cruiser', count: 1 }], {
        landing: [{ unit: 'militia', count: 2 }],
      }),
    );
    const html = card('F3');
    expect(html).toContain('<section class="fc-land">');
    expect(html).toContain(t('side.strike.title'));
  });

  it('кнопка погрузки — когда игра предлагает выбор войск', async () => {
    const { card, put } = await boot({ console: 'F3', pc: true, troops: ['F3'] });
    put(
      fleet('F3', 'p1', 'A', [{ unit: 'cruiser', count: 1 }], {
        landing: [{ unit: 'militia', count: 2 }],
      }),
    );
    expect(card('F3')).toContain('class="fc-load"');
  });
});

describe('карточка группы', () => {
  it('итог по бортам и десанту, строка на каждый флот с местом, кнопка сброса', async () => {
    const { env, m } = await boot();
    const now = env.s.time;
    const group = [
      env.s.fleets.F1!,
      fleet('F3', 'p1', null, [{ unit: 'cruiser', count: 1 }], {
        movement: { from: 'A', to: 'Z', departedAt: now, arrivesAt: now + HOUR },
        landing: [{ unit: 'militia', count: 4 }],
      } as Partial<Fleet>),
      fleet('F4', 'p1', null, [{ unit: 'scout', count: 1 }], {
        edge: { from: 'Z', to: 'N', t: 0.5 },
      }),
    ];
    const html = m.taskGroupPanelHtml(group);
    expect(html).toContain(t('side.group.sub', { f: 3, s: 4, tr: 4 }));
    expect(html).toContain('▲ F1 <span class="dim">A</span> · 2</div>');
    expect(html).toContain('▲ F3 <span class="dim">A→Z</span> · 1+4</div>');
    expect(html).toContain('▲ F4 <span class="dim">⟜ Z–N</span> · 1</div>');
    expect(html).toContain(act('cancel'));
  });
});

describe('плитки и надбавки', () => {
  it('гарнизон — плитки в справочник, пустой называется словами', async () => {
    const { m } = await boot();
    expect(m.garrisonTilesHtml('p1', [{ unit: 'militia', count: 2 }])).toContain(
      'data-codex="u:militia"',
    );
    expect(m.garrisonTilesHtml('p1', [])).toContain(t('side.none'));
  });

  it('пустой или неизвестный стек плитки не даёт', async () => {
    const { m } = await boot();
    expect(m.unitTileHtml({ unit: 'cruiser', count: 0 }, 'p1', '')).toBe('');
    expect(m.unitTileHtml({ unit: 'nope', count: 1 }, 'p1', '')).toBe('');
  });

  it('выслуга даёт силу, только когда её включил матч', async () => {
    const { m } = await boot();
    const game = await import('./game');
    game.setMatchVeteranPower(false);
    expect(m.veteranPowerOn()).toBe(false);
    game.setMatchVeteranPower(true);
    expect(m.veteranPowerOn()).toBe(true);
    game.setMatchVeteranPower(false);
  });

  it('надбавки — только своему флоту, ответ живёт, пока тот же мир', async () => {
    const { env, m } = await boot();
    expect(m.fleetStatModsOf(env.s.fleets.F2!)).toBeNull();
    const mods = m.fleetStatModsOf(env.s.fleets.F1!);
    expect(mods).not.toBeNull();
    expect(m.fleetStatModsOf(env.s.fleets.F1!)).toBe(mods);
  });

  it('огонь с надбавкой округлён, без надбавок — как есть', async () => {
    const { m } = await boot();
    expect(m.shownFire(10, null)).toBe(10);
    expect(m.shownFire(10, { fire: { factor: 1.26 } } as never)).toBe(13);
  });

  it('колонка «Десант» видна при ударе по миру, который можно взять', async () => {
    const { env, m, put } = await boot();
    expect(m.fleetLandShown(env.s.fleets.F1!)).toBe(false);
    put(fleet('F3', 'p1', 'N', [{ unit: 'cruiser', count: 1 }]));
    expect(m.fleetLandShown(env.s.fleets.F3!)).toBe(false);
    env.types.N = { capturable: true } as SectorType;
    expect(m.fleetLandShown(env.s.fleets.F3!)).toBe(true);
  });
});

/** Свой вылет: три перехватчика с мира A бьют флот F2, долетят через час. */
const strike = (id: string, extra: Partial<ShuttleStrike> = {}): ShuttleStrike =>
  ({
    id,
    owner: 'p1',
    base: { kind: 'planet', id: 'A' },
    squadronId: `sq:${id}`,
    units: [{ unit: 'interceptor', count: 3 }],
    target: { kind: 'fleet', id: 'F2' },
    to: { x: 10, y: 0 },
    departedAt: 10 * HOUR,
    arrivesAt: 11 * HOUR,
    leg: 'out',
    ...extra,
  }) as ShuttleStrike;

describe('эскадра в воздухе', () => {
  /** Кнопка приказа вылета: действие и адрес — id вылета. */
  const order = (name: string, id: string): string => `${act(name)} data-arg="${id}"`;

  it('удар по флоту: позывной в шапке, приказ, срок под живой патч и кнопки', async () => {
    const { m } = await boot();
    const sp = await import('./squadronPanel');
    const { timeLeft } = await import('./worldQueries');
    const st = strike('S1');
    expect(m.strikeTitle(st)).toBe(
      `${t(sp.SQUADRON_KIND_KEY)} «${sp.squadronCallsignOf('sq:S1')}»`,
    );
    const html = m.aloftPanelHtml(st);
    expect(html).toContain(m.strikeTitle(st));
    expect(html).toContain('background:#side-p1');
    expect(html).toContain('data-codex="u:interceptor"');
    expect(sub(html)).toBe(t('side.aloft.sub'));
    expect(html).toContain(`<b>${t('side.aloft.order.strike', { name: 'Флот «F2»' })}</b>`);
    expect(html).toContain(
      `${t('side.aloft.until.target')} <span class="pn-timer" data-at="${11 * HOUR}">${timeLeft(11 * HOUR)}</span>`,
    );
    for (const a of ['aloftstrike', 'aloftpatrol', 'aloftsplit', 'wingrecall'])
      expect(html).toContain(order(a, 'S1'));
    // Сесть некуда — перелёта нет; патруля нет — нечего и держать.
    expect(html).not.toContain(act('aloftrelocate'));
    expect(html).not.toContain(act('wingkeep'));
    expect(html).not.toContain(t('side.aloft.returning'));
  });

  it('чужой вылет карточки не даёт', async () => {
    const { m } = await boot();
    expect(m.aloftPanelHtml({ ...strike('S1'), owner: 'p2' })).toBe(
      `<div class="hint">${t('side.empty')}</div>`,
    );
  });

  it('высадка: груз в шапке, приказ «высадить» по имени мира, патруля с грузом нет', async () => {
    const { m, env } = await boot();
    const { worldName } = await import('./planetName');
    const html = m.aloftPanelHtml(
      strike('S2', {
        units: [{ unit: 'landing_shuttle', count: 2 }],
        cargo: [{ unit: 'militia', count: 4 }],
        target: { kind: 'planet', id: 'N' },
      }),
    );
    expect(sub(html)).toBe(`${t('side.aloft.sub')} · ${t('side.wing.cargo', { n: 4 })}`);
    expect(html).toContain(t('side.aloft.order.land', { name: worldName(env.s, 'N') }));
    expect(html).not.toContain(act('aloftpatrol'));
  });

  it('удар по миру — приказ «удар» по имени мира', async () => {
    const { m, env } = await boot();
    const { worldName } = await import('./planetName');
    const html = m.aloftPanelHtml(
      strike('S3', { units: [{ unit: 'bomber', count: 2 }], target: { kind: 'planet', id: 'N' } }),
    );
    expect(html).toContain(t('side.aloft.order.strike', { name: worldName(env.s, 'N') }));
  });

  it('потрёпанная эскадра — корпус в шапке', async () => {
    const { m } = await boot();
    const { aloftCard } = await import('../../decisions/aloftCard');
    const { data } = await import('./game');
    const st = strike('S4', { damage: 10 });
    const hull = aloftCard(st, { me: 'p1', data, relocate: false, split: true })!.hull;
    expect(hull).not.toBeNull();
    expect(sub(m.aloftPanelHtml(st))).toBe(
      `${t('side.aloft.sub')} · ${t('side.wing.hull', { p: hull! })}`,
    );
  });

  it('патруль: путь к точке, висение, «держать» и его снятие', async () => {
    const { m } = await boot();
    const patrol = { hours: 3, radius: 40 };
    const out = m.aloftPanelHtml(strike('P1', { target: { kind: 'point' }, patrol }));
    expect(out).toContain(`<b>${t('side.aloft.order.patrol-out')}</b>`);
    expect(out).toContain(t('side.aloft.until.point'));
    expect(out).toContain(`${order('wingkeep', 'P1')} >${t('side.wing.keep')}</button>`);
    const held = m.aloftPanelHtml(
      strike('P2', { target: { kind: 'point' }, leg: 'patrol', patrol: { ...patrol, hold: true } }),
    );
    expect(held).toContain(`<b>${t('side.aloft.order.patrol')}</b>`);
    expect(held).toContain(t('side.aloft.until.patrol'));
    expect(held).toContain(`${order('wingkeep', 'P2')} >${t('side.wing.keep.off')}</button>`);
  });

  it('повернувшая домой: строка о возврате, бить и отзывать нечего', async () => {
    const { m, env } = await boot();
    const { worldName } = await import('./planetName');
    const html = m.aloftPanelHtml(strike('H1', { leg: 'back' }));
    expect(html).toContain(t('side.aloft.order.home', { name: worldName(env.s, 'A') }));
    expect(html).toContain(t('side.aloft.until.land'));
    expect(html).toContain(`<div class="row dim">${t('side.aloft.returning')}</div>`);
    for (const a of ['aloftstrike', 'aloftpatrol', 'wingrecall'])
      expect(html).not.toContain(act(a));
  });

  it('перелёт на корабль — по имени флота; кнопка — когда игре есть куда сесть', async () => {
    const { m, env } = await boot();
    const st = strike('H2', {
      leg: 'back',
      target: { kind: 'base' },
      base: { kind: 'fleet', id: 'F1' },
    });
    expect(m.aloftPanelHtml(st)).toContain(t('side.aloft.order.relocate', { name: 'Флот «F1»' }));
    expect(m.aloftPanelHtml(st)).not.toContain(act('aloftrelocate'));
    env.relocate = true;
    expect(m.aloftPanelHtml(st)).toContain(order('aloftrelocate', 'H2'));
  });

  it('одну машину делить нечего; без кнопок ряда нет', async () => {
    const { m } = await boot();
    expect(
      m.aloftPanelHtml(strike('S5', { units: [{ unit: 'interceptor', count: 1 }] })),
    ).not.toContain(act('aloftsplit'));
    const lone = m.aloftPanelHtml(
      strike('H3', { leg: 'back', units: [{ unit: 'interceptor', count: 1 }] }),
    );
    expect(lone).not.toMatch(/data-act="(?:aloft|wing)/);
    expect(lone.endsWith(`<div class="row dim">${t('side.aloft.returning')}</div>`)).toBe(true);
  });
});

/** Узлы всплывашки и листа без браузера: параметры `stats` стоят в разметке листа, параметр
 *  на высоте `top` экрана высотой `vh`. У всплывашки рамка в 2 px: 80 содержимого, 82 целиком. */
function fakeDom(stats: string[], { top = 715, vh = 800 } = {}) {
  const classes = new Set<string>();
  const pop = {
    innerHTML: '',
    style: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    replaceChildren() {
      this.innerHTML = '';
    },
    offsetHeight: 82,
    clientHeight: 80,
    offsetWidth: 200,
    scrollHeight: 80,
  };
  const anchor = { getBoundingClientRect: () => ({ left: 100, top, width: 60, height: 20 }) };
  const side = {
    style: { display: 'flex' },
    querySelector: (sel: string) =>
      stats.some((k) => sel === `[data-stat="${k}"]`) ? anchor : null,
  };
  const listeners: { type: string; fn: (ev: unknown) => void; capture: unknown }[] = [];
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === 'statpop' ? pop : id === 'side' ? side : null),
    addEventListener: (type: string, fn: (ev: unknown) => void, capture: unknown) =>
      listeners.push({ type, fn, capture }),
  });
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', vh);
  /** Нажатие на узел, который подходит под селектор `hit`; `null` — мимо всего. */
  const press = (hit: string | null) =>
    listeners[0]!.fn({
      target: {
        closest: (sel: string) =>
          hit !== null && sel.split(',').some((x) => x.trim() === hit) ? {} : null,
      },
    });
  return { pop, side, listeners, shown: () => classes.has('show'), press };
}

describe('всплывашка надбавок', () => {
  it('атака своего флота — число как в окне, база и строки надбавок от ядра', async () => {
    const { m, env } = await boot();
    const { fleetSummary } = await import('./fleetSummary');
    const { termBody } = await import('./termTip');
    const { data } = await import('./game');
    const f = env.s.fleets.F1!;
    const mods = m.fleetStatModsOf(f)!;
    const raw = fleetSummary(f, data, env.s.time).attack.capped;
    const v = m.statPopModel(f, 'atk');
    expect(v.title).toBe('досье stat:atk');
    expect(v.desc).toBe(termBody('attack'));
    expect(v.value).toBe(String(m.shownFire(raw, mods)));
    expect(v.base).toBe(String(raw));
    expect(v.tone).toBe(mods.fire.tone);
    expect(v.plain).toBeUndefined();
    // Источник надбавки ядро называет само (здесь — сектор), подпись — по его ключу.
    expect(mods.fire.sources.length).toBeGreaterThan(0);
    expect(v.rows).toEqual(
      mods.fire.sources.map((x) => ({ label: t(statSourceKey(x.source)), pct: x.pct })),
    );
    expect(v.total).toBe((mods.fire.factor - 1) * 100);
    const def = m.statPopModel(f, 'def');
    expect(def.desc).toBe(termBody('defense'));
    expect(def.base).toBe(String(fleetSummary(f, data, env.s.time).defense));
  });

  it('чужой флот — одно правило параметра, без строк ядра', async () => {
    const { m, env } = await boot();
    const { fleetSummary } = await import('./fleetSummary');
    const { data } = await import('./game');
    const f = env.s.fleets.F2!;
    expect(m.statPopModel(f, 'atk')).toMatchObject({
      value: String(fleetSummary(f, data, env.s.time).attack.capped),
      tone: 'neutral',
      rows: [],
      total: null,
      plain: true,
    });
  });

  it('ход — с базой и надбавками от ядра', async () => {
    const { m, env } = await boot();
    const f = env.s.fleets.F1!;
    const mods = m.fleetStatModsOf(f)!;
    expect(m.statPopModel(f, 'spd')).toMatchObject({
      value: String(Math.round(mods.speed.value)),
      base: String(Math.round(mods.speed.base)),
      rows: expect.any(Array),
      total: (mods.speed.factor - 1) * 100,
    });
  });

  it('корпус — «сейчас/всего» и входящий урон; щита нет — словами', async () => {
    const { m, env } = await boot();
    const { fleetSummary } = await import('./fleetSummary');
    const { kfmt } = await import('./format');
    const { data } = await import('./game');
    const f = env.s.fleets.F1!;
    const hull = fleetSummary(f, data, env.s.time).hull;
    expect(m.statPopModel(f, 'hull')).toMatchObject({
      value: `${kfmt(hull.cur)}/${kfmt(hull.max)}`,
      sub: t('stat.pop.incoming'),
      lessIsBetter: true,
    });
    expect(m.statPopModel(f, 'shield')).toMatchObject({
      value: t('fleet.console.shield.none'),
      plain: true,
    });
  });

  it('линия огня — сколько бортов стреляет из предела', async () => {
    const { m, env } = await boot();
    const { COMBAT_UNIT_CAP } = await import('../../packages/shared-core/src/index');
    expect(m.statPopModel(env.s.fleets.F1!, 'cap')).toMatchObject({
      value: `2/${COMBAT_UNIT_CAP}`,
      plain: true,
    });
  });

  it('тап по параметру открывает всплывашку у него, повторный — закрывает', async () => {
    const { m, env } = await boot({ panel: 'F1' });
    const { statPopHtml } = await import('./fleetConsole');
    const { anchoredPopover } = await import('../../decisions/anchoredPopover');
    const dom = fakeDom(['atk', 'def']);
    m.initStatPop();
    m.toggleStatPop('atk');
    expect(m.statPopOpen()).toBe(true);
    expect(dom.shown()).toBe(true);
    expect(dom.pop.innerHTML).toBe(statPopHtml(m.statPopModel(env.s.fleets.F1!, 'atk')));
    // Высота — по содержимому плюс рамка, а не по наложенному пределу: у низа экрана
    // всплывашка встаёт над параметром ровно на свою высоту.
    const at = anchoredPopover(
      { left: 100, top: 715, width: 60, height: 20 },
      { width: 200, height: 82 },
      { width: 1280, height: 800 },
    );
    expect(at.side).toBe('above');
    expect(dom.pop.style.left).toBe(`${Math.round(at.left)}px`);
    expect(dom.pop.style.top).toBe(`${Math.round(at.top)}px`);
    expect(dom.pop.style.maxHeight).toBe(
      at.maxHeight === null ? '' : `${Math.floor(at.maxHeight)}px`,
    );
    expect(dom.pop.dataset.side).toBe(at.side);
    // Другой параметр — та же всплывашка с его содержимым.
    m.toggleStatPop('def');
    expect(dom.pop.innerHTML).toBe(statPopHtml(m.statPopModel(env.s.fleets.F1!, 'def')));
    m.toggleStatPop('def');
    expect(m.statPopOpen()).toBe(false);
    expect(dom.shown()).toBe(false);
    expect(dom.pop.innerHTML).toBe('');
  });

  it('места нет ни сверху, ни снизу — высота зажата пределом', async () => {
    const { m } = await boot({ panel: 'F1' });
    const { anchoredPopover } = await import('../../decisions/anchoredPopover');
    const dom = fakeDom(['atk'], { top: 40, vh: 100 });
    m.initStatPop();
    m.toggleStatPop('atk');
    const at = anchoredPopover(
      { left: 100, top: 40, width: 60, height: 20 },
      { width: 200, height: 82 },
      { width: 1280, height: 100 },
    );
    expect(at.maxHeight).not.toBeNull();
    expect(dom.pop.style.maxHeight).toBe(`${Math.floor(at.maxHeight!)}px`);
  });

  it('без флота в листе тап ничего не открывает', async () => {
    const { m } = await boot();
    const dom = fakeDom(['atk']);
    m.initStatPop();
    m.toggleStatPop('atk');
    expect(m.statPopOpen()).toBe(false);
    expect(dom.shown()).toBe(false);
  });

  it('ушёл флот из листа, параметр из разметки или спрятан лист — закрывается сама', async () => {
    const { m, env } = await boot({ panel: 'F1' });
    const dom = fakeDom(['atk']);
    m.initStatPop();
    m.toggleStatPop('spd');
    expect(m.statPopOpen()).toBe(false);
    m.toggleStatPop('atk');
    env.panel = 'F2';
    m.renderStatPop();
    expect(m.statPopOpen()).toBe(false);
    expect(dom.shown()).toBe(false);
    env.panel = 'F1';
    m.toggleStatPop('atk');
    dom.side.style.display = 'none';
    m.renderStatPop();
    expect(m.statPopOpen()).toBe(false);
  });

  it('клик мимо закрывает, нажатие на параметр или подсказку термина — нет', async () => {
    const { m } = await boot({ panel: 'F1' });
    const dom = fakeDom(['atk']);
    m.initStatPop();
    expect(dom.listeners).toHaveLength(1);
    expect(dom.listeners[0]).toMatchObject({ type: 'pointerdown', capture: true });
    m.toggleStatPop('atk');
    for (const hit of ['#statpop', '[data-stat]', '.termtip']) {
      dom.press(hit);
      expect(m.statPopOpen()).toBe(true);
    }
    dom.press(null);
    expect(m.statPopOpen()).toBe(false);
    expect(dom.shown()).toBe(false);
    // Открытая заново — с содержимым: память прошлой разметки ушла вместе с ней.
    m.toggleStatPop('atk');
    expect(dom.pop.innerHTML).not.toBe('');
    m.closeStatPop();
    expect(m.statPopOpen()).toBe(false);
  });
});

describe('стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('main поднимает карточку один раз и отдаёт ей своё состояние', () => {
    expect(MAIN.match(/\ninitFleetCard\(\{/g)).toHaveLength(1);
    for (const hook of [
      'world: () => s,',
      'fleetInfoFor: () => fleetInfoFor,',
      '  consoleFleet,\n',
      '  mineView,\n',
      '  mapNow,\n',
      '  fleetTitleOf,\n',
      'sectorType: sectorTypeOf,',
      '  strikeSquadron,\n',
      '  strikeFrom,\n',
      '  panelFleet,\n',
      'dossier: (key) => objDossier(key),',
    ]) {
      expect(MAIN).toContain(hook);
    }
  });

  it('панель зовёт карточки модуля', () => {
    expect(MAIN).toContain("if (pick.kind === 'group') return taskGroupPanelHtml(pick.fleets);");
    expect(MAIN).toContain("if (pick.kind === 'fleet') return fleetPanelHtml(pick.fleet);");
    expect(MAIN).toContain('garrisonTiles: garrisonTilesHtml,');
    expect(MAIN).toContain('if (aloft) return aloftPanelHtml(aloft);');
  });

  it('всплывашку main поднимает до подсказок терминов, держит листом и закрывает «Назад»', () => {
    expect(MAIN.match(/\ninitStatPop\(\);/g)).toHaveLength(1);
    expect(MAIN.indexOf('\ninitStatPop();')).toBeLessThan(MAIN.indexOf('\ninitTermTips();'));
    // `renderPanel` зовёт её на обеих ветках: открытый лист и спрятанный.
    expect(MAIN.match(/\n {4}renderStatPop\(\);\n {4}return;/g)).toHaveLength(1);
    expect(MAIN.match(/\n {2}renderStatPop\(\);\n\}/g)).toHaveLength(1);
    expect(MAIN).toContain("{ id: 'statpop', isOpen: statPopOpen, close: closeStatPop }");
  });

  it('копий карточки в main не осталось', () => {
    for (const gone of [
      'function fleetPanelHtml',
      'function fleetConsoleHtml',
      'function fleetSummaryHtml',
      'function taskGroupPanelHtml',
      'function unitTileHtml',
      'function fleetTilesHtml',
      'function garrisonTilesHtml',
      'function mineCardHtml',
      'function rocketMineCardHtml',
      'function missileCardHtml',
      'function objectPanelHtml',
      'function effectTagText',
      'function fleetStatModsOf',
      'function shownFire',
      'function groundRowsAt',
      'let statModsMemo',
      'function strikeTitle',
      'function strikeBaseName',
      'function aloftOrderText',
      'function aloftPanelHtml',
      'function toggleStatPop',
      'function closeStatPop',
      'function statPopModel',
      'function renderStatPop',
      'let statPop',
      "$('statpop')",
    ]) {
      expect(MAIN).not.toContain(gone);
    }
  });
});
