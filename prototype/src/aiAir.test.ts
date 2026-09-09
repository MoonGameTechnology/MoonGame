// AI-BAL-4: артиллерия и эскадрильи у ТЕСТ-бота (профиль `test`, AI-BAL-1.1).
//
// Что здесь закрепляется. `siege`, `interceptor`, `strike_carrier`, `sensor_frigate`
// и `hero` показывались «мёртвым контентом» — и каждая позиция оказалась мертва по СВОЕЙ
// причине, а не по одной общей:
//   • `siege` — просто не было правила. Артиллерия при этом не требует от бота НИ ОДНОЙ
//     новой команды: `artilleryModule` сам заставляет свободный стоящий флот обстрелять
//     ближайшего врага в радиусе. Построить — и целый пласт боя входит в измерение;
//   • `interceptor` — был НЕПОСТРОИМ вовсе: ангар открывается вторым уровнем завода,
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
    // `sensor_frigate` — глаза, а бот читает состояние целиком и туманом не пользуется.
    // Оба ждут своей механики: строить их «чтобы не были мёртвыми» — подгонка отчёта.
    const orders = unitsBuilt(aiOrders(rich(game2()), 'p2', 'expand', 'strong'));
    expect(orders).toContain('strike_carrier');
    expect(orders).not.toContain('shuttle_carrier');
    expect(orders).not.toContain('sensor_frigate');
  });
});
