/**
 * TRN-3 · Сценарий учебного полигона в игре: вводит силы противника по этапам, ведёт
 * объявленную контратаку и объявляет исход. Правила — `decisions/trainingScenario.ts`;
 * здесь только проводка: кадр игры, тур подсказок, табло отсчёта и лента.
 *
 * Сценарий живёт вне мира: что введено и сколько отсчитано — память этого модуля, она
 * сбрасывается на каждом входе в полигон ({@link resetTrainingScenario}). Мир меняется
 * только тем, что вводит сценарий: соединением противника, приказом ему и итогом.
 */
import { t } from '../../localization/runtime';
import { moveFleet } from '../../decisions/actions';
import { runClockText } from '../../decisions/runClock';
import type { TrainingStage } from '../../decisions/trainingStages';
import {
  dueForces,
  outpostFortified,
  RAID,
  RAID_IDLE,
  raidDue,
  raidLeft,
  raidTick,
  TRAINING_ENEMY,
  trainingVerdict,
  withForce,
  withVerdict,
  type RaidClock,
} from '../../decisions/trainingScenario';
import type { Action, GameState } from '../../packages/shared-core/src/index';

/** Что тур отдаёт сценарию (`RunningTour`). */
export interface ScenarioTour {
  readonly active: boolean;
  readonly stage: string | undefined;
  /** Тур держит часы, пока игрок ищет кнопку (TRN-7): отсчёт стоит вместе с миром. */
  readonly holdsClock: boolean;
}

/** Что сценарию нужно от игры. */
export interface TrainingScenarioHost {
  world(): GameState;
  /** Положить изменённый мир (соединение, приказ противнику, итог). */
  setWorld(s: GameState): void;
  /** Приказ ядру — для хода противника; игроку тур о нём не сообщает. */
  order(s: GameState, action: Action): GameState;
  me(): string;
  tour(): ScenarioTour | null;
  /** Строка ленты. */
  note(text: string): void;
  /** Табло отсчёта контратаки (`#trnraid`). */
  board(): HTMLElement | null;
}

let introduced = new Set<string>();
let clock: RaidClock = RAID_IDLE;
let lastTime = 0;
/** Тур хоть раз шёл: после его конца (пройден или пропущен) сценарий доигрывается целиком. */
let tourSeen = false;
let repelled = false;

/** Новый вход в полигон: ничего не введено, контратака не объявлена. */
export function resetTrainingScenario(now: number): void {
  introduced = new Set();
  clock = RAID_IDLE;
  lastTime = now;
  tourSeen = false;
  repelled = false;
}

/** Введено ли соединение — подсказка «Бой» ждёт патруль, которого ещё не было. */
export const forceIntroduced = (id: string): boolean => introduced.has(id);

/** Этап, до которого дошёл тур. Тур кончился — сценарий доигрывается до конца. */
function currentStage(tour: ScenarioTour | null): TrainingStage | undefined {
  if (tour?.active) {
    tourSeen = true;
    return tour.stage as TrainingStage | undefined;
  }
  return tourSeen ? 'finale' : undefined;
}

/** Табло: идёт отсчёт — сколько осталось и стоит ли он; иначе табло нет. */
function paintBoard(host: TrainingScenarioHost, held: boolean): void {
  const board = host.board();
  if (!board) return;
  const show = clock.announced && !clock.launched;
  board.hidden = !show;
  if (!show) return;
  const time = runClockText(raidLeft(clock));
  board.textContent = t(held ? 'training.raid.held' : 'training.raid.eta', { time });
}

/** Шаг сценария; зовётся в кадре, пока мир идёт. */
export function tickTrainingScenario(host: TrainingScenarioHost): void {
  let s = host.world();
  const start = s;
  const dt = s.time - lastTime;
  lastTime = s.time;
  const tour = host.tour();
  const stage = currentStage(tour);

  for (const force of dueForces(stage, introduced)) {
    s = withForce(s, force);
    introduced.add(force.id);
  }

  const announced = clock.announced;
  clock = raidTick(clock, stage, dt, outpostFortified(s, host.me()));
  if (!announced && clock.announced) {
    host.note(t('training.raid.announced'));
  }
  if (raidDue(clock)) {
    s = host.order(withForce(s, RAID), moveFleet(TRAINING_ENEMY, RAID.id, RAID.to));
    introduced.add(RAID.id);
    clock = { ...clock, launched: true };
    host.note(t('training.raid.launched'));
  }
  if (clock.launched && !repelled && (s.fleets[RAID.id]?.units ?? []).every((u) => u.count <= 0)) {
    repelled = true;
    host.note(t('training.raid.repelled'));
  }

  const verdict = trainingVerdict(s, host.me(), clock);
  if (verdict) s = withVerdict(s, verdict);
  if (s !== start) host.setWorld(s);
  paintBoard(host, !!tour?.active && tour.holdsClock);
}

/** Вне полигона табло нет: выход в меню посреди отсчёта не оставляет его на экране. */
export function hideTrainingBoard(board: HTMLElement | null): void {
  if (board && !board.hidden) board.hidden = true;
}
