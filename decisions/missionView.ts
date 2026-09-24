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
 *    (память тумана, а не правда состояния: метка не выдаёт разведку, которой не было);
 *    `rescue` и `beacon` — свою провинцию; `build` с `at` — названные места без нужной
 *    постройки; `evac` — свои убежища. У `scout`, `wave` и `build` без места одной
 *    точки нет — меток нет.
 * 3. **Выполненная и проваленная задача меток не держит**: на карту зовёт только то, что
 *    ещё можно сделать.
 */
import { HAVEN_TRAIT, type GameState, type PlayerId } from '../packages/shared-core/src/index';
import {
  DEFAULT_OBJECTIVE_SLOTS,
  objectiveNominal,
  objectiveProgress,
  type MissionObjective,
  type ObjectiveKind,
} from './missionObjectives';
import { WARRANTS_PER_REWARD } from './sectorZeroProgress';
import { runClockText } from './runClock';

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
  /** Провалена в этом забеге (`rescue`: гарнизон пал) — сделать уже нельзя. */
  failed: boolean;
  /** `beacon`: лучшая серия удержания и срок, мс. */
  holdMs?: number;
  needMs?: number;
}

/**
 * Что подставить в `{n}` подписи задачи: у маяка — срок удержания РЕАЛЬНЫМ временем
 * забега («4:48»), как все его таймеры (PVR-6.13), у остальных — сколько нужно.
 */
export function missionLabelN(p: { total: number; needMs?: number }): number | string {
  return p.needMs !== undefined ? runClockText(p.needMs) : p.total;
}

/** Миры, которые стоит пометить для задачи (правила 2–3). */
export function missionTargets(
  objective: MissionObjective,
  state: GameState,
  player: PlayerId,
): string[] {
  const progress = objectiveProgress(objective, state, player);
  if (progress.complete || progress.failed) return [];
  if (objective.kind === 'control')
    return (objective.targets ?? []).filter(
      (id) => state.planets[id] !== undefined && state.planets[id]!.owner !== player,
    );
  // Спасение и маяк называют провинцию — метка стоит, пока задача не решена.
  if (objective.kind === 'rescue' || objective.kind === 'beacon')
    return (objective.targets ?? []).filter((id) => state.planets[id] !== undefined);
  // Крепость в провинции: названные места, где нужной постройки ещё нет.
  if (objective.kind === 'build' && objective.at && objective.at.length > 0) {
    const kinds = new Set(objective.targets ?? []);
    return objective.at.filter((id) => {
      const p = state.planets[id];
      return !!p && !(p.owner === player && p.buildings.some((b) => kinds.has(b.type) && b.hp > 0));
    });
  }
  // Эвакуация: куда вести — свои убежища.
  if (objective.kind === 'evac')
    return Object.values(state.planets)
      .filter((p) => p.owner === player && p.traits.includes(HAVEN_TRAIT))
      .map((p) => p.id)
      .sort();
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
      failed: p.failed ?? false,
      ...(p.holdMs !== undefined ? { holdMs: p.holdMs, needMs: p.needMs } : {}),
    };
  });
}

/** Строка карточки главы в меню: что будет задачей следующего забега и сколько за неё
 *  придёт. Состояния забега ещё нет — только объявление и номинал. */
export interface MissionBrief {
  id: string;
  /** `beacon`: срок удержания, мс — для подписи временем забега (`missionLabelN`). */
  needMs?: number;
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
    ...(o.kind === 'beacon' ? { needMs: (o.count ?? 1) * 3_600_000 } : {}),
    n: o.count ?? (o.targets ?? []).length,
    reward: missionReward(objectiveNominal(o.reward, shown.length, base)),
  }));
}
