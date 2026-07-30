/**
 * СТОРОЖ ТУМАНА — инвентаризация полей `GameState` / `Player`.
 *
 * Фог-проекция (`project` в `visibility.ts`) — ЧЁРНЫЙ СПИСОК: она клонирует состояние
 * и удаляет из копии то, что перечислено поимённо. Значит новое поле `GameState`
 * ПУБЛИЧНО ПО УМОЛЧАНИЮ: добавил модуль поле — и оно уехало каждому клиенту, молча и
 * без единого красного теста. Так утекли дивизии, `player.scientists` и `state.capital`.
 *
 * Этот файл — не ещё один тест поведения (оно проверяется по полям в
 * `visibility.test.ts`), а ГЕЙТ НА РЕШЕНИЕ. Карты ниже типизированы как
 * `Record<keyof GameState, …>` / `Record<keyof Player, …>`, поэтому новое поле роняет
 * ТИПИЗАЦИЮ, пока автор не впишет его сюда и не выберет:
 *
 *   public   — уходит клиенту как есть (публичный факт: карта, дипломатия, стакан);
 *   stripped — не уходит вообще (внутреннее серверное состояние);
 *   filtered — уходит обрезанным до того, что зритель вправе видеть.
 *
 * И три проверки, которые не дают отделаться припиской в карте:
 *   • `stripped` — ключа в проекции нет;
 *   • `public`   — значение дошло бит в бит;
 *   • `filtered` — значение ОТЛИЧАЕТСЯ от исходного (полю, помеченному «фильтруется»,
 *     но забытому в `project()`, здесь конец).
 *
 * Плюс ловушка на канарейку: всё, что принадлежит сопернику, засеяно строками
 * `CANARY_*`, и готовая проекция целиком сканируется на них. Эта проверка ловит утечку
 * даже там, где структурная карта её пропустила бы, — потому что смотрит не на имена
 * полей, а на сам факт «секрет соперника доехал до зрителя».
 */
import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../data/schemas';
import { offerKey, pairKey } from './diplomacy';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from './gameState';
import { visibleState } from './visibility';

/** Как поле `GameState` ведёт себя на границе тумана. */
type Exposure = 'public' | 'stripped' | 'filtered';

/**
 * ПОЛНАЯ опись `GameState`. Новое поле → красная типизация здесь → автор обязан
 * решить, что с ним делает проекция. Это и есть весь смысл файла.
 */
const GAME_STATE_EXPOSURE: Record<keyof GameState, Exposure> = {
  version: 'public', // правила матча — общий факт
  time: 'public',
  startedAt: 'public',
  match: 'filtered', // статус/победитель публичны, чужие строки счёта — нет
  rng: 'stripped', // кости мира: держащий поток предсказывает будущие броски
  players: 'filtered', // см. PLAYER_EXPOSURE ниже
  planets: 'filtered', // топология публична, содержимое неопознанного мира — нет
  fleets: 'filtered', // чужой флот виден только опознанным (иначе — засветка)
  battles: 'filtered',
  battleSeq: 'public', // счётчик, не факт о мире
  scheduled: 'filtered', // чужие таймеры — это будущие намерения
  scheduleSeq: 'public',
  fog: 'stripped', // память тумана — серверная кухня
  heroes: 'filtered', // только свои
  tempLanes: 'public', // настоящие рёбра графа: их видно всем
  topology: 'public',
  heroSeq: 'public',
  diplomacy: 'public', // кто с кем воюет — открытое знание
  diplomacyOffers: 'filtered', // а кто с кем ТОРГУЕТСЯ — дело двоих
  intel: 'filtered', // кто за кем шпионит — секрет самого шпиона
  market: 'public', // сессионный стакан публичен по замыслу
  marketSeq: 'public',
  capital: 'filtered', // чужая столица — точка респавна героя, наводка
  autoAssault: 'filtered', // всё это — постоянные приказы, будущие намерения
  patrols: 'filtered',
  wingSorties: 'filtered',
  orders: 'filtered',
  divisions: 'filtered',
  divisionSeq: 'public',
  groundBattles: 'filtered', // сам факт «здесь идёт бой» — уже разведданные
  forcedMarch: 'filtered',
};

/** Как поле `Player` ведёт себя в ЧУЖОЙ карточке (своя доезжает целиком). */
const PLAYER_EXPOSURE: Record<keyof Player, 'public' | 'owner-private'> = {
  id: 'public',
  name: 'public',
  faction: 'public',
  status: 'public', // выбыл или играет — видно всем
  ai: 'public',
  resources: 'owner-private', // казна (кроме украденного окна `intel`)
  arrears: 'owner-private', // долги читаются как состояние казны
  technologies: 'owner-private',
  scientists: 'owner-private',
  scientist: 'owner-private',
  steward: 'owner-private', // «спит — можно бить»
  stewardLog: 'owner-private',
  stewardHoldPoints: 'owner-private', // якоря обороны — наводка
  arsenal: 'owner-private', // что соперник МОЖЕТ построить
  divisionTemplates: 'owner-private', // что соперник МОЖЕТ мобилизовать
};

/** Ключи, которых нет в `GameState`, — их ДОБАВЛЯЕТ сама проекция. */
const PROJECTION_EXTRAS = ['signatures', 'remembered'];

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal', 'credits'],
  units: {
    // Ни у кого нет radarRange: зритель опознаёт только свой узел, соперник — тьма.
    scout: { faction: 'x', stats: { attack: 2, defense: 2, speed: 9, hp: 8 } },
    CANARY_unit: { faction: 'x', stats: { attack: 1, defense: 1, speed: 1, hp: 1 } },
  },
  factions: { x: { name: 'X', passives: {} } },
  buildings: { CANARY_building: { name: 'Canary' } },
  technologies: { own_tech: { name: 'Own tech', effects: {} } },
  events: {},
});

const VIEWER = 'p1';
const RIVAL = 'p2';

function planet(id: string, owner: string | null, extra: Partial<Planet> = {}): Planet {
  return {
    id,
    owner,
    position: { x: id === 'A' ? 0 : 9000, y: 0 },
    links: [], // граф без рёбер: опознание на 1 прыжок не выходит за свой мир
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
    ...extra,
  };
}
function fleet(id: string, owner: string, location: string, unit: string): Fleet {
  return { id, owner, location, movement: null, units: [{ unit, count: 2 }], traits: [] };
}

/**
 * Состояние, в котором ЗАПОЛНЕНО КАЖДОЕ поле `GameState` и `Player` — иначе опись
 * проверяла бы пустоту. Всё, что принадлежит сопернику, помечено `CANARY_`.
 *
 * Карта: зритель `p1` держит мир `A`, соперник `p2` — мир `Z`. Рёбер нет, радаров нет,
 * поэтому опознание зрителя = `{A}`, а весь `Z` лежит за туманом.
 */
function maximalState(): GameState {
  const base = createInitialState({
    seed: 'fog-inventory',
    version: { data: '0.1.0', manifest: '1', dataHash: 'abc123' },
    time: 100,
  });
  return {
    ...base,
    startedAt: 0,
    match: {
      status: 'ongoing',
      winner: null,
      scores: {
        [VIEWER]: { controlledPlanets: 1, fleets: 1, units: 2, total: 10 },
        [RIVAL]: { controlledPlanets: 1, fleets: 1, units: 2, total: 20 },
      },
    },
    players: {
      // Зритель: те же поля, но обычными значениями — они ОБЯЗАНЫ доехать.
      [VIEWER]: {
        id: VIEWER,
        name: 'Viewer',
        faction: 'x',
        status: 'active',
        ai: false,
        resources: { metal: 10, credits: 20 },
        arrears: ['metal'],
        technologies: { completed: ['own_tech'], active: [] },
        scientists: [{ id: 'own_council', level: 1 }],
        scientist: { id: 'own_leader', level: 1 },
        steward: { posture: 'defend', until: 500 },
        stewardLog: [{ at: 50, kind: 'hold', node: 'A' }],
        stewardHoldPoints: ['A'],
        arsenal: { hulls: ['scout'], modules: [], fittings: [] },
        divisionTemplates: [{ name: 'own_template', slots: [null, null, null, null, null, null] }],
      },
      // Соперник: те же поля, засеянные канарейками.
      [RIVAL]: {
        id: RIVAL,
        name: 'Rival',
        faction: 'x',
        status: 'active',
        ai: true,
        resources: { metal: 777, credits: 888 },
        arrears: ['CANARY_arrear'],
        technologies: { completed: ['CANARY_completed'], active: [] },
        scientists: [{ id: 'CANARY_council', level: 3 }],
        scientist: { id: 'CANARY_leader', level: 3 },
        steward: { posture: 'CANARY_posture', until: 900 },
        stewardLog: [{ at: 60, kind: 'evac', node: 'CANARY_node' }],
        stewardHoldPoints: ['CANARY_hold'],
        arsenal: { hulls: ['CANARY_hull'], modules: [], fittings: [] },
        divisionTemplates: [
          { name: 'CANARY_template', slots: [null, null, null, null, null, null] },
        ],
      },
    },
    planets: {
      A: planet('A', VIEWER, { garrison: [{ unit: 'scout', count: 1 }] }),
      // Живое содержимое мира за туманом — целиком канареечное.
      Z: planet('Z', RIVAL, {
        garrison: [{ unit: 'CANARY_unit', count: 3 }],
        buildings: [{ type: 'CANARY_building', level: 1, hp: 5 }],
        resources: { CANARY_resource: 5 },
        terrain: 'CANARY_terrain',
        planetType: 'CANARY_ptype',
        kind: 'CANARY_kind',
      }),
    },
    fleets: {
      mine: fleet('mine', VIEWER, 'A', 'scout'),
      CANARY_fleet: fleet('CANARY_fleet', RIVAL, 'Z', 'CANARY_unit'),
    },
    battles: {
      mine_battle: {
        id: 'mine_battle',
        location: 'A',
        phase: 'orbital',
        attacker: { ref: { kind: 'fleet', fleetId: 'mine' }, owner: VIEWER },
        defender: { ref: { kind: 'garrison', planetId: 'A' }, owner: VIEWER },
        round: 1,
      },
      CANARY_battle: {
        id: 'CANARY_battle',
        location: 'Z',
        phase: 'ground',
        attacker: { ref: { kind: 'landing', fleetId: 'CANARY_fleet' }, owner: RIVAL },
        defender: { ref: { kind: 'garrison', planetId: 'Z' }, owner: RIVAL },
        round: 7,
      },
    },
    battleSeq: 2,
    scheduled: [
      { id: 'evt:1', at: 200, type: 'own.timer', payload: { owner: VIEWER }, seq: 0 },
      { id: 'evt:2', at: 300, type: 'CANARY_type', payload: { owner: RIVAL }, seq: 1 },
    ],
    scheduleSeq: 2,
    // Память зрителя о `Z` — ОБЫЧНАЯ, не канареечная: проекция обязана показать именно
    // её (устаревший снимок), а не живую правду мира за туманом.
    fog: {
      [VIEWER]: {
        Z: { owner: RIVAL, garrison: [{ unit: 'scout', count: 1 }], buildings: [], at: 50 },
      },
    },
    heroes: {
      mine_hero: { id: 'mine_hero', owner: VIEWER, location: 'A', cooldowns: {}, alive: true },
      CANARY_hero: {
        id: 'CANARY_hero',
        owner: RIVAL,
        name: 'CANARY_heroname',
        location: 'Z',
        cooldowns: {},
        alive: true,
      },
    },
    tempLanes: [
      // Настоящее ребро графа — публичная топология, канареек тут быть не должно.
      { id: 'lane1', owner: RIVAL, from: 'A', to: 'Z', speedBonus: 0.5, expiresAt: 900, addedLink: false },
    ],
    topology: 3,
    heroSeq: 1,
    diplomacy: { [pairKey(VIEWER, RIVAL)]: 'war' },
    diplomacyOffers: {
      [offerKey(VIEWER, RIVAL)]: 'peace', // зритель — сторона сделки, увидит
      [offerKey(RIVAL, 'CANARY_third')]: 'pact', // чужие переговоры
    },
    intel: {
      // Своё окно — безобидное (свой же мир), чтобы оно не пробило туман само.
      [VIEWER]: [{ kind: 'planet', target: 'A', until: 900 }],
      [RIVAL]: [{ kind: 'planet', target: 'CANARY_target', until: 900 }],
    },
    market: [{ id: 'm1', seller: RIVAL, resource: 'metal', amount: 5, price: 3 }],
    marketSeq: 1,
    capital: { [VIEWER]: 'A', [RIVAL]: 'Z' },
    autoAssault: { mine: true, CANARY_fleet: true },
    patrols: {
      mine: { center: { x: 0, y: 0 }, radius: 10, sortie: { fuel: 2, rearming: 0 } },
      CANARY_fleet: { center: { x: 9000, y: 0 }, radius: 10, sortie: { fuel: 4, rearming: 1 } },
    },
    wingSorties: { mine: { fuel: 1, rearming: 0 }, CANARY_fleet: { fuel: 3, rearming: 2 } },
    orders: {
      mine: { steps: [{ kind: 'move', to: 'A' }] },
      CANARY_fleet: { steps: [{ kind: 'move', to: 'CANARY_dest' }] },
    },
    divisions: {
      mine_div: {
        id: 'mine_div',
        owner: VIEWER,
        name: 'own_division',
        template: 0,
        max: { militia: 2 },
        units: [{ type: 'militia', count: 2, hp: 20, hpEach: 10 }],
        location: 'A',
      },
      CANARY_division: {
        id: 'CANARY_division',
        owner: RIVAL,
        name: 'CANARY_divname',
        template: 1,
        max: { tank: 2 },
        units: [{ type: 'tank', count: 2, hp: 40, hpEach: 20 }],
        location: 'Z',
      },
    },
    divisionSeq: 2,
    groundBattles: { A: 10, Z: 20 },
    forcedMarch: { mine: true, CANARY_fleet: true },
  };
}

const stateKeys = Object.keys(GAME_STATE_EXPOSURE) as (keyof GameState)[];
const playerKeys = Object.keys(PLAYER_EXPOSURE) as (keyof Player)[];

/** Значение, из которого зритель ничего не узнаёт: нет вовсе, либо вычищено досуха
 *  (проекция обнуляет чужую казну до `{}`, а не удаляет ключ). */
function carriesNoData(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (value !== null && typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

describe('сторож тумана — опись полей GameState', () => {
  const source = maximalState();
  const view = visibleState(source, VIEWER, data);

  it('фикстура действительно заполняет КАЖДОЕ поле — иначе опись проверяет пустоту', () => {
    const empty = stateKeys.filter((k) => source[k] === undefined);
    expect(empty).toEqual([]);
  });

  it('в проекции нет ни одного неописанного ключа', () => {
    const unknown = Object.keys(view).filter(
      (k) => !(k in GAME_STATE_EXPOSURE) && !PROJECTION_EXTRAS.includes(k),
    );
    expect(unknown).toEqual([]);
  });

  it('«stripped» — поля нет в проекции вообще', () => {
    const leaked = stateKeys.filter(
      (k) => GAME_STATE_EXPOSURE[k] === 'stripped' && view[k] !== undefined,
    );
    expect(leaked).toEqual([]);
  });

  it('«public» — значение доехало бит в бит', () => {
    for (const key of stateKeys) {
      if (GAME_STATE_EXPOSURE[key] !== 'public') continue;
      expect(view[key], `публичное поле ${key} изменилось в проекции`).toEqual(source[key]);
    }
  });

  it('«filtered» — значение ОТЛИЧАЕТСЯ от исходного (поле реально обрезано)', () => {
    const untouched = stateKeys.filter(
      (k) => GAME_STATE_EXPOSURE[k] === 'filtered' && deepSame(view[k], source[k]),
    );
    expect(untouched).toEqual([]);
  });
});

describe('сторож тумана — опись полей Player', () => {
  const source = maximalState();
  const view = visibleState(source, VIEWER, data);
  const mine = view.players[VIEWER]!;
  const theirs = view.players[RIVAL]!;

  it('фикстура заполняет КАЖДОЕ поле у обоих игроков', () => {
    for (const seat of [source.players[VIEWER]!, source.players[RIVAL]!]) {
      expect(playerKeys.filter((k) => seat[k] === undefined)).toEqual([]);
    }
  });

  it('в карточках игроков нет ни одного неописанного ключа', () => {
    for (const seat of Object.values(view.players)) {
      expect(Object.keys(seat).filter((k) => !(k in PLAYER_EXPOSURE))).toEqual([]);
    }
  });

  it('«owner-private» — в карточке соперника не осталось данных', () => {
    const leaked = playerKeys.filter(
      (k) => PLAYER_EXPOSURE[k] === 'owner-private' && !carriesNoData(theirs[k]),
    );
    expect(leaked).toEqual([]);
  });

  it('своя карточка доезжает целиком — приватность не должна слепить зрителя', () => {
    for (const key of playerKeys) {
      expect(mine[key], `своё поле ${key} потерялось`).toEqual(source.players[VIEWER]![key]);
    }
  });

  it('«public» — публичное поле соперника доехало', () => {
    for (const key of playerKeys) {
      if (PLAYER_EXPOSURE[key] !== 'public') continue;
      expect(theirs[key]).toEqual(source.players[RIVAL]![key]);
    }
  });
});

describe('сторож тумана — канарейка', () => {
  it('ни одна CANARY_-строка соперника не доехала до зрителя', () => {
    const source = maximalState();
    const view = visibleState(source, VIEWER, data);
    // Сначала убеждаемся, что канарейки в исходнике ЕСТЬ — иначе тест зелен впустую.
    expect(JSON.stringify(source)).toContain('CANARY_');
    const found = [...JSON.stringify(view).matchAll(/CANARY_[A-Za-z_]+/g)].map((m) => m[0]);
    expect([...new Set(found)]).toEqual([]);
  });

  it('вместо живой правды мира за туманом зритель видит СВОЮ память о нём', () => {
    const source = maximalState();
    const view = visibleState(source, VIEWER, data);
    expect(view.remembered).toEqual(['Z']);
    // Память зрителя: один разведчик и ни одного здания — не живой гарнизон `Z`.
    expect(view.planets.Z!.garrison).toEqual([{ unit: 'scout', count: 1 }]);
    expect(view.planets.Z!.buildings).toEqual([]);
  });
});

/** Структурное равенство «как в JSON» — та же семантика, что у `hashState`. */
function deepSame(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
