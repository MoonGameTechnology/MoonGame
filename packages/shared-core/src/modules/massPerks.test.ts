import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { createInitialState, type GameState } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';
import { hookedDamage } from '../util/combat';
import { technologyModule } from './technology';
import { factionModule } from './faction';
import { heroEffectsModule } from './heroEffects';

/**
 * PERK-1.2 — МАССОВЫЕ ПЕРКИ ЖИВУТ В ПАРАЛЛЕЛЬНОЙ КОРЗИНЕ.
 *
 * ⚠️ Этот файл заведён потому, что переезд трёх подписчиков из `combat.damage` в
 * `combat.damage.parallel` НЕ УРОНИЛ НИ ОДНОГО теста. Композицию массовых перков между
 * собой не сторожил никто: `damageGroups.test.ts` проверяет сам МЕХАНИЗМ на выдуманных
 * подписчиках, а настоящие каталоги — техи, фракция, аура — не проверял никто вообще.
 * То есть вернуть их в последовательную группу можно было бы молча, и снежный ком
 * поехал бы обратно без единого красного теста.
 *
 * Здесь проверяется ПРАВИЛО на НАСТОЯЩИХ модулях: у игрока с двумя техами и фракцией
 * проценты складываются, а не перемножаются.
 */

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  buildings: {},
  events: {},
  // Числа круглые и НЕ равны шипнутым: тест про правило сложения, а не про баланс.
  technologies: {
    guns: { name: 'Guns', cost: { metal: 1 }, effects: { combatDamageBonus: 0.5 } },
    ammo: { name: 'Ammo', cost: { metal: 1 }, effects: { combatDamageBonus: 0.5 } },
  },
  factions: {
    hot: { name: 'Hot', passives: { combatDamageBonus: 0.5 } },
    cold: { name: 'Cold', passives: {} },
  },
});

const ctx = (): Context => ({ now: 0, data });

/** Прогоняет 100 урона через ВЕСЬ конвейер на настоящих модулях каталога.
 *  `aura` — живая аура героя той же величины: третий переехавший подписчик. */
function fire(faction: string, techs: string[], aura = false): number {
  const probe: GameModule = {
    id: 'mass-probe',
    version: '1.0.0',
    setup(api) {
      api.onAction('fire', (_a, h) => {
        h.emit('probe.dealt', {
          dealt: hookedDamage(h, 100, {
            phase: 'orbital',
            location: 'A',
            attacker: 'p1',
            defender: 'p2',
            // `attackerFleet` нужен ауре: семья героев усиливает ФЛОТЫ (CORE-DMG-3).
            attackerFleet: 'f1',
          }),
        });
      });
    },
  };
  const kernel = createKernel([probe, technologyModule, factionModule, heroEffectsModule]);
  const state: GameState = createInitialState({
    seed: 'mass',
    version: { data: '0.1.0', manifest: '1' },
  });
  state.players.p1 = {
    id: 'p1',
    name: 'p1',
    faction,
    status: 'active',
    resources: {},
    technologies: { completed: techs },
  };
  state.planets.A = {
    id: 'A',
    owner: 'p1',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
  if (aura) {
    state.heroes = {
      h1: {
        id: 'h1',
        owner: 'p1',
        location: 'A',
        cooldowns: {},
        alive: true,
        activeAuras: [{ bonus: 0.5, radius: 1000, until: 1_000_000 }],
      },
    };
  }
  const action: Action = { id: 's:p1:1', type: 'fire', playerId: 'p1', payload: {}, issuedAt: 0 };
  const r = kernel.applyAction(state, action, ctx());
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return (r.events.find((e) => e.type === 'probe.dealt')?.payload as { dealt: number }).dealt;
}

describe('массовые перки складываются, а не перемножаются (PERK-1.2)', () => {
  it('без перков — база', () => {
    expect(fire('cold', [])).toBe(100);
  });

  /** ⚠️ ВНУТРИ ОДНОГО МОДУЛЯ корзину проверить НЕЛЬЗЯ, и это не лень, а свойство кода:
   *  `effectsSum` складывает техи между собой ДО хука, поэтому два теха по +50% дают
   *  ×2.0 в любой группе. Первая версия этого файла именно так и проверяла — порча
   *  (вернуть техи в последовательную) её не уронила. Различает только пара из РАЗНЫХ
   *  модулей: у них два отдельных вклада в конвейер, и вот они либо складываются, либо
   *  перемножаются. */
  it('тех и ФРАКЦИЯ — в одной корзине: ×2.0, а не ×2.25', () => {
    expect(fire('hot', ['guns'])).toBeCloseTo(200, 9);
  });

  it('два теха и фракция — ×2.5, а не ×3.375', () => {
    expect(fire('hot', ['guns', 'ammo'])).toBeCloseTo(250, 9);
  });

  it('АУРА героя — в той же корзине: фракция + аура дают ×2.0, а не ×2.25', () => {
    // Третий переехавший подписчик. Без пары его тоже не проверить: одна аура даёт
    // ×1.5 в любой группе — различает только соседство с чужим массовым перком.
    expect(fire('cold', [], true)).toBeCloseTo(150, 9);
    expect(fire('hot', [], true)).toBeCloseTo(200, 9);
  });

  it('все трое разом — ×3.0, а не ×5.06', () => {
    // Тех + фракция + аура, по +50% каждый. Перемножались бы — 1.5³ = 337.5… а с двумя
    // техами и вовсе 506. Это и есть та разница, ради которой перк-группы заведены.
    expect(fire('hot', ['guns', 'ammo'], true)).toBeCloseTo(300, 9);
  });

  it('следующий массовый перк обесценивает сам себя — в этом смысл переезда', () => {
    // Считаем ПО РАЗНЫМ модулям, иначе разницы между группами не увидеть (см. выше).
    const facOnly = fire('hot', []);
    const facPlusTech = fire('hot', ['guns']);
    // Фракция одна дала +50%. Тех поверх неё добавил только +33% — а перемножались бы,
    // добавил бы ровно те же +50%. Догоняющий теряет копейки, лидер со стопкой перков
    // теряет много: это и есть лечение снежного кома.
    expect((facOnly - 100) / 100).toBeCloseTo(0.5, 9);
    expect((facPlusTech - facOnly) / facOnly).toBeCloseTo(1 / 3, 9);
  });
});
