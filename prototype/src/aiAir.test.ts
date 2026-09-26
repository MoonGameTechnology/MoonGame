// AI-BAL-4: артиллерия и эскадрильи у ТЕСТ-бота (профиль `test`, AI-BAL-1.1).
//
// Что здесь закрепляется. `siege`, `interceptor`, `frigate`
// и `hero` показывались «мёртвым контентом» — и каждая позиция оказалась мертва по СВОЕЙ
// причине, а не по одной общей:
//   • `siege` — просто не было правила. (Рядом жило правило постройки корпуса
//     `artillery`; дальний огонь из игры убран, корпуса в данных нет, и правило снято
//     2026-09-16 — оно заказывало несуществующий юнит каждый тик.);
//   • `interceptor` — был НЕПОСТРОИМ вовсе: ангар открывается вторым уровнем завода,
//     а гейт читал только базовый def (починено в `construction.ts`);
//   • `hero` — не мёртв: он ПОСЕЯН во флоте каждого места с первой секунды и воюет, просто
//     не проходит через `unit.built`. Врал отчёт, а не бот (починено в `selfplay.mjs`).
// `frigate` намеренно оставлен боту ненужным — см. хвост файла.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES, kernel, ctx } from './game';
import { data } from './gameData';
import type { Action, GameState, Squadron } from '../../packages/shared-core/src/index';
import { identifiedNodes } from '../../packages/shared-core/src/state/visibility';

function game2(): GameState {
  return newGame({
    seats: [
      { id: 'p1', name: 'A', faction: 'azure', start: START_CANDIDATES[0]!, ai: true },
      { id: 'p2', name: 'B', faction: 'crimson', start: START_CANDIDATES[1]!, ai: true },
    ],
  });
}

const only = (actions: Action[], type: string): Action[] => actions.filter((a) => a.type === type);
const unitsBuilt = (actions: Action[]): string[] =>
  only(actions, 'unit.build').map((a) => (a.payload as { unit: string }).unit);

/** Война + богатая казна: правило должно быть ПО КАРМАНУ, иначе тест мерил бы бедность. */
function rich(s: GameState, war = true): GameState {
  return {
    ...s,
    ...(war ? { diplomacy: { ...(s.diplomacy ?? {}), 'p1|p2': 'war' } } : {}),
    players: {
      ...s.players,
      p2: {
        ...s.players.p2!,
        resources: { credits: 6000, metal: 9000, food: 800, energy: 800, microelectronics: 400 },
      },
    },
  };
}


/** Заказанные крейсеры с осадным модулем (SIEGE-1: осада — модуль, а не корпус). */
const siegeBuilt = (actions: Action[]): number =>
  only(actions, 'unit.build').filter((a) => {
    const p = a.payload as { unit: string; modules?: string[] };
    return p.unit === 'cruiser' && !!p.modules?.includes('siege_platform');
  }).length;

describe('SIEGE-1 — осада модулем', () => {
  it('на войне строит крейсер с модулем «Осадная платформа»', () => {
    expect(siegeBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'strong'))).toBe(1);
  });

  it('в мирное время осадных крейсеров не строит', () => {
    expect(siegeBuilt(aiOrders(rich(game2(), false), 'p2', 'expand', 'strong'))).toBe(0);
  });

  it('ИГРОВОЙ бот осадных крейсеров не строит даже на войне', () => {
    expect(siegeBuilt(aiOrders(rich(game2()), 'p2', 'expand'))).toBe(0);
  });

  it('юнита `siege` бот не заказывает никогда — его нет в данных', () => {
    expect(unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'strong'))).not.toContain('siege');
  });
});

/** Мир бота с ПОСТРОЕННЫМ портом: с YARD-1 дом несёт верфь, а ангар даёт космопорт. */
function withPort(s: GameState): GameState {
  const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
  home.buildings = [
    ...home.buildings,
    { type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp },
  ];
  return s;
}

describe('AI-BAL-4 / SHU-1.1 — челноки строятся в КОСМОПОРТЕ', () => {
  // Воротами когда-то был завод второго уровня, потом порт, приезжавший вместе с домом.
  // С YARD-1 порт — ОТДЕЛЬНОЕ здание, которого на старте нет: ворота вернулись, но
  // короткие, и бот проходит их сам (цепочка экономики).
  it('порт построен — сильный бот заказывает челнок', () => {
    expect(unitsBuilt(aiOrders(withPort(rich(game2())), 'p2', 'expand', 'strong'))).toContain(
      'interceptor',
    );
  });

  it('ИГРОВОЙ (слабый) бот челноков не заказывает', () => {
    expect(unitsBuilt(aiOrders(withPort(rich(game2())), 'p2', 'expand'))).not.toContain(
      'interceptor',
    );
  });

  /**
   * YARD-1 — регрессия, которую эта правка и завела бы, не спроси бот ядро.
   *
   * До разделения `orderShuttle` опирался на допущение «порт у бота и так есть под
   * корабли». Допущение стало неверным в тот же коммит, что и разделение, а тест бы
   * этого не заметил: он смотрел на НАМЕРЕНИЕ бота, а не на ответ ядра. Бот заказывал бы
   * челноки на мир без ангара и платил отказом `E_NO_PORT` каждый тик весь матч — ровно
   * тем же способом, каким когда-то упирался в `E_HANGAR_FULL`.
   */
  it('ПОРТА НЕТ — заказа челнока нет вовсе, а не отказ ядра каждый тик', () => {
    const s = rich(game2());
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    expect(home.buildings.some((b) => b.type === 'spaceport')).toBe(false); // дом несёт верфь
    const built = unitsBuilt(aiOrders(s, 'p2', 'expand', 'strong'));
    expect(built).not.toContain('interceptor');
    expect(built).not.toContain('bomber');
  });

  it('ПОРТ БОТ СТРОИТ САМ — иначе челноки выпали бы из измерения целиком', () => {
    // Порт стоит звеном экономической цепочки: он и торгует, и открывает ангар.
    const s = rich(game2());
    const wanted = only(aiOrders(s, 'p2', 'expand', 'strong'), 'building.construct').map(
      (a) => (a.payload as { building: string }).building,
    );
    // Цепочка идёт по одному звену за тик, поэтому проверяется не «сейчас», а «дойдёт»:
    // с построенным первым звеном порт становится ближайшим заказом.
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    home.buildings = [
      ...home.buildings,
      { type: 'refinery', level: 1, hp: data.buildings.refinery!.hp },
    ];
    const next = only(aiOrders(s, 'p2', 'expand', 'strong'), 'building.construct').map(
      (a) => (a.payload as { building: string }).building,
    );
    expect([...wanted, ...next]).toContain('spaceport');
  });
});

describe('SHU-3.2 — бот СТРОИТ новый ростер челноков и СЧИТАЕТ ангар', () => {
  it('строит бомбардировщик — челнок против КОРПУСОВ (ROS-1.4)', () => {
    expect(unitsBuilt(aiOrders(withPort(rich(game2())), 'p2', 'expand', 'strong'))).toContain('bomber');
  });

  /** Порт и КАЗАРМЫ: десантный челнок строится с бойцом внутри (SHU-5.2), и боец
   *  требует своего цеха на этом мире — без него ядро челнок не примет. */
  function withBarracks(s: GameState): GameState {
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    home.buildings = [...home.buildings, { type: 'barracks', level: 1, hp: data.buildings.barracks!.hp }];
    return s;
  }

  it('строит десантный челнок — высадка без флота (ROS-1.5)', () => {
    expect(unitsBuilt(aiOrders(withBarracks(withPort(rich(game2()))), 'p2', 'expand', 'strong'))).toContain(
      'landing_shuttle',
    );
  });

  it('БОЙЦА НЕГДЕ ВЗЯТЬ — десантного челнока нет, а не отказ ядра каждый тик (SHU-5.2)', () => {
    // На старте у дома нет ни казарм, ни завода: посадить в челнок некого.
    expect(unitsBuilt(aiOrders(withPort(rich(game2())), 'p2', 'expand', 'strong'))).not.toContain(
      'landing_shuttle',
    );
  });

  it('ДЕСАНТНЫЙ ЧЕЛНОК ЗАКАЗЫВАЕТСЯ С САМЫМ УДАРНЫМ БОЙЦОМ, которого ядро примет (SHU-5.2)', () => {
    const s = withBarracks(withPort(rich(game2())));
    const order = only(aiOrders(s, 'p2', 'expand', 'strong'), 'unit.build').find(
      (a) => (a.payload as { unit: string }).unit === 'landing_shuttle',
    )!;
    const troop = (order.payload as { troop?: string }).troop;
    expect(troop).toBeTruthy();
    // Никого ударнее, кого ядро приняло бы на этом мире, бот не пропустил.
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    const atk = (u: string): number => data.units[u]?.stats.attack ?? 0;
    for (const [id, u] of Object.entries(data.units)) {
      if (u.domain !== 'ground' || atk(id) <= atk(troop!)) continue;
      const alt = { ...order, payload: { planetId: home.id, unit: 'landing_shuttle', count: 1, troop: id } };
      expect(kernel.applyAction(s, alt, ctx(s.time)).ok, id).toBe(false);
    }
    const r = kernel.applyAction(s, order, ctx(s.time));
    expect(r.ok, r.ok ? '' : r.code).toBe(true);
  });

  it('в мирное время ударные челноки не строит — бить некого', () => {
    const peace = unitsBuilt(aiOrders(withPort(rich(game2(), false)), 'p2', 'expand', 'strong'));
    expect(peace).not.toContain('bomber');
    expect(peace).not.toContain('landing_shuttle');
  });

  it('ИГРОВОЙ (слабый) бот новых челноков не заказывает', () => {
    const weak = unitsBuilt(aiOrders(withPort(rich(game2())), 'p2', 'expand'));
    expect(weak).not.toContain('bomber');
    expect(weak).not.toContain('landing_shuttle');
  });

  it('ПОЛНЫЙ АНГАР ОСТАНАВЛИВАЕТ ЗАКАЗ: челноки живут в порту, а не во флоте', () => {
    // Дефект, который чинит этот кирпич: счётчик `shipsOwned` смотрит во флоты и в
    // гарнизон, а челнок с SHU-1.1 лежит в `planet.hangar` — ни там, ни там. Поэтому
    // предел не срабатывал НИКОГДА, и бот заказывал челноки каждый тик до упора в
    // `E_HANGAR_FULL`, платя за это отказами весь матч.
    const s = withPort(rich(game2()));
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    // SHU-4.2: ангар — эскадры, по звену на класс машин (так их и ставит постройка).
    home.hangar = [
      { id: 'sq:i', units: [{ unit: 'interceptor', count: 3 }] },
      { id: 'sq:b', units: [{ unit: 'bomber', count: 3 }] },
      { id: 'sq:l', units: [{ unit: 'landing_shuttle', count: 3 }], cargo: [{ unit: 'militia', count: 3 }] },
    ];
    const built = unitsBuilt(aiOrders(s, 'p2', 'expand', 'strong'));
    expect(built).not.toContain('interceptor');
    expect(built).not.toContain('bomber');
    expect(built).not.toContain('landing_shuttle');
  });
});

describe('SHU-3.2 — бот ПОДНИМАЕТ челноки: иначе они гниют в порту', () => {
  /**
   * Партия, где у дома p2 полный ангар, а В РАДИУСЕ есть по кому ударить.
   *
   * Соседа приходится ставить руками, и это не подгонка: на старте вокруг дома одни
   * НЕЙТРАЛЬНЫЕ миры, а чужой дом стоит далеко за `strikeRange`. Вылеты у бота
   * начинаются тогда, когда война доходит до его порога, — правило проверяется именно
   * в этом состоянии, а не в стартовом.
   */
  function armed(over: { hangar?: Squadron[] } = {}): GameState {
    const s = rich(game2());
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    // КОСМОПОРТ ставится здесь руками: с разделения верфи и порта (YARD-1) дом несёт
    // только верфь, а ангар — это порт. Без него у мира нет вместимости, и приказы
    // челноков ядро отбивает `E_NO_PORT` ещё до того, как их успеет проверить тест.
    home.buildings = [
      ...home.buildings,
      { type: 'spaceport', level: 1, hp: data.buildings.spaceport!.hp },
    ];
    home.hangar = over.hangar ?? [{ id: 'sq:1', units: [{ unit: 'bomber', count: 2 }] }];
    const near = Object.values(s.planets)
      .filter((p) => p.id !== home.id && p.owner === null)
      .sort(
        (a, b) =>
          Math.hypot(a.position.x - home.position.x, a.position.y - home.position.y) -
          Math.hypot(b.position.x - home.position.x, b.position.y - home.position.y),
      )[0]!;
    near.owner = 'p1';
    return s;
  }
  const strikes = (s: GameState): Action[] => only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike');

  it('ЕСТЬ БОМБАРДИРОВЩИК И ЦЕЛЬ В РАДИУСЕ — ВЫЛЕТ УХОДИТ', () => {
    // SHU-4.2: приказ адресует ЭСКАДРУ, а не «юнит и сколько», поэтому проверяется id
    // соединения — и то, что оно и правда бомбардировочное.
    const s = armed();
    const out = strikes(s);
    expect(out.length).toBeGreaterThan(0);
    const p = out[0]!.payload as { squadronId: string; planetId: string };
    const home = Object.values(s.planets).find((w) => w.owner === 'p2')!;
    const squad = (home.hangar ?? []).find((q) => q.id === p.squadronId);
    expect(squad?.units[0]?.unit).toBe('bomber');
  });

  it('ПЕРЕХВАТЧИК В УДАР НЕ ПОСЫЛАЕТСЯ: его работа — встречать чужих, и она без приказа', () => {
    // У перехватчика `attack` 4 против 20 у бомбардировщика (ROS-1.4): послать его
    // бить корпуса — значит измерить не ту роль. Свою он делает сам, подъёмом с базы.
    expect(strikes(armed({ hangar: [{ id: 'sq:1', units: [{ unit: 'interceptor', count: 3 }] }] }))).toEqual([]);
  });

  it('в мирное время вылетов нет — бить некого', () => {
    const s = rich(game2(), false);
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    home.hangar = [{ id: 'sq:1', units: [{ unit: 'bomber', count: 2 }] }];
    expect(only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike')).toEqual([]);
  });

  it('пустой ангар — вылета нет, а не пустой приказ', () => {
    expect(strikes(armed({ hangar: [] }))).toEqual([]);
  });

  it('ИГРОВОЙ (слабый) бот вылетов не поднимает', () => {
    const s = armed();
    expect(only(aiOrders(s, 'p2', 'expand'), 'shuttle.strike')).toEqual([]);
  });

  it('ОДИН ВЫЛЕТ НА ПОРТ ЗА ТИК — топливо порта общее, вторым приказом его не растянуть', () => {
    expect(strikes(armed({ hangar: [{ id: 'sq:1', units: [{ unit: 'bomber', count: 6 }] }] })).length).toBe(1);
  });

  it('ДЕСАНТНЫЙ ВЫЛЕТ ИДЁТ С ТЕМ, ЧТО УЖЕ В ТРЮМЕ — одним приказом удара', () => {
    // SHU-5.2: челнок строится с бойцом внутри, поэтому погрузки перед вылетом нет —
    // бот отдаёт только `shuttle.strike`, и эскадра взлетает со своим десантом.
    const s = armed({
      hangar: [{ id: 'sq:1', units: [{ unit: 'landing_shuttle', count: 2 }], cargo: [{ unit: 'tank', count: 2 }] }],
    });
    const orders = aiOrders(s, 'p2', 'expand', 'strong');
    const out = only(orders, 'shuttle.strike');
    expect(out).toHaveLength(1);
    const p = out[0]!.payload as { squadronId: string; targetPlanetId?: string };
    expect(p.squadronId).toBe('sq:1');
    expect(p.targetPlanetId).toBeTruthy(); // десант летит по МИРУ, а не по кораблю
    // Заявка проходит ЯДРО, а не только выглядит правильной.
    const r = kernel.applyAction(s, out[0]!, ctx(s.time));
    expect(r.ok, r.ok ? '' : r.code).toBe(true);
  });

  it('ПУСТОЙ ДЕСАНТНЫЙ ЧЕЛНОК НЕ ЛЕТИТ: без бойца он долетит и просто погибнет', () => {
    const s = armed({ hangar: [{ id: 'sq:1', units: [{ unit: 'landing_shuttle', count: 2 }] }] });
    expect(only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike')).toEqual([]);
  });

  it('приказ ПРОХОДИТ ЯДРО, а не только выглядит правильным', () => {
    // Главная проверка кирпича: `shuttle.strike` — самый параметрический приказ бота
    // (база, машина, число, цель), и «похоже на правду» здесь ничего не стоит.
    const s = armed();
    const order = strikes(s)[0]!;
    const r = kernel.applyAction(s, order, ctx(s.time));
    expect(r.ok, r.ok ? '' : r.code).toBe(true);
  });
});

describe('AI-BAL-4 — то, что оставлено боту НЕнужным (осознанно, не забыто)', () => {
  it('герой ПОСЕЯН, а не построен: он есть во флоте с первой секунды', () => {
    // Поэтому «0 построек героя» — не мёртвая механика, и правило «строить героя» было бы
    // правилом ради метрики. Отчёт харнеса теперь считает это отдельной строкой.
    const s = game2();
    const heroAboard = Object.values(s.fleets).some(
      (f) => f.owner === 'p2' && f.units.some((st) => st.unit === 'hero' && st.count > 0),
    );
    expect(heroAboard).toBe(true);
    expect(unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'strong'))).not.toContain('hero');
  });

  it('носитель заказывается, сенсорный фрегат — нет', () => {
    // «Носитель» (`shuttle_carrier`) — авианосец и десантный корабль в одном корпусе
    // (решение владельца 2026-09-26). Без его трюма ударная группа везёт горстку и штурм
    // захлёбывается на первом гарнизоне.
    //
    // `frigate` не заказывается осознанно, а не по забывчивости: это глаза, а бот читает
    // состояние целиком и туманом не пользуется. Строить его «чтобы не был мёртвым» —
    // подгонка отчёта.
    const orders = unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'strong'));
    expect(orders).toContain('shuttle_carrier');
    expect(orders).not.toContain('frigate');
  });
});

/**
 * НОСИТЕЛЬ У БОТА (решение владельца 2026-09-15).
 *
 * Замер показал ноль вылетов при живой постройке челноков, и причина не в ядре: бот
 * поднимал удар ТОЛЬКО с домашнего порта, а радиус челнока 120–150 — чужих миров так
 * близко к дому почти не бывает. Война идёт на фронтире, порт стоит дома.
 *
 * Носитель и есть задуманный ответ: «плавучий космопорт» (`shuttle_carrier`, трюм 16)
 * возит эскадры с флотом. Бот учится трём шагам — построить, загрузить, поднять с борта;
 * возит носитель существующая логика флота, своей ему не заводим.
 */
describe('SHU-2.1 — бот и НОСИТЕЛЬ челноков', () => {
  /** Свой носитель, стоящий у мира `at`. */
  const carrierAt = (s: GameState, at: string, hangar: Squadron[] = []): void => {
    s.fleets['p2_carrier'] = {
      id: 'p2_carrier',
      owner: 'p2',
      location: at,
      movement: null,
      units: [{ unit: 'shuttle_carrier', count: 1 }],
      ...(hangar.length ? { hangar } : {}),
    } as GameState['fleets'][string];
  };

  it('на войне с портом бот ЗАКАЗЫВАЕТ носитель', () => {
    const s = withPort(rich(game2()));
    expect(unitsBuilt(aiOrders(s, 'p2', 'expand', 'strong'))).toContain('shuttle_carrier');
  });

  it('носитель строится и в мирное время: его трюм возит ещё и десант (владелец 2026-09-26)', () => {
    const s = rich(game2(), false);
    expect(unitsBuilt(aiOrders(s, 'p2', 'expand', 'strong'))).toContain('shuttle_carrier');
  });

  it('носитель у порта с эскадрой — бот ГРУЗИТ её на борт', () => {
    const s = withPort(rich(game2()));
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    home.hangar = [{ id: 'sq:b', units: [{ unit: 'bomber', count: 2 }] }];
    carrierAt(s, home.id);
    const loads = only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.load');
    expect(loads).toHaveLength(1);
    expect((loads[0]!.payload as { fleetId: string; squadronId: string })).toEqual({
      fleetId: 'p2_carrier',
      squadronId: 'sq:b',
    });
  });

  it('ПУСТОЙ порт грузить нечем — приказа нет', () => {
    const s = withPort(rich(game2()));
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    carrierAt(s, home.id);
    expect(only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.load')).toEqual([]);
  });

  it('С БОРТА НОСИТЕЛЯ УДАР УХОДИТ — ради этого он и заведён', () => {
    const s = rich(game2());
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    // Носитель стоит у ЧУЖОГО мира — там, куда дом не достаёт.
    const far = Object.values(s.planets)
      .filter((p) => p.id !== home.id && p.owner === null)
      .sort(
        (a, b) =>
          Math.hypot(b.position.x - home.position.x, b.position.y - home.position.y) -
          Math.hypot(a.position.x - home.position.x, a.position.y - home.position.y),
      )[0]!;
    far.owner = 'p1';
    carrierAt(s, far.id, [{ id: 'sq:b', units: [{ unit: 'bomber', count: 2 }] }]);
    const out = only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike');
    expect(out).toHaveLength(1);
    const p = out[0]!.payload as { fleetId?: string; planetId?: string };
    expect(p.fleetId).toBe('p2_carrier'); // база вылета — БОРТ, а не дом
    expect(p.planetId).toBeUndefined();
    // И приказ проходит ЯДРО, а не только выглядит правильным.
    expect(kernel.applyAction(s, out[0]!, ctx(s.time)).ok).toBe(true);
  });

  /**
   * Этот тест закреплял ПРЕЖНЕЕ правило («ядро пускает только со стоянки»). Владелец снял
   * его 2026-09-16, поэтому тест переписан под новое, а не удалён: место в наборе то же,
   * утверждение — обратное. Уходящий от цели носитель выбран нарочно — он показывает, что
   * решает РАДИУС от живой позиции, а не направление движения.
   */
  it('ИДУЩИЙ носитель вылет ПОДНИМАЕТ — стоянка больше не нужна', () => {
    const s = rich(game2());
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    const far = Object.values(s.planets).find((p) => p.id !== home.id && p.owner === null)!;
    far.owner = 'p1';
    carrierAt(s, far.id, [{ id: 'sq:b', units: [{ unit: 'bomber', count: 2 }] }]);
    s.fleets.p2_carrier!.location = null;
    s.fleets.p2_carrier!.movement = { from: far.id, to: home.id, departedAt: s.time, arrivesAt: s.time + 1e9 };
    const out = only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike');
    expect(out).toHaveLength(1);
    expect((out[0]!.payload as { fleetId?: string }).fleetId).toBe('p2_carrier');
  });
});

/**
 * БОТ БЬЁТ С ХОДА (решение владельца 2026-09-16).
 *
 * Ядро сняло требование стоянки для вылета с носителя. Бот шёл следом не ради красоты:
 * пока он фильтровал базы по неподвижности, новое правило не участвовало в замерах
 * ВООБЩЕ — носитель едет с кулаком и стоит редко, а значит удар с борта случался бы
 * только в те такты, когда флот замер.
 */
describe('SHU-2.1 — бот поднимает удар с ИДУЩЕГО носителя', () => {
  /** Носитель p2 в пути к чужому миру, с полным ангаром. */
  function underwayCarrier(s: GameState, toId: string, fromId: string): void {
    s.fleets['p2_cv'] = {
      id: 'p2_cv',
      owner: 'p2',
      location: null,
      movement: { from: fromId, to: toId, departedAt: s.time - 3_600_000, arrivesAt: s.time + 60_000 },
      units: [{ unit: 'shuttle_carrier', count: 1 }],
      hangar: [{ id: 'sq:b', units: [{ unit: 'bomber', count: 2 }] }],
    } as GameState['fleets'][string];
  }

  it('идущий носитель у цели — удар уходит С БОРТА и проходит ЯДРО', () => {
    const s = rich(game2());
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    const foe = Object.values(s.planets).find((p) => p.id !== home.id && p.owner === null)!;
    foe.owner = 'p1';
    underwayCarrier(s, foe.id, home.id);
    const out = only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike');
    expect(out).toHaveLength(1);
    expect((out[0]!.payload as { fleetId?: string }).fleetId).toBe('p2_cv');
    expect(kernel.applyAction(s, out[0]!, ctx(s.time)).ok).toBe(true);
  });

  it('носитель В БОЮ вылета по-прежнему не поднимает', () => {
    const s = rich(game2());
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    const foe = Object.values(s.planets).find((p) => p.id !== home.id && p.owner === null)!;
    foe.owner = 'p1';
    underwayCarrier(s, foe.id, home.id);
    s.fleets.p2_cv!.battleId = 'b:1';
    expect(only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike')).toEqual([]);
  });
});

describe('ПРАВИЛА НАЗЕМНОЙ ВОЙНЫ — высадка с носителя (решение владельца 2026-09-16)', () => {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y);

  /**
   * Носитель СТОИТ у нейтрального узла, а цель — ДРУГОЙ мир в радиусе высадки (120).
   *
   * Насест и цель разные НАМЕРЕННО: флот опознаёт только тот узел, на котором стоит
   * (`FLEET_IDENTIFY_HOPS = 0`, «радарless fleet is a blind kitten»), а у корпуса
   * `shuttle_carrier` радара нет вовсе. Прилети носитель НА цель — он видел бы гарнизон
   * сам, и правило №1 проверять было бы не на чем. Пара ищется по карте, а не
   * прописывается id: карта живёт своей жизнью, а предусловие теста проверяется тут же.
   */
  function staged(): {
    s: GameState;
    foe: GameState['planets'][string];
    perch: GameState['planets'][string];
  } {
    const s = rich(game2());
    const seen = identifiedNodes(s, 'p2', data);
    const free = Object.values(s.planets)
      .filter((p) => p.owner === null && !seen.has(p.id))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    let perch: GameState['planets'][string] | undefined;
    let foe: GameState['planets'][string] | undefined;
    for (const a of free) {
      for (const b of free) {
        if (a.id === b.id || b.kind !== 'planet') continue;
        if (dist(a.position, b.position) > 115) continue;
        perch = a;
        foe = b;
        break;
      }
      if (perch) break;
    }
    if (!perch || !foe) throw new Error('на карте не нашлось пары «насест + цель в радиусе»');
    foe.owner = 'p1';
    foe.garrison = [{ unit: 'militia', count: 1 }];
    s.fleets.p2_cv = {
      id: 'p2_cv',
      owner: 'p2',
      location: perch.id,
      movement: null,
      // Четыре корпуса: трюм общий (SHU-5.1). Три десантных челнока несут по танку —
      // так их строит ядро (SHU-5.2).
      units: [{ unit: 'shuttle_carrier', count: 4 }],
      hangar: [
        { id: 'sq:l', units: [{ unit: 'landing_shuttle', count: 3 }], cargo: [{ unit: 'tank', count: 3 }] },
      ],
      traits: [],
      battleId: null,
    } as GameState['fleets'][string];
    // Предусловие теста: цель НЕ опознана — значит правилу №1 есть что запрещать.
    expect(identifiedNodes(s, 'p2', data).has(foe.id)).toBe(false);
    return { s, foe, perch };
  }

  /** Свежие разведданные p2 об этом мире — то, чего требует правило №1. */
  const withIntel = (
    s: GameState,
    id: string,
    garrison: Array<{ unit: string; count: number }>,
  ): void => {
    s.fog = { ...(s.fog ?? {}), p2: { [id]: { owner: 'p1', garrison, buildings: [], at: s.time } } };
  };

  it('ПРАВИЛО №1 — БЕЗ РАЗВЕДДАННЫХ ВЫСАДКИ НЕТ, даже когда всё на борту', () => {
    const { s } = staged();
    expect(only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike')).toEqual([]);
  });

  it('РАЗВЕДДАННЫЕ ЕСТЬ И СИЛ ХВАТАЕТ — высадка уходит и проходит ЯДРО', () => {
    const { s, foe } = staged();
    withIntel(s, foe.id, [{ unit: 'militia', count: 1 }]);
    const orders = aiOrders(s, 'p2', 'expand', 'strong');
    const strike = only(orders, 'shuttle.strike');
    expect(strike).toHaveLength(1);
    // Приказ адресует НОСИТЕЛЬ, а не дом: десант уже в трюме его эскадры (SHU-5.2).
    expect((strike[0]!.payload as { fleetId?: string }).fleetId).toBe('p2_cv');
    expect((strike[0]!.payload as { targetPlanetId?: string }).targetPlanetId).toBe(foe.id);
    const r = kernel.applyAction(s, strike[0]!, ctx(s.time));
    expect(r.ok, r.ok ? '' : r.code).toBe(true);
  });

  it('ПРОТУХШИЕ РАЗВЕДДАННЫЕ знанием не считаются', () => {
    const { s, foe } = staged();
    s.fog = {
      p2: {
        [foe.id]: {
          owner: 'p1',
          garrison: [{ unit: 'militia', count: 1 }],
          buildings: [],
          at: s.time - 48 * 3_600_000,
        },
      },
    };
    expect(only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike')).toEqual([]);
  });

  it('ГАРНИЗОН НЕ ПО ЗУБАМ — высадки нет: челноки целы, десант жив', () => {
    const { s, foe } = staged();
    foe.garrison = [{ unit: 'heavy_infantry', count: 12 }];
    withIntel(s, foe.id, [{ unit: 'heavy_infantry', count: 12 }]);
    expect(only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike')).toEqual([]);
  });

  it('ПРАВИЛО №3 — под ВРАЖЕСКИМ ФЛОТОМ высадка не идёт', () => {
    const { s, foe } = staged();
    withIntel(s, foe.id, [{ unit: 'militia', count: 1 }]);
    s.fleets.p1_guard = {
      id: 'p1_guard',
      owner: 'p1',
      location: foe.id,
      movement: null,
      units: [{ unit: 'cruiser', count: 2 }],
      traits: [],
      battleId: null,
    } as GameState['fleets'][string];
    expect(only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike')).toEqual([]);
  });

  it('ПРАВИЛО №2 — над миром уже стоит СВОЙ флот: берём штурмом, челноки не тратим', () => {
    const { s, foe } = staged();
    withIntel(s, foe.id, [{ unit: 'militia', count: 1 }]);
    s.fleets.p2_orbit = {
      id: 'p2_orbit',
      owner: 'p2',
      location: foe.id,
      movement: null,
      orbit: 'near',
      units: [{ unit: 'cruiser', count: 2 }],
      landing: [{ unit: 'tank', count: 6 }],
      traits: [],
      battleId: null,
    } as GameState['fleets'][string];
    const orders = aiOrders(s, 'p2', 'expand', 'strong');
    expect(only(orders, 'shuttle.strike')).toEqual([]);
    expect(only(orders, 'fleet.assault')).toHaveLength(1);
  });

  it('ТИК НЕ ПРОПАДАЕТ: высадке идти не с чем — поднимается бомбардировщик', () => {
    const { s } = staged();
    // Разведданных нет ⇒ высадки не будет. Раньше на этом приказ терялся ВОВСЕ: машина
    // выбиралась одна на общем ростере, и ею оказывался десантный челнок.
    s.fleets.p2_cv!.hangar = [
      { id: 'sq:l', units: [{ unit: 'landing_shuttle', count: 3 }], cargo: [{ unit: 'tank', count: 3 }] },
      { id: 'sq:b', units: [{ unit: 'bomber', count: 2 }] },
    ];
    const strikes = only(aiOrders(s, 'p2', 'expand', 'strong'), 'shuttle.strike');
    expect(strikes).toHaveLength(1);
    expect((strikes[0]!.payload as { squadronId: string }).squadronId).toBe('sq:b');
  });
});
