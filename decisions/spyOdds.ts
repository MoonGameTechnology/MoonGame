/**
 * Шанс на кнопке операции (SPY-19): с какой вероятностью операция удастся и с какой
 * агента раскроют. Само правило — в ядре (`espionageModule`); здесь расчёт ТОЛЬКО из
 * того, что игрок знает.
 *
 * 1. **База ядра.** Успех 0.6, раскрытие 0.25 после успеха и 0.5 после провала — те же
 *    числа, что у ядра (`SPY_BASE_CHANCE`, `SPY_DETECT_SUCCESS`, `SPY_DETECT_FAILED`).
 * 2. **Риск — средний по исходу.** `успех × раскрытие после успеха + провал × раскрытие
 *    после провала`: на базе 0.6 × 0.25 + 0.4 × 0.5 = 35%.
 * 3. **Своя волна учтена** (SPY-17): каждый свой агент уже в пути на этот мир даёт +0.1 к
 *    успеху и к раскрытию.
 * 4. **Бюро цели — только известное.** Сильнейшее бюро среди построек миров владельца,
 *    которые игрок видит сейчас или помнит. Невидимый пост чужого контрразведчика и
 *    модификаторы хуков в расчёт не входят, подпись это говорит.
 * 5. **Границы ядра.** Успех зажат в [0.05, 0.95], раскрытие — в [0, 1].
 * 6. **Шанс есть только у операции с броском.** Переход и пост контрразведки ядро
 *    не разыгрывает: строки шанса у них нет.
 * 7. **Волна — только агрессивные агенты** (как `crew` ядра): шпион, который летит туда
 *    просто переехать или встать на пост, успеха не прибавляет.
 * 8. **Развитость мира — для кражи и исследования** (SPY-21): до +0.2 к успеху, доля
 *    развитости цели от самого развитого ИЗВЕСТНОГО мира того же владельца. Постройки цели
 *    неизвестны или у владельца не видно ни одной постройки — бонуса нет: строка не обещает
 *    того, чего игрок не видит.
 */
import { aggressive } from '../packages/shared-core/src/util/spyLife';
import {
  buildingDevelopment,
  buildingLevel,
  MAX_AGENTS_PER_WORLD,
  SPY_BASE_CHANCE,
  SPY_CHANCE_MAX,
  SPY_CHANCE_MIN,
  SPY_CREW_BONUS,
  SPY_DETECT_FAILED,
  SPY_DETECT_SUCCESS,
  SPY_DEVELOPMENT_BONUS,
  type GameData,
  type SpyOp,
} from '../packages/shared-core/src/index';

export interface SpyOdds {
  /** Доля 0..1. */
  success: number;
  /** Доля 0..1. */
  risk: number;
}

/** Правила 1–3, 5 и 8. `crew` — сколько агентов пойдёт волной вместе с этим (1–3),
 *  `bureau` — известный бонус бюро цели к раскрытию, `development` — доля развитости цели
 *  (0..1, только для кражи и исследования). Развитость двигает успех, но не раскрытие. */
export function spyOdds(crew: number, bureau: number, development = 0): SpyOdds {
  const bonus = SPY_CREW_BONUS * (Math.min(MAX_AGENTS_PER_WORLD, Math.max(1, crew)) - 1);
  const base = SPY_BASE_CHANCE + bonus + SPY_DEVELOPMENT_BONUS * development;
  const success = Math.min(SPY_CHANCE_MAX, Math.max(SPY_CHANCE_MIN, base));
  const detect = (base: number) => Math.min(1, Math.max(0, base + bureau + bonus));
  return { success, risk: success * detect(SPY_DETECT_SUCCESS) + (1 - success) * detect(SPY_DETECT_FAILED) };
}

/** Правило 4: сильнейший `spyDetectBonus` среди известных игроку построек владельца. */
export function knownBureau(
  buildings: readonly { type: string; level: number }[],
  data: Pick<GameData, 'buildings'>,
): number {
  let best = 0;
  for (const b of buildings) {
    const def = data.buildings[b.type];
    if (def) best = Math.max(best, buildingLevel(def, b.level).spyDetectBonus);
  }
  return best;
}

/** Правило 6: есть ли у задания бросок, а значит и строка шанса. */
export function hasOdds(task: SpyOp | 'relocate'): boolean {
  return aggressive(task);
}

/** Правило 7: идёт ли агент с этой операцией в волну. */
export const joinsWave = (op: SpyOp | 'relocate' | undefined): boolean => aggressive(op);

/** Правило 8: сколько развитости цели засчитать операции `task`. `target` — известные
 *  постройки цели (`null` — неизвестны), `owned` — постройки известных миров её владельца
 *  (цель среди них может быть, а может и не быть). */
export function knownDevelopment(
  task: SpyOp | 'relocate',
  target: readonly { type: string; level: number }[] | null,
  owned: readonly (readonly { type: string; level: number }[])[],
  data: GameData,
): number {
  if (!target || (task !== 'theft' && task !== 'research')) return 0;
  const of = (bs: readonly { type: string; level: number }[]): number => {
    let total = 0;
    for (const b of bs) {
      const def = data.buildings[b.type];
      if (def) total += buildingDevelopment(def, b.level);
    }
    return total;
  };
  const mine = of(target);
  let best = mine;
  for (const b of owned) best = Math.max(best, of(b));
  return best > 0 ? mine / best : 0;
}

/** Проценты для подписи: целые. */
export const oddsPct = (x: number): number => Math.round(x * 100);
