/**
 * ОТВЕТНЫЙ УРОН ЧЕЛНОКАМ И ЗОНАЛЬНОЕ ПВО (ROS-2.2, заказ владельца 2026-09-09, п. 4).
 *
 * До этого кирпича удар челнока был безнаказан ВСЕГДА: цель теряла корпус, вылет —
 * ничего. Заказ переводит челнок в разряд стороны боя, не втягивая его в бой:
 *
 * 1. **Ответка приходит в момент удара**, а не отдельным залпом по трассе (то —
 *    зональное ПВО флота и перехват, они живут своей реактивной логикой).
 * 2. **От кораблей — символическая**, доля их огня: рой машин стоит целям единиц.
 * 3. **От планеты — НОЛЬ**, пока на ней нет зенитных установок: голый мир челноку
 *    ответить нечем.
 * 4. **Зональное ПВО — вот за что платят.** И здание, и модуль корабля считаются
 *    одним статом `pointDefense`, и он выкашивает половину волны.
 * 5. **Бой всё равно не начинается.** Ни `battleId`, ни раундов: челнок огрызается и
 *    уходит домой — ровно этого просил заказ.
 * 6. **Ответка идёт через хук `combat.damage`** со своей фазой (CORE-DMG-1), иначе
 *    техи и пассивы фракций работали бы во всех каналах огня, кроме этого.
 * 7. **Сбитые считаются по корпусу челнока** — ровно тем же счётом, что у зонального
 *    ПВО на трассе. Второй арифметики «раненого крыла» в модели нет.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { shuttleModule } from './shuttle';
import { constructionModule } from './construction';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, DomainEvent } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Обычный корабль: пушки есть, зенитки нет. Десяток таких — предел учёта огня
    // (COMBAT_UNIT_CAP), то есть 200 единиц, из которых челнокам достаётся доля.
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 20, defense: 5, speed: 6, hp: 200 } },
    // Тот же корабль с модулем зонального ПВО — за это и платят (§0.2 даёт модулю
    // сегодняшний `point_defense_array`, здесь его число укрупнено до здания).
    escort: {
      faction: 'x',
      domain: 'space',
      stats: { attack: 20, defense: 5, speed: 6, hp: 200, pointDefense: 40 },
    },
    interceptor: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: {
        attack: 12,
        defense: 3,
        speed: 100,
        hp: 10,
        strikeRange: 180,
        fuel: 4,
        rearmRounds: 2,
        siegeDamage: 1,
      },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 12 },
    mine: { name: 'Mine', cost: {}, buildTimeHours: 0, hp: 200 },
    zonal_aa: { name: 'Area Defense Battery', cost: {}, buildTimeHours: 0, hp: 22, pointDefense: 40 },
  },
  events: {},
});

const HOUR = 3_600_000;
const at = (s: GameState): Context => ({ now: s.time, data });
const player = (id: string): Player => ({ id, name: id, faction: 'x', status: 'active', resources: {} });

function planet(id: string, owner: string | null, x: number, buildings: string[] = []): Planet {
  return {
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: buildings.map((type) => ({ type, level: 1, hp: data.buildings[type]!.hp })),
    garrison: [],
    traits: [],
  };
}

function fleet(id: string, owner: string, location: string, units: Array<[string, number]>): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map(([unit, count]) => ({ unit, count })),
    traits: [],
    battleId: null,
  };
}

/** Мир: свой порт A(0) с восемью машинами, чужие цели у B(100) — в радиусе удара. */
function world(over: { defenders?: Array<[string, number]>; aa?: boolean } = {}): GameState {
  const s = createInitialState({ seed: 'ros22', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, ['spaceport']);
  home.hangar = [{ unit: 'interceptor', count: 8 }];
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      A: home,
      B: planet('B', 'p2', 100, over.aa === true ? ['mine', 'zonal_aa'] : ['mine']),
    },
    fleets: { E1: fleet('E1', 'p2', 'B', over.defenders ?? [['cruiser', 10]]) },
    heroes: {},
    battles: {},
  };
}

let seq = 0;
const strike = (
  target: { targetFleetId: string } | { targetPlanetId: string },
  count = 8,
): Action => ({
  id: `a:${seq++}`,
  type: 'shuttle.strike',
  playerId: 'p1',
  payload: { planetId: 'A', unit: 'interceptor', count, ...target },
  issuedAt: 0,
});

/** Прогон удара: приказ на вылет, затем два часа — долёт (час) и возврат. */
function run(
  state: GameState,
  action: Action,
  modules: GameModule[] = [],
): { state: GameState; events: DomainEvent[] } {
  const kernel = createKernel([constructionModule, shuttleModule, ...modules]);
  const applied = kernel.applyAction(state, action, at(state));
  if (!applied.ok) throw new Error(applied.code);
  const advanced = kernel.advanceTo(applied.state, { now: applied.state.time + 2 * HOUR, data });
  if (!advanced.ok) throw new Error(advanced.code);
  return { state: advanced.state, events: [...applied.events, ...advanced.events] };
}

/** Сколько машин село обратно в порт (то есть пережило ответку). */
const home = (s: GameState): number =>
  (s.planets.A?.hangar ?? []).reduce((n, st) => n + st.count, 0);
/** Нагрузка события ответки. У ядра ключи события — `unknown`, поэтому приведение стоит
 *  в ОДНОМ месте, а не рассыпано по каждому `expect`. */
interface RepelPayload {
  owner: string;
  targetId: string;
  targetOwner: string | null;
  damage: number;
  downed: number;
}
const repelled = (events: DomainEvent[]): RepelPayload | undefined =>
  events.find((e) => e.type === 'shuttle.repelled')?.payload as RepelPayload | undefined;
/** Урон реактивного залпа зонального ПВО по трассе (`pd.fired`) — тем же способом. */
const pdDamage = (events: DomainEvent[]): number | undefined =>
  (events.find((e) => e.type === 'pd.fired')?.payload as { damage: number } | undefined)?.damage;

describe('ROS-2.2 — ответный урон в момент удара (правила 1–3)', () => {
  it('ГОЛЫЙ МИР ОТВЕТИТЬ НЕ МОЖЕТ: без зонального ПВО волна возвращается целиком', () => {
    const { state, events } = run(world(), strike({ targetPlanetId: 'B' }));
    expect(home(state)).toBe(8);
    expect(repelled(events)).toBeUndefined();
  });

  it('корабли огрызаются ДОЛЕЙ своего огня — рой машин стоит целям единиц', () => {
    // Десять крейсеров по 20 — 200 единиц огня в пределах учёта; ответка это 5% от
    // них, то есть 10, а корпус челнока 10 → ровно одна сбитая машина из восьми.
    const { state, events } = run(world(), strike({ targetFleetId: 'E1' }));
    expect(home(state)).toBe(7);
    expect(repelled(events)?.downed).toBe(1);
  });

  it('НЕДОБОР ДО КОРПУСА НЕ ПРОПАДАЕТ И НЕ ОКРУГЛЯЕТСЯ ВВЕРХ: один крейсер не сбивает никого', () => {
    // Один крейсер — 20 огня, ответка 1 при корпусе 10. Машина не гибнет «на 10%».
    const { state, events } = run(world({ defenders: [['cruiser', 1]] }), strike({ targetFleetId: 'E1' }));
    expect(home(state)).toBe(8);
    expect(repelled(events)?.downed).toBe(0);
  });
});

describe('ROS-2.2 — зональное ПВО: вот за что платят (правило 4)', () => {
  it('МИР С ЗОНАЛЬНЫМ ПВО ВЫКАШИВАЕТ ПОЛВОЛНЫ', () => {
    // Здание даёт 40 при корпусе челнока 10 — четыре машины из восьми.
    const { state, events } = run(world({ aa: true }), strike({ targetPlanetId: 'B' }));
    expect(home(state)).toBe(4);
    expect(repelled(events)?.downed).toBe(4);
  });

  it('модуль корабля считается ТЕМ ЖЕ статом, что и здание — и стреляет ДВАЖДЫ', () => {
    // Корабельная зенитка бьёт по вылету в ДВУХ разных местах, и это не дубль:
    // на трассе — реактивным залпом (SHU-1.2, `pd.fired`), в момент удара — ответкой.
    // Каналы разные, стат один; сложи их в один — и модуль потеряет половину смысла.
    const { events } = run(world({ defenders: [['escort', 1]] }), strike({ targetFleetId: 'E1' }));
    expect(pdDamage(events)).toBe(40);
    // Ответка: доля пушек (20 × 5% = 1) плюс та же зенитка.
    expect(repelled(events)?.damage).toBe(41);
  });

  it('здание с зениткой — обычная постройка: снесли её ударом, и мир снова безответен', () => {
    const s = world({ aa: true });
    s.planets.B!.buildings = s.planets.B!.buildings.filter((b) => b.type !== 'zonal_aa');
    expect(home(run(s, strike({ targetPlanetId: 'B' })).state)).toBe(8);
  });
});

describe('ROS-2.2 — что ответка НЕ делает (правила 5–7)', () => {
  it('БОЯ ВСЁ РАВНО НЕТ: ни battleId у цели, ни битвы в состоянии', () => {
    const { state } = run(world(), strike({ targetFleetId: 'E1' }));
    expect(state.fleets.E1?.battleId ?? null).toBeNull();
    expect(Object.keys(state.battles)).toEqual([]);
  });

  it('ответка идёт ЧЕРЕЗ ХУК combat.damage со своей фазой — техи достают и сюда', () => {
    const phases: string[] = [];
    const probe: GameModule = {
      id: 'damage-probe',
      version: '1.0.0',
      setup(api) {
        api.hook<number>('combat.damage', (dmg, args) => {
          phases.push(String((args as { phase?: string }).phase));
          return dmg * 4; // множитель, до которого сама ответка не дотягивает
        });
      },
    };
    const plain = run(world({ aa: true }), strike({ targetPlanetId: 'B' }));
    const boosted = run(world({ aa: true }), strike({ targetPlanetId: 'B' }), [probe]);
    expect(phases).toContain('returnFire');
    // 40 → 160 при корпусе 10: волны из восьми не остаётся вовсе.
    expect(home(boosted.state)).toBeLessThan(home(plain.state));
    expect(home(boosted.state)).toBe(0);
  });

  it('вылет, сбитый ЦЕЛИКОМ, домой не возвращается и в состоянии не остаётся', () => {
    // Цель — МИР с двумя батареями (80 при корпусе 10): планета не стреляет по трассе,
    // поэтому вся волна ложится именно ответкой, а не залпом по дороге.
    const s = world({ aa: true });
    s.planets.B!.buildings = [...s.planets.B!.buildings, { type: 'zonal_aa', level: 1, hp: 22 }];
    const { state, events } = run(s, strike({ targetPlanetId: 'B' }));
    expect(repelled(events)?.downed).toBe(8);
    expect(home(state)).toBe(0);
    expect(state.strikes ?? []).toEqual([]);
  });

  it('УДАР ВСЁ РАВНО ПРОХОДИТ: ответка не отменяет урон по цели', () => {
    const { state } = run(world({ aa: true }), strike({ targetPlanetId: 'B' }));
    const mine = state.planets.B?.buildings.find((b) => b.type === 'mine');
    // Восемь машин по siegeDamage 1 бьют ДО того, как ответка их проредила:
    // залпы считаются из одного снимка, как у артиллерии.
    expect(mine!.hp).toBe(data.buildings.mine!.hp - 8);
  });

  it('событие ответки называет и стрелка, и цель, и цену — иначе лента боя молчит', () => {
    const { events } = run(world({ aa: true }), strike({ targetPlanetId: 'B' }));
    const e = repelled(events);
    expect(e).toBeDefined();
    expect(e!.owner).toBe('p1'); // чьи машины сбиты — по этому ключу его и покажут
    expect(e!.targetId).toBe('B');
    expect(e!.targetOwner).toBe('p2');
    expect(e!.damage).toBe(40);
    expect(e!.downed).toBe(4);
  });
});
