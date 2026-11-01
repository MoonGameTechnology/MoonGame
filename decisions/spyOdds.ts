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
 */
import {
  buildingLevel,
  MAX_AGENTS_PER_WORLD,
  SPY_BASE_CHANCE,
  SPY_CHANCE_MAX,
  SPY_CHANCE_MIN,
  SPY_CREW_BONUS,
  SPY_DETECT_FAILED,
  SPY_DETECT_SUCCESS,
  type GameData,
} from '../packages/shared-core/src/index';

export interface SpyOdds {
  /** Доля 0..1. */
  success: number;
  /** Доля 0..1. */
  risk: number;
}

/** Правила 1–3 и 5. `crew` — сколько агентов пойдёт волной вместе с этим (1–3),
 *  `bureau` — известный бонус бюро цели к раскрытию. */
export function spyOdds(crew: number, bureau: number): SpyOdds {
  const bonus = SPY_CREW_BONUS * (Math.min(MAX_AGENTS_PER_WORLD, Math.max(1, crew)) - 1);
  const success = Math.min(SPY_CHANCE_MAX, Math.max(SPY_CHANCE_MIN, SPY_BASE_CHANCE + bonus));
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

/** Проценты для подписи: целые. */
export const oddsPct = (x: number): number => Math.round(x * 100);
