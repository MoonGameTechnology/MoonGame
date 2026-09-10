// AI-BAL-4: артиллерия и эскадрильи у ТЕСТ-бота (профиль `test`, AI-BAL-1.1).
//
// Что здесь закрепляется. `siege`, `interceptor`, `strike_carrier`, `frigate`
// и `hero` показывались «мёртвым контентом» — и каждая позиция оказалась мертва по СВОЕЙ
// причине, а не по одной общей:
//   • `siege` — просто не было правила. Артиллерия при этом не требует от бота НИ ОДНОЙ
//     новой команды: `artilleryModule` сам заставляет свободный стоящий флот обстрелять
//     ближайшего врага в радиусе. Построить — и целый пласт боя входит в измерение;
//   • `interceptor` — был НЕПОСТРОИМ вовсе: ангар открывается вторым уровнем завода,
//     а гейт читал только базовый def (починено в `construction.ts`);
//   • `hero` — не мёртв: он ПОСЕЯН во флоте каждого места с первой секунды и воюет, просто
//     не проходит через `unit.built`. Врал отчёт, а не бот (починено в `selfplay.mjs`).
// `strike_carrier` и `frigate` намеренно оставлены боту ненужными — см. хвост файла.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES, kernel, ctx } from './game';
import type { Action, GameState, Squadron } from '../../packages/shared-core/src/index';

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


describe('AI-BAL-4 — артиллерия', () => {
  it('на войне строит `siege` — дальний огонь ведёт само ядро, приказ не нужен', () => {
    expect(unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'strong'))).toContain('siege');
  });

  it('в мирное время артиллерию не строит', () => {
    expect(unitsBuilt(aiOrders(rich(game2(), false), 'p2', 'expand', 'strong'))).not.toContain('siege');
  });

  it('ИГРОВОЙ бот артиллерию не строит даже на войне', () => {
    expect(unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand'))).not.toContain('siege');
  });
});

describe('AI-BAL-4 / SHU-1.1 — челноки строятся в КОСМОПОРТЕ', () => {
  // Раньше воротами челноков был завод второго уровня («ангар»), и бот вёл длинную
  // цепочку завод → апгрейд → крыло. С SHU-1.1 челнок живёт в порту, а порт у бота и
  // так стоит под корабли — цепочка исчезла вместе с воротами.
  it('порт есть — сильный бот заказывает челнок', () => {
    expect(unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'strong'))).toContain('interceptor');
  });

  it('ИГРОВОЙ (слабый) бот челноков не заказывает', () => {
    expect(unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand'))).not.toContain('interceptor');
  });
});

describe('SHU-3.2 — бот СТРОИТ новый ростер челноков и СЧИТАЕТ ангар', () => {
  it('строит бомбардировщик — челнок против КОРПУСОВ (ROS-1.4)', () => {
    expect(unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'strong'))).toContain('bomber');
  });

  it('строит десантный челнок — высадка без флота (ROS-1.5)', () => {
    expect(unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'strong'))).toContain('landing_shuttle');
  });

  it('в мирное время ударные челноки не строит — бить некого', () => {
    const peace = unitsBuilt(aiOrders(rich(game2(), false), 'p2', 'expand', 'strong'));
    expect(peace).not.toContain('bomber');
    expect(peace).not.toContain('landing_shuttle');
  });

  it('ИГРОВОЙ (слабый) бот новых челноков не заказывает', () => {
    const weak = unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand'));
    expect(weak).not.toContain('bomber');
    expect(weak).not.toContain('landing_shuttle');
  });

  it('ПОЛНЫЙ АНГАР ОСТАНАВЛИВАЕТ ЗАКАЗ: челноки живут в порту, а не во флоте', () => {
    // Дефект, который чинит этот кирпич: счётчик `shipsOwned` смотрит во флоты и в
    // гарнизон, а челнок с SHU-1.1 лежит в `planet.hangar` — ни там, ни там. Поэтому
    // предел не срабатывал НИКОГДА, и бот заказывал челноки каждый тик до упора в
    // `E_HANGAR_FULL`, платя за это отказами весь матч.
    const s = rich(game2());
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    // SHU-4.2: ангар — эскадры, по звену на класс машин (так их и ставит постройка).
    home.hangar = [
      { id: 'sq:i', units: [{ unit: 'interceptor', count: 3 }] },
      { id: 'sq:b', units: [{ unit: 'bomber', count: 3 }] },
      { id: 'sq:l', units: [{ unit: 'landing_shuttle', count: 3 }] },
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

  it('ДЕСАНТНЫЙ ВЫЛЕТ ИДЁТ С ГРУЗОМ — без него он долетит и просто погибнет', () => {
    const s = armed({ hangar: [{ id: 'sq:1', units: [{ unit: 'landing_shuttle', count: 2 }] }] });
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    home.garrison = [{ unit: 'militia', count: 8 }]; // сверх домашней стражи есть что везти
    // SHU-4.2: груз кладут в трюм ОТДЕЛЬНЫМ приказом, и он обязан идти ПЕРЕД ударом —
    // иначе эскадра взлетит порожней. Проверяем оба и их порядок.
    const orders = aiOrders(s, 'p2', 'expand', 'strong');
    const out = only(orders, 'shuttle.strike');
    const loads = only(orders, 'shuttle.loadTroops');
    expect(out).toHaveLength(1);
    expect(loads).toHaveLength(1);
    expect(orders.indexOf(loads[0]!)).toBeLessThan(orders.indexOf(out[0]!));
    const p = out[0]!.payload as { squadronId: string; targetPlanetId?: string };
    const lp = loads[0]!.payload as {
      squadronId: string;
      troops: Array<{ unit: string; count: number }>;
    };
    const home2 = Object.values(s.planets).find((w) => w.owner === 'p2')!;
    expect((home2.hangar ?? []).find((q) => q.id === p.squadronId)?.units[0]?.unit).toBe(
      'landing_shuttle',
    );
    expect(p.targetPlanetId).toBeTruthy(); // десант летит по МИРУ, а не по кораблю
    expect(lp.squadronId).toBe(p.squadronId);
    expect(lp.troops.reduce((n, t) => n + t.count, 0)).toBeGreaterThan(0);
    // Обе заявки проходят ЯДРО, а не только выглядят правильными.
    const loaded = kernel.applyAction(s, loads[0]!, ctx(s.time));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(kernel.applyAction(loaded.state, out[0]!, ctx(s.time)).ok).toBe(true);
  });

  it('ДОМ ПУСТЫМ НЕ ОСТАВЛЯЕТ: везти нечего — вылета нет вовсе', () => {
    // Тот же порог домашней стражи, что и у погрузки на корабль: гарнизон из трёх
    // бойцов целиком уходит в оборону дома, и десантному челноку грузить нечего.
    const s = armed({ hangar: [{ id: 'sq:1', units: [{ unit: 'landing_shuttle', count: 2 }] }] });
    const home = Object.values(s.planets).find((p) => p.owner === 'p2')!;
    home.garrison = [{ unit: 'militia', count: 3 }];
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

  it('десантный корабль заказывается, «Шаттл» и сенсорный фрегат — нет', () => {
    // `strike_carrier` — ДЕСАНТНЫЙ корабль (заказ владельца 2026-09-09): он забрал роль
    // снятого `dropship`, и правило бота переехало на него вместе с ролью. Без трюма
    // ударная группа везёт горстку и штурм захлёбывается на первом гарнизоне.
    //
    // Не заказываются осознанно, а не по забывчивости: `shuttle_carrier` — носитель
    // челноков, а челноков бот не строит и не запускает вовсе (это SHU-3.2);
    // `frigate` — глаза, а бот читает состояние целиком и туманом не пользуется.
    // Оба ждут своей механики: строить их «чтобы не были мёртвыми» — подгонка отчёта.
    const orders = unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'strong'));
    expect(orders).toContain('strike_carrier');
    expect(orders).not.toContain('shuttle_carrier');
    expect(orders).not.toContain('frigate');
  });
});
