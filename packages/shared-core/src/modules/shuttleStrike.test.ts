/**
 * УДАР ЧЕЛНОКОВ (SHU-1.2) — «вылетел, ударил, сразу домой».
 *
 * Заказ владельца 2026-09-08: челноки бьют НАПРЯМУЮ от своего узла до цели, минуя линии
 * между узлами, в бой не вступают и возвращаются туда, откуда вылетели. Отсюда правила:
 *
 * 1. **Вылет только из живого порта.** Нет порта — `E_NO_PORT`; порт повреждён более чем
 *    на 30% — `E_PORT_DAMAGED`. Порог именно на ВЫЛЕТ: возврату он не мешает, иначе
 *    челнок повис бы в пустоте, а такой сущности в модели нет.
 * 2. **Дальше радиуса не бьют.** `strikeRange` считается от узла базирования, а не от
 *    самой машины: у челнока нет своей позиции, пока он в порту.
 * 3. **Удар не начинает боя.** Цель получает урон, `battleId` не появляется — та же
 *    семантика, что у артиллерийского standoff. Безответным удар при этом БЫТЬ ПЕРЕСТАЛ
 *    (ROS-2.2): цена налёта и зональное ПВО — в `shuttleReturnFire.test.ts`.
 * 4. **Возврат в ТОТ ЖЕ порт.** Стеки уходят из ангара на время полёта и возвращаются в
 *    него же; порта не стало, пока летели — челноки гибнут вместе с ним.
 * 5. **Топливо тратится на вылет, перезарядка идёт в порту.** Кончилось — `E_NO_FUEL`
 *    до конца перезарядки. Счётчик принадлежит ПОРТУ: челноки в ангаре — стеки без своей
 *    личности, топливо на стеке запретило бы им сливаться.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { shuttleModule } from './shuttle';
import { constructionModule } from './construction';
import { createInitialState, type Fleet, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 6, hp: 100 } },
    interceptor: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      // speed 100 map units/hour, радиус 180 — до B (100) достаёт, до C (300) нет.
      // ROS-1.4: по ЗДАНИЯМ почти не работает (siegeDamage 1) — он охотник, не бомбер.
      stats: {
        attack: 12,
        defense: 3,
        speed: 100,
        hp: 10,
        strikeRange: 180,
        fuel: 2,
        rearmRounds: 2,
        siegeDamage: 1,
        // SHU-1.3: ради этого он и охотник — урон ПО ЧУЖИМ ЧЕЛНОКАМ. Хватает,
        // чтобы двое сбили одну машину чужого вылета (корпус 10).
        shuttleDamage: 12,
      },
    },
    // ROS-1.4: бомбардировщик — челнок против КОРАБЛЕЙ, по зданиям средний.
    bomber: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: {
        attack: 20,
        defense: 4,
        speed: 100,
        hp: 16,
        strikeRange: 180,
        fuel: 2,
        rearmRounds: 3,
        siegeDamage: 8,
      },
    },
    // Челнок БЕЗ осадного стата — сторож мягкой деградации: бьёт здания по `attack`,
    // ровно как весь контент до ROS-1.4.
    legacy_shuttle: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: { attack: 6, defense: 3, speed: 100, hp: 10, strikeRange: 180, fuel: 2, rearmRounds: 2 },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
    mine: { name: 'Mine', cost: {}, buildTimeHours: 0, hp: 20 },
  },
  events: {},
});

const kernel = createKernel([constructionModule, shuttleModule]);
const at = (s: GameState): Context => ({ now: s.time, data });

const player = (id: string): Player => ({ id, name: id, faction: 'x', status: 'active', resources: {} });

const planet = (
  id: string,
  owner: string | null,
  x: number,
  buildings: Array<[string, number]> = [],
): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: buildings.map(([type, hp]) => ({ type, level: 1, hp })),
  garrison: [],
  traits: [],
});

const fleet = (id: string, owner: string, location: string, hp?: number): Fleet => ({
  id,
  owner,
  location,
  movement: null,
  units: [{ unit: 'cruiser', count: 1, ...(hp === undefined ? {} : { hp }) }],
  traits: [],
  battleId: null,
});

/** Мир: свой порт A(0) с челноками, чужой флот у B(100) — в радиусе, и C(300) — вне его. */
function world(over: { portHp?: number; hangar?: number } = {}): GameState {
  const s = createInitialState({ seed: 'shu2', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, [['spaceport', over.portHp ?? 30]]);
  // SHU-4.2: ангар — список ЭСКАДР. Одна эскадра на класс машин, id выводится из
  // юнита, чтобы приказ ниже мог адресовать её, не таская id через все вызовы.
  home.hangar = [{ id: 'sq:interceptor', units: [{ unit: 'interceptor', count: over.hangar ?? 2 }] }];
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      A: home,
      B: planet('B', 'p2', 100, [['mine', 20]]),
      C: planet('C', 'p2', 300, [['mine', 20]]),
    },
    fleets: { E1: fleet('E1', 'p2', 'B'), FAR: fleet('FAR', 'p2', 'C') },
    heroes: {},
    battles: {},
  };
}

/** Доложить в порт A машины другого класса (ROS-1.4). Отдельным хелпером, а не в
 *  `world()`: состав ангара по умолчанию закреплён тестами вылета и возврата, и
 *  лишний стек там сдвинул бы их счёт. */
function withHangar(state: GameState, unit: string, count = 2): GameState {
  const home = state.planets.A!;
  return {
    ...state,
    planets: {
      ...state.planets,
      A: { ...home, hangar: [...(home.hangar ?? []), { id: `sq:${unit}`, units: [{ unit, count }] }] },
    },
  };
}

let seq = 0;
/** Вылет ЭСКАДРЫ (SHU-4.2): летит соединение целиком, поэтому «сколько машин послать»
 *  здесь больше не параметр — состав задаётся ангаром, а делёж отдельным приказом. */
const strike = (
  target: ({ targetFleetId: string } | { targetPlanetId: string }) & { unit?: string },
  squadronId?: string,
  planetId = 'A',
): Action => {
  const { unit = 'interceptor', ...where } = target;
  return {
    id: `a:${seq++}`,
    type: 'shuttle.strike',
    playerId: 'p1',
    payload: { planetId, squadronId: squadronId ?? `sq:${unit}`, ...where },
    issuedAt: 0,
  };
};

const split = (units: Array<{ unit: string; count: number }>, squadronId = 'sq:interceptor'): Action => ({
  id: `a:${seq++}`,
  type: 'shuttle.split',
  playerId: 'p1',
  payload: { planetId: 'A', squadronId, units },
  issuedAt: 0,
});

function apply(state: GameState, action: Action): GameState {
  const r = kernel.applyAction(state, action, at(state));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function code(state: GameState, action: Action): string | null {
  const r = kernel.applyAction(state, action, at(state));
  return r.ok ? null : r.code;
}
function advance(state: GameState, hours: number): GameState {
  const r = kernel.advanceTo(state, { now: state.time + hours * 3_600_000, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const hangar = (s: GameState, id = 'A'): number =>
  (s.planets[id]?.hangar ?? []).reduce(
    (n, sq) => n + sq.units.reduce((m, st) => m + st.count, 0),
    0,
  );
const hullOf = (s: GameState, id: string): number | undefined => s.fleets[id]?.units[0]?.hp;

describe('удар челноков — вылет (правила 1–2, 5)', () => {
  it('нет порта — вылет отбивается', () => {
    const s = world();
    s.planets.A!.buildings = [];
    expect(code(s, strike({ targetFleetId: 'E1' }))).toBe('E_NO_PORT');
  });

  it('ПОРТ ПОВРЕЖДЁН БОЛЬШЕ ЧЕМ НА 30% — ВЫЛЕТА НЕТ', () => {
    // 30 hp максимум: 20 — это потеря 33%, порт уже не выпускает.
    expect(code(world({ portHp: 20 }), strike({ targetFleetId: 'E1' }))).toBe('E_PORT_DAMAGED');
    // 21 hp — потеря 30%, ровно на границе: порог «БОЛЕЕ чем на 30%» её пропускает.
    expect(code(world({ portHp: 21 }), strike({ targetFleetId: 'E1' }))).toBeNull();
  });

  // SHU-4.2 сменил здесь правило, а не отменил его: «послать больше, чем есть» стало
  // невыразимо — летит ЭСКАДРА целиком, — зато появился приказ по несуществующему
  // соединению, и он обязан отбиваться так же честно.
  it('приказ по НЕСУЩЕСТВУЮЩЕЙ эскадре отбивается, а не молчит', () => {
    expect(code(world(), strike({ targetFleetId: 'E1' }, 'нет-такой'))).toBe('E_NO_SQUADRON');
  });

  it('ДАЛЬШЕ РАДИУСА НЕ БЬЮТ: цель за strikeRange от узла базирования', () => {
    expect(code(world(), strike({ targetFleetId: 'FAR' }))).toBe('E_OUT_OF_RANGE');
  });

  it('по своим не бьют', () => {
    const s = world();
    s.fleets.E1!.owner = 'p1';
    expect(code(s, strike({ targetFleetId: 'E1' }))).toBe('E_NOT_HOSTILE');
  });

  it('вылет ЗАБИРАЕТ челноки из ангара и ставит удар в полёт', () => {
    const s = apply(world(), strike({ targetFleetId: 'E1' }));
    expect(hangar(s)).toBe(0);
    expect(s.strikes).toHaveLength(1);
    expect(s.strikes?.[0]?.leg).toBe('out');
  });

  it('ТОПЛИВО ТРАТИТСЯ НА ВЫЛЕТ, а кончившись — запирает порт до перезарядки', () => {
    // Топливо у ПОРТА, поэтому его жгут вылеты, а не машины: три эскадры по одной
    // машине выжигают его ровно так же, как три вылета одной (SHU-1.2).
    let s = world({ hangar: 4 });
    s = apply(s, split([{ unit: 'interceptor', count: 1 }]));
    s = apply(s, split([{ unit: 'interceptor', count: 1 }]));
    const ids = (s.planets.A?.hangar ?? []).map((q) => q.id);
    s = apply(s, strike({ targetFleetId: 'E1' }, ids[1])); // fuel 2 → 1
    s = apply(s, strike({ targetFleetId: 'E1' }, ids[2])); // fuel 1 → 0, порт на перезарядке
    expect(code(s, strike({ targetFleetId: 'E1' }, ids[0]))).toBe('E_NO_FUEL');
  });
});

describe('перехват — свои челноки поднимаются навстречу чужому удару (SHU-1.3)', () => {
  // Заказ владельца: перехватчик создан ПРОТИВ ЧЕЛНОКОВ. До этого кирпича ударить по
  // чужому вылету было нечем вовсе — цель удара это флот или мир, — поэтому роль
  // существовала только на бумаге, а `shuttleDamage` некому было читать.
  /** Мир p2 с портом и перехватчиками в ангаре — он и будет перехватывать. */
  const defended = (over: { hangar?: number; fuel?: number; attackers?: number } = {}): GameState => {
    const s = world({ hangar: over.attackers ?? 2 });
    const b = s.planets.B!;
    const port = { type: 'spaceport', level: 1, hp: 30 };
    return {
      ...s,
      planets: {
        ...s.planets,
        B: {
          ...b,
          buildings: [...b.buildings, port],
          hangar: [{ id: 'sq:defender', units: [{ unit: 'interceptor', count: over.hangar ?? 2 }] }],
          ...(over.fuel === undefined ? {} : { sortie: { fuel: over.fuel, rearming: 0 } }),
        },
      },
    };
  };

  it('чужой удар по пути ТЕРЯЕТ машины — перехватчики поднялись и сбили', () => {
    // Двое перехватчиков дают 24 урона, корпус челнока 10 → сбиты ДВЕ машины из трёх.
    const s = apply(defended({ attackers: 3 }), strike({ targetPlanetId: 'B' }));
    const after = advance(s, 2);
    const mine = after.planets.B?.buildings.find((b) => b.type === 'mine');
    expect(mine?.hp).toBe(19); // долетел ОДИН челнок: 1 × siegeDamage 1
  });

  it('удар, потерявший ВСЕ машины, до цели не доходит вовсе', () => {
    const s = apply(defended(), strike({ targetPlanetId: 'B' }));
    const after = advance(s, 2);
    const mine = after.planets.B?.buildings.find((b) => b.type === 'mine');
    expect(mine?.hp).toBe(20); // 24 урона против двух корпусов по 10 — сбиты оба
    expect(after.strikes ?? []).toHaveLength(0);
  });

  it('перехват тратит топливо базы — бесконечно поднимать нельзя', () => {
    // Смотрим состояние СРАЗУ после перехвата: дальше вступает перезарядка (час мира =
    // раунд), и через пару часов бак снова полон — это другой механизм, SHU-1.2.
    const s = apply(defended({ fuel: 1 }), strike({ targetPlanetId: 'B' }));
    const after = advance(s, 1);
    expect(after.planets.B?.sortie?.fuel).toBe(0);
    expect(after.planets.B?.sortie?.rearming).toBeGreaterThan(0);
  });

  it('без топлива перехвата НЕТ — удар доходит целиком', () => {
    const s = apply(defended({ fuel: 0 }), strike({ targetPlanetId: 'B' }));
    const after = advance(s, 2);
    const mine = after.planets.B?.buildings.find((b) => b.type === 'mine');
    expect(mine?.hp).toBe(18); // оба челнока дошли: 2 × 1
  });

  it('СВОЙ удар не перехватывают — поднимаются только против чужого', () => {
    // Порт p1 с перехватчиками бьёт по своему же миру A: перехвата быть не должно.
    const s0 = world();
    const own: GameState = {
      ...s0,
      planets: {
        ...s0.planets,
        A: { ...s0.planets.A!, owner: 'p1' },
      },
    };
    const s = apply(own, strike({ targetFleetId: 'E1' }));
    const after = advance(s, 2);
    expect(after.strikes ?? []).toHaveLength(0); // долетел и вернулся, никто не мешал
    expect(hullOf(after, 'E1')).toBeLessThan(100);
  });

  it('машина без shuttleDamage перехватывать не умеет — она не охотник', () => {
    const s0 = world();
    const b = s0.planets.B!;
    const withBombers: GameState = {
      ...s0,
      planets: {
        ...s0.planets,
        B: {
          ...b,
          buildings: [...b.buildings, { type: 'spaceport', level: 1, hp: 30 }],
          hangar: [{ id: 'sq:legacy', units: [{ unit: 'legacy_shuttle', count: 4 }] }],
        },
      },
    };
    const s = apply(withBombers, strike({ targetPlanetId: 'B' }));
    const after = advance(s, 2);
    const mine = after.planets.B?.buildings.find((b) => b.type === 'mine');
    expect(mine?.hp).toBe(18); // удар дошёл целиком
  });
});

describe('удар челноков — попадание и возврат (правила 3–4)', () => {
  it('УДАР НЕ НАЧИНАЕТ БОЯ: цель получает урон, битвы не появляется', () => {
    const s = apply(world(), strike({ targetFleetId: 'E1' }));
    const after = advance(s, 2); // 100 ед. пути на скорости 100 = час туда
    expect(hullOf(after, 'E1')).toBeLessThan(100);
    expect(after.fleets.E1?.battleId ?? null).toBeNull();
    expect(Object.keys(after.battles)).toEqual([]);
  });

  it('по МИРУ бьют здания (как бомбардировка), а не гарнизон', () => {
    const s = apply(world(), strike({ targetPlanetId: 'B' }));
    const after = advance(s, 2);
    const mine = after.planets.B?.buildings.find((b) => b.type === 'mine');
    expect(mine?.hp ?? 0).toBeLessThan(20);
  });

  // ROS-1.4. У челнока теперь ДВА профиля урона: по кораблям он бьёт `attack`, по
  // зданиям — `siegeDamage`. Одной цифрой «перехватчик против челноков, бомбардировщик
  // против кораблей» не выражалось: любой челнок был одинаково хорош против всего.
  it('по ЗДАНИЯМ челнок бьёт своим siegeDamage, а не attack', () => {
    // Перехватчик: attack 12, siegeDamage 1. Двое за удар снимают 2 hp, а не 24.
    const s = apply(world(), strike({ targetPlanetId: 'B' }));
    const after = advance(s, 2);
    const mine = after.planets.B?.buildings.find((b) => b.type === 'mine');
    expect(mine?.hp).toBe(18);
  });

  it('бомбардировщик по зданиям бьёт заметно сильнее перехватчика', () => {
    const s = apply(withHangar(world(), 'bomber'), strike({ targetPlanetId: 'B', unit: 'bomber' }));
    const after = advance(s, 2);
    const mine = after.planets.B?.buildings.find((b) => b.type === 'mine');
    expect(mine?.hp).toBe(4); // 2 × 8 = 16 против 2 у перехватчика
  });

  it('по КОРАБЛЯМ обе машины бьют своим attack, осадный стат не участвует', () => {
    const hit = (unit: string): number => {
      const s = apply(withHangar(world(), unit), strike({ targetFleetId: 'E1', unit }));
      // `hp` появляется только когда по стеку попали; целый корпус — это undefined,
      // то есть «снято ноль».
      return 100 - (hullOf(advance(s, 2), 'E1') ?? 100);
    };
    expect(hit('bomber')).toBe(40); // 2 × 20
    expect(hit('interceptor')).toBe(24); // 2 × 12 — по кораблю он слабее бомбардировщика
  });

  it('челнок без siegeDamage бьёт здания по-старому — своим attack', () => {
    const s = apply(
      withHangar(world(), 'legacy_shuttle'),
      strike({ targetPlanetId: 'B', unit: 'legacy_shuttle' }),
    );
    const after = advance(s, 2);
    const mine = after.planets.B?.buildings.find((b) => b.type === 'mine');
    expect(mine?.hp).toBe(8); // 2 × 6 = 12, как до разделения профилей
  });

  it('ЧЕЛНОКИ ВОЗВРАЩАЮТСЯ В ТОТ ЖЕ ПОРТ', () => {
    const s = apply(world(), strike({ targetFleetId: 'E1' }));
    const after = advance(s, 4); // час туда + час обратно, с запасом
    expect(hangar(after)).toBe(2);
    expect(after.strikes ?? []).toHaveLength(0);
  });

  it('ПОРТА НЕ СТАЛО, ПОКА ЛЕТЕЛИ — челноки гибнут вместе с ним', () => {
    let s = apply(world(), strike({ targetFleetId: 'E1' }));
    s = { ...s, planets: { ...s.planets, A: { ...s.planets.A!, buildings: [] } } };
    const after = advance(s, 4);
    expect(hangar(after)).toBe(0);
    expect(after.strikes ?? []).toHaveLength(0);
  });

  it('ПЕРЕЗАРЯДКА ИДЁТ В ПОРТУ: отстоявшись, он снова выпускает', () => {
    // Топливо принадлежит ПОРТУ, а не эскадре (SHU-1.2), поэтому два вылета подряд его
    // и жгут — даже если летают разные соединения. Делёж вылетов не удваивает.
    let s = world({ hangar: 4 });
    s = apply(s, split([{ unit: 'interceptor', count: 2 }]));
    const second = (s.planets.A?.hangar ?? []).find((q) => q.id !== 'sq:interceptor')!.id;
    s = apply(s, strike({ targetFleetId: 'E1' }));
    s = apply(s, strike({ targetFleetId: 'E1' }, second)); // топливо кончилось
    s = advance(s, 4); // вернулись + отстояли перезарядку (rearmRounds 2 часа)
    expect(code(s, strike({ targetFleetId: 'E1' }))).toBeNull();
  });
});
