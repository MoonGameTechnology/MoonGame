/**
 * Как задачи забега ПОКАЗАТЬ (заказ владельца 2026-09-24: «как на карте эти миссии
 * отображаются и где в забеге их посмотреть», «ещё должно показать награду»).
 *
 * Прогресс и выплату считает `missionObjectives.ts`; здесь — только то, что нужно
 * глазам: строка панели с наградой в обеих валютах и миры, которые стоит пометить на
 * карте. Решение одно на панель, метки и карточку главы в меню, поэтому «что обещали»
 * и «куда вести» не разойдутся.
 *
 * Правила:
 *
 * 1. **Награда — в валютах, а не в «очках».** Единица награды задачи платит данными ◇ и
 *    Варрантами ⌖ по тому же курсу, что выплата за забег (`WARRANTS_PER_REWARD`), и
 *    показывается по номиналу с учётом числа видимых задач (`objectiveNominal`) — ровно
 *    то, что придёт на итогах.
 * 2. **Метка — только там, куда игроку идти.** `control` метит названные миры, которые
 *    ещё не взяты; `raze` — миры, где игрок ПОМНИТ стоящую постройку названного вида
 *    (память тумана, а не правда состояния: метка не выдаёт разведку, которой не было).
 *    У `build`, `scout` и `wave` одной точки нет — меток нет.
 * 3. **Выполненная задача меток не держит**: сделанное не зовёт на карту.
 */
import type { GameState, PlayerId } from '../packages/shared-core/src/index';
import {
  DEFAULT_OBJECTIVE_SLOTS,
  objectiveNominal,
  objectiveProgress,
  type MissionObjective,
  type ObjectiveKind,
} from './missionObjectives';
import { WARRANTS_PER_REWARD } from './sectorZeroProgress';

/** Награда задачи в валютах профиля. */
export interface MissionReward {
  research: number;
  warrants: number;
}

/** Номинал задачи в валютах: столько придёт на итогах, если её выполнить. */
export function missionReward(nominal: number): MissionReward {
  const n = Math.max(0, Math.trunc(nominal) || 0);
  return { research: n, warrants: n * WARRANTS_PER_REWARD };
}

/** Строка панели задач. */
export interface MissionRow {
  id: string;
  kind: ObjectiveKind;
  done: number;
  total: number;
  complete: boolean;
  reward: MissionReward;
  /** Миры для меток и для «показать на карте», в порядке объявления. */
  targets: string[];
}

/** Миры, которые стоит пометить для задачи (правила 2–3). */
export function missionTargets(
  objective: MissionObjective,
  state: GameState,
  player: PlayerId,
): string[] {
  if (objectiveProgress(objective, state, player).complete) return [];
  if (objective.kind === 'control')
    return (objective.targets ?? []).filter(
      (id) => state.planets[id] !== undefined && state.planets[id]!.owner !== player,
    );
  if (objective.kind === 'raze') {
    const kinds = new Set(objective.targets ?? []);
    const memory = state.fog?.[player] ?? {};
    return Object.keys(memory)
      .filter((id) => {
        const seen = memory[id]!;
        if (seen.owner === player || state.planets[id]?.owner === player) return false;
        return seen.buildings.some((b) => kinds.has(b.type) && b.hp > 0);
      })
      .sort();
  }
  return [];
}

/** Строки панели для задач, видимых в этом забеге. */
export function missionRows(
  shown: readonly MissionObjective[],
  state: GameState,
  player: PlayerId,
  base = DEFAULT_OBJECTIVE_SLOTS.base,
): MissionRow[] {
  return shown.map((o) => {
    const p = objectiveProgress(o, state, player);
    return {
      id: p.id,
      kind: p.kind,
      done: p.done,
      total: p.total,
      complete: p.complete,
      reward: missionReward(objectiveNominal(o.reward, shown.length, base)),
      targets: missionTargets(o, state, player),
    };
  });
}

/** Строка карточки главы в меню: что будет задачей следующего забега и сколько за неё
 *  придёт. Состояния забега ещё нет — только объявление и номинал. */
export interface MissionBrief {
  id: string;
  /** Подстановка `{n}` в подпись задачи: сколько нужно (провинций, волн, фортов, миров). */
  n: number;
  reward: MissionReward;
}

export function missionBriefs(
  shown: readonly MissionObjective[],
  base = DEFAULT_OBJECTIVE_SLOTS.base,
): MissionBrief[] {
  return shown.map((o) => ({
    id: o.id,
    n: o.count ?? (o.targets ?? []).length,
    reward: missionReward(objectiveNominal(o.reward, shown.length, base)),
  }));
}
