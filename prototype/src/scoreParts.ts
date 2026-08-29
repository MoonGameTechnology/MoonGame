/**
 * Из чего складывается счёт игрока (BAL-5 — исследовательская часть кирпича).
 *
 * Кирпич спрашивает, что даёт лидеру ускорение: территория, постройки или флот. **Один
 * из трёх ответов даёт сам код, до всякого прогона: флот в счёт не входит вовсе.**
 * `computeScores` (`modules/victory.ts`) считает флоты и юниты в отдельные счётчики
 * (`fleets`/`units`) и НИКОГДА не прибавляет их к `total` — «military never scores»
 * (GDD §8.1). Значит вопрос сводится к двум слагаемым, и мерить надо их.
 *
 * 1. **Разложение обязано СХОДИТЬСЯ со счётом ядра.** Иначе это вторая формула счёта, и
 *    она разъедется с первой — ровно то, чем этот проект уже наелся (блок CONV). Сходимость
 *    держит тест: сумма частей на живом матче равна `state.match.scores[seat].total`.
 * 2. **База провинции берётся у ядра** (`provinceScore`), а не переписывается: тип сектора
 *    и его `scoreValue` — данные, и знать их формулу здесь незачем.
 * 3. **`victory.score` — шов расширения.** Пока в него никто не пишет, сумма частей равна
 *    `total` точно. Появится вкладчик (техи/фракции/улучшения по GDD §8.1) — тест из
 *    правила 1 покраснеет, и это правильный сигнал: разложение станет неполным и его
 *    придётся дополнить третьим слагаемым, а не подгонять.
 */

import {
  provinceScore,
  type GameData,
  type GameState,
  type PlayerId,
} from '../../packages/shared-core/src/index';

/** Слагаемые счёта одного места. */
export interface ScoreParts {
  /** Σ базовой ценности провинций во владении (тип сектора, данные). */
  territory: number;
  /** Σ `scoreValue × level` построек на них — вложенное, и потому теряемое. */
  buildings: number;
  /** Сколько провинций держит (не очки — счётчик). */
  planets: number;
  /** Флоты и юниты — СЧЁТЧИКИ, в `total` не входят (см. шапку). */
  fleets: number;
  units: number;
  /** `territory + buildings` — то же число, что `match.scores[seat].total` (правило 1). */
  total: number;
}

const empty = (): ScoreParts => ({
  territory: 0,
  buildings: 0,
  planets: 0,
  fleets: 0,
  units: 0,
  total: 0,
});

/** Разложить счёт каждого места на слагаемые (правила 1–2). */
export function scoreParts(state: GameState, data: GameData): Record<PlayerId, ScoreParts> {
  const out: Record<PlayerId, ScoreParts> = {};
  for (const playerId of Object.keys(state.players)) out[playerId] = empty();

  for (const planet of Object.values(state.planets)) {
    if (planet.owner === null) continue;
    const parts = out[planet.owner];
    if (!parts) continue;
    parts.planets += 1;
    parts.territory += provinceScore(data, planet);
    for (const building of planet.buildings) {
      const def = data.buildings[building.type];
      if (def) parts.buildings += def.scoreValue * building.level;
    }
    for (const stack of planet.garrison) parts.units += stack.count;
  }

  for (const fleet of Object.values(state.fleets)) {
    const parts = out[fleet.owner];
    if (!parts) continue;
    parts.fleets += 1;
    for (const stack of fleet.units) parts.units += stack.count;
    for (const stack of fleet.landing ?? []) parts.units += stack.count;
  }

  for (const parts of Object.values(out)) parts.total = parts.territory + parts.buildings;
  return out;
}
