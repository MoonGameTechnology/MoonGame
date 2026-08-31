// AI-BAL-4: артиллерия и эскадрильи у ТЕСТ-бота (профиль `test`, AI-BAL-1.1).
//
// Что здесь закрепляется. `siege`, `fighter_squadron`, `strike_carrier`, `sensor_frigate`
// и `hero` показывались «мёртвым контентом» — и каждая позиция оказалась мертва по СВОЕЙ
// причине, а не по одной общей:
//   • `siege` — просто не было правила. Артиллерия при этом не требует от бота НИ ОДНОЙ
//     новой команды: `artilleryModule` сам заставляет свободный стоящий флот обстрелять
//     ближайшего врага в радиусе. Построить — и целый пласт боя входит в измерение;
//   • `fighter_squadron` — был НЕПОСТРОИМ вовсе: ангар открывается вторым уровнем завода,
//     а гейт читал только базовый def (починено в `construction.ts`);
//   • `hero` — не мёртв: он ПОСЕЯН во флоте каждого места с первой секунды и воюет, просто
//     не проходит через `unit.built`. Врал отчёт, а не бот (починено в `selfplay.mjs`).
// `strike_carrier` и `sensor_frigate` намеренно оставлены боту ненужными — см. хвост файла.
import { describe, expect, it } from 'vitest';
import { newGame, aiOrders, START_CANDIDATES } from './game';
import type { Action, GameState } from '../../packages/shared-core/src/index';

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
const buildingsBuilt = (actions: Action[]): string[] =>
  only(actions, 'building.construct').map((a) => (a.payload as { building: string }).building);
const upgraded = (actions: Action[]): string[] =>
  only(actions, 'building.upgrade').map((a) => (a.payload as { building: string }).building);

const homeOf = (s: GameState, seat: string): string =>
  Object.values(s.planets).find(
    (p) => p.owner === seat && p.buildings.some((b) => b.type === 'spaceport'),
  )!.id;

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

/** Кладёт на домашний мир завод нужного уровня. */
function withFactory(s: GameState, level: number): GameState {
  const home = homeOf(s, 'p2');
  return {
    ...s,
    planets: {
      ...s.planets,
      [home]: {
        ...s.planets[home]!,
        buildings: [...s.planets[home]!.buildings, { type: 'factory', level, hp: 25 }],
      },
    },
  };
}

describe('AI-BAL-4 — артиллерия', () => {
  it('на войне строит `siege` — дальний огонь ведёт само ядро, приказ не нужен', () => {
    expect(unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'test'))).toContain('siege');
  });

  it('в мирное время артиллерию не строит', () => {
    expect(unitsBuilt(aiOrders(rich(game2(), false), 'p2', 'expand', 'test'))).not.toContain('siege');
  });

  it('ИГРОВОЙ бот артиллерию не строит даже на войне', () => {
    expect(unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand'))).not.toContain('siege');
  });
});

describe('AI-BAL-4 — эскадрильи: завод → апгрейд → крыло', () => {
  it('без завода — ставит завод', () => {
    expect(buildingsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'test'))).toContain('factory');
  });

  it('завод первого уровня — АПГРЕЙДИТ его (ангар открывается вторым)', () => {
    const orders = aiOrders(withFactory(rich(game2()), 1), 'p2', 'expand', 'test');
    expect(upgraded(orders)).toContain('factory');
    expect(unitsBuilt(orders)).not.toContain('fighter_squadron'); // рано: ангара ещё нет
  });

  it('завод второго уровня — строит крыло', () => {
    expect(
      unitsBuilt(aiOrders(withFactory(rich(game2()), 2), 'p2', 'expand', 'test')),
    ).toContain('fighter_squadron');
  });

  it('ИГРОВОЙ бот ни завода, ни крыльев не заказывает', () => {
    const orders = aiOrders(withFactory(rich(game2()), 2), 'p2', 'expand');
    expect(buildingsBuilt(orders)).not.toContain('factory');
    expect(unitsBuilt(orders)).not.toContain('fighter_squadron');
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
    expect(unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'test'))).not.toContain('hero');
  });

  it('носитель и сенсорный фрегат не заказываются', () => {
    // `strike_carrier` — носитель без работающего вылета: `squadron.strike` требует
    // `fleet.homeBase`, а это поле в игре не выставляет ни один модуль, так что носитель
    // сейчас лишь дорогой транспорт, дублирующий `dropship`. `sensor_frigate` — глаза, а
    // бот читает состояние целиком и туманом не пользуется. Оба ждут своей механики, а не
    // правила бота: строить их «чтобы не были мёртвыми» — подгонка отчёта.
    const orders = unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'test'));
    expect(orders).not.toContain('strike_carrier');
    expect(orders).not.toContain('sensor_frigate');
  });
});
