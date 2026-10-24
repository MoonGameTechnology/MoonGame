/**
 * СЦЕНАРИЙ УЧЕБНОГО ПОЛИГОНА (TRN-3, `docs/sector-zero-map-concepts.md` §14.2, §14.9):
 * когда противник вводит силы, когда идёт контратака и чем кончается операция.
 * Решения владельца 2026-10-23.
 *
 * Правила:
 *
 * 1. **Силы вводятся по этапам.** До этапа «Бой» карта спокойна: патруль появляется на
 *    открытом участке, когда игрок дошёл до боя, охрана цели — когда дошёл до отхода: урок
 *    отступления и идёт против неё. Ранний бой не мешает учить экономику, а этап «Бой» не
 *    засчитывается, пока патруля не было.
 * 2. **Контратака объявляется заранее и выходит, как только на посту встала ПКО.** В начале
 *    «Закрепления» объявлены три фрегата; когда на передовом посту игрока достроено
 *    Орбитальное ПКО, они выходят с открытого участка на пост (цель на этом этапе ещё у
 *    противника). Решение владельца 2026-10-24: десять минут ожидания после постройки были
 *    долгими. ПКО так и не встала (этап пропущен) — выходят по отсчёту {@link RAID_DELAY_MS}
 *    (десять минут на часах забега), иначе операция не смогла бы кончиться.
 * 3. **Пока игрок читает, отсчёт стоит.** Отсчёт идёт по игровому времени, а его держит
 *    тур (пока игрок ищет нужную кнопку, часы стоят — TRN-7) и пауза: что не двигает мир,
 *    не двигает и контратаку.
 * 4. **Победа — контратака разбита, а цель у игрока.** Взятие миров само по себе операцию
 *    не кончает: режим полигона сценарный (`victory.scripted`), ядро исход не решает.
 *    Без единого мира игрок операцию проиграл.
 *
 * Чистые функции состояния: ни DOM, ни часов. Проводка — `prototype/src/trainingScenario.ts`.
 */
import type { Fleet, GameState, MatchEndReason, PlayerId } from '../packages/shared-core/src/index';
import { RUN_SPEED_NORMAL } from './runTempo';
import { TRAINING_STAGES, type TrainingStage } from './trainingStages';

/** Учебный противник — место карты `training-1`. */
export const TRAINING_ENEMY: PlayerId = 'p2';
/** Мир, удержание которого и есть цель операции. */
export const TRAINING_TARGET = 'target';

/** Соединение противника, которое сценарий вводит в мир. */
export interface ScenarioForce {
  id: string;
  /** Этап, с началом которого соединение появляется. */
  stage: TrainingStage;
  /** Где появляется. */
  at: string;
  units: ReadonlyArray<{ unit: string; count: number }>;
}

/** Силы по этапам (правило 1). Id прежние — подсказки этапов ищут их по имени. */
export const STAGED_FORCES: readonly ScenarioForce[] = [
  { id: 'p2_patrol', stage: 'battle', at: 'open_reach', units: [{ unit: 'frigate', count: 1 }] },
  { id: 'p2_guard', stage: 'retreat', at: 'target', units: [{ unit: 'frigate', count: 4 }] },
];

/** Контратака (правило 2). */
export const RAID: ScenarioForce & { to: string } = {
  id: 'p2_raid',
  stage: 'fortify',
  at: 'open_reach',
  to: 'outpost',
  units: [{ unit: 'frigate', count: 3 }],
};
/** Отсчёт до выхода контратаки, если пост так и не укреплён (правило 2), — десять минут на
 *  часах забега (`runClock.ts`): полигон показывает время реальным, на обычном темпе это
 *  25 игровых часов. */
export const RAID_DELAY_MS = 10 * 60_000 * RUN_SPEED_NORMAL;
/** Постройка, с которой пост считается укреплённым (правило 2). */
export const RAID_TRIGGER_BUILDING = 'orbital_aa';

const stageIndex = (stage: TrainingStage): number => TRAINING_STAGES.indexOf(stage);

/** Дошёл ли тур до этапа `stage` (или дальше). Нет этапа — тур не идёт: ничего не вводим. */
export const reached = (current: TrainingStage | undefined, stage: TrainingStage): boolean =>
  current !== undefined && stageIndex(current) >= stageIndex(stage);

/** Какие соединения пора ввести (правило 1). */
export function dueForces(
  current: TrainingStage | undefined,
  introduced: ReadonlySet<string>,
): ScenarioForce[] {
  return STAGED_FORCES.filter((f) => reached(current, f.stage) && !introduced.has(f.id));
}

/** Мир с введённым соединением противника; вход не меняется. */
export function withForce(s: GameState, force: ScenarioForce): GameState {
  const fleet: Fleet = {
    id: force.id,
    owner: TRAINING_ENEMY,
    location: force.at,
    movement: null,
    units: force.units.map((u) => ({ unit: u.unit, count: u.count })),
    landing: [],
    orbit: 'near',
    traits: [],
  };
  return { ...s, fleets: { ...s.fleets, [force.id]: fleet } };
}

/** Часы контратаки. Живут вне мира: это сценарий тура, а не правило симуляции. */
export interface RaidClock {
  /** Объявлена (тур дошёл до «Закрепления»). */
  announced: boolean;
  /** Сколько игрового времени отсчитано (правило 3: стоит вместе с часами мира). */
  elapsed: number;
  /** Контратака вышла. */
  launched: boolean;
}

export const RAID_IDLE: RaidClock = { announced: false, elapsed: 0, launched: false };

/** На передовом посту игрока достроено ПКО (правило 2). */
export const outpostFortified = (s: GameState, me: PlayerId): boolean => {
  const post = s.planets[RAID.to];
  return post?.owner === me && post.buildings.some((b) => b.type === RAID_TRIGGER_BUILDING);
};

/** Шаг часов: `dt` — сколько игрового времени прошло с прошлого шага; `fortified` — пост
 *  укреплён ({@link outpostFortified}), объявленной контратаке пора выходить. */
export function raidTick(
  clock: RaidClock,
  current: TrainingStage | undefined,
  dt: number,
  fortified = false,
): RaidClock {
  if (clock.launched) return clock;
  if (!clock.announced) return reached(current, RAID.stage) ? { ...clock, announced: true } : clock;
  if (fortified) return { ...clock, elapsed: RAID_DELAY_MS };
  if (dt <= 0) return clock;
  return { ...clock, elapsed: Math.min(RAID_DELAY_MS, clock.elapsed + dt) };
}

/** Пора выпускать контратаку. */
export const raidDue = (clock: RaidClock): boolean =>
  clock.announced && !clock.launched && clock.elapsed >= RAID_DELAY_MS;

/** Сколько игрового времени осталось до выхода. */
export const raidLeft = (clock: RaidClock): number => Math.max(0, RAID_DELAY_MS - clock.elapsed);

/** Флота больше нет — уничтожен. */
const gone = (s: GameState, id: string): boolean =>
  (s.fleets[id]?.units ?? []).every((u) => u.count <= 0);

/** Исход операции (правило 4) или `null`, пока она идёт. */
export function trainingVerdict(
  s: GameState,
  me: PlayerId,
  clock: RaidClock,
): { winner: PlayerId; reason: 'training-held' | 'elimination' } | null {
  if (s.match.status === 'ended') return null;
  if (!Object.values(s.planets).some((p) => p.owner === me)) {
    return { winner: TRAINING_ENEMY, reason: 'elimination' };
  }
  if (clock.launched && gone(s, RAID.id) && s.planets[TRAINING_TARGET]?.owner === me) {
    return { winner: me, reason: 'training-held' };
  }
  return null;
}

/** Мир с объявленным исходом; вход не меняется. */
export function withVerdict(
  s: GameState,
  verdict: { winner: PlayerId; reason: MatchEndReason },
): GameState {
  return { ...s, match: { ...s.match, status: 'ended', winner: verdict.winner, reason: verdict.reason } };
}
