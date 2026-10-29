/**
 * Поток расчёта соло-мира — драйвер со стороны экрана (REFM-245).
 *
 * Мир обычной схватки считает отдельный поток (`simWorker.ts`), а кадр только рисует. Связь
 * с потоком — `simLink.ts`, часы движения между его шагами — `decisions/simClock.ts` и
 * `decisions/netViewClock.ts`, откуда поднимать поток — `decisions/simWorker.ts`. Здесь —
 * то, что раньше жило `let`'ами в `main.ts`: сама связь, признак «поток сломался», накопленный
 * к шагу ход, часы картинки и момент последнего взятия мира, а с ними решение, ведёт ли поток
 * этот мир. Кадр зовёт три двери по порядку: {@link syncSim} — поток поднят или погашен,
 * присланное взято; {@link stepSim} — следующий шаг; {@link settleSimClock} — часы картинки.
 *
 * Мир и его замена остаются у `main.ts`: модуль читает мир хуком, а присланное кладёт через
 * `apply` конвейера приказа (`orderPipeline.ts`), как и кадр, ведущий мир сам.
 */
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { adoptDue, stepBacklog } from '../../decisions/simClock';
import { simWorkerScript, type SimWorkerScript } from '../../decisions/simWorker';
import { NET_VIEW_IDLE, netViewAt, netViewSnapshot } from '../../decisions/netViewClock';
import type { SoloSave } from '../../decisions/soloSave';
import type { AiProfile } from './ai';
import { HOUR, matchMode } from './game';
import { soloAutoAssault } from './groupOrders';
import { mapMoving } from './mapLayer';
import { netWorld } from './netSession';
import { apply, settleOrder } from './orderPipeline';
import { sandboxConfig } from './sandbox';
import { startSimLink, workerPort, type SimLink } from './simLink';
import { soloSaveActive } from './soloCheckpoint';

declare const __PLAYER_BUILD__: boolean;
// Файл потока (и для дев-сборки с диска — исходник строкой) кладёт сборка (`build.mjs`).
declare const __SIM_WORKER_URL__: string | undefined;
declare const __SIM_WORKER_SRC__: string | undefined;

/** Что драйверу даёт игра: мир, своё место, экран матча, места ИИ и очередь комиксов. */
export interface SimDriverHost {
  world(): GameState;
  me(): string;
  /** Идёт ли матч на экране: не хаб, не вход, не меню Sector Zero и не настройка схватки. */
  inMatch(): boolean;
  aiPlayers(): ReadonlyMap<string, AiProfile>;
  /** Комикс главы держит часы: драйверы мира в шаге потока молчат. */
  comicBusy(): boolean;
}

let game: SimDriverHost;
let script: SimWorkerScript | null = null;
let link: SimLink | null = null;
/** Поток не поднялся или сломался — до перезагрузки мир идёт в кадре. */
let broken = false;
/** Игровое время, накопленное кадрами к следующему шагу потока (`stepBacklog`). */
let backlog = 0;
/** Часы картинки между шагами потока — те же, что у сети между снимками сервера. */
let view = NET_VIEW_IDLE;
let shownTime = 0;
/** Когда кадр в последний раз взял мир потока (правило 7 в `simClock.ts`). */
let adoptedAt = -Infinity;

export function initSimDriver(host: SimDriverHost): void {
  game = host;
  script = simWorkerScript({
    protocol: location.protocol,
    query: new URLSearchParams(location.search).get('sim'),
    url: typeof __SIM_WORKER_URL__ === 'string' ? __SIM_WORKER_URL__ : '',
    source: typeof __SIM_WORKER_SRC__ === 'string' ? __SIM_WORKER_SRC__ : '',
  });
}

/** Поток считает только обычную схватку: забег, обучение, полигон, песочница и сеть ведут
 *  мир в кадре — там экран сам правит мир и ждёт итог приказа сразу. */
function eligible(): boolean {
  return (
    script !== null &&
    !broken &&
    !netWorld &&
    soloSaveActive &&
    !game.world().pve &&
    game.inMatch() &&
    !(!__PLAYER_BUILD__ && sandboxConfig.enabled)
  );
}

/** Ведёт ли мир на экране поток. */
export function simOn(): boolean {
  return link !== null;
}

/** Игровое «сейчас» картинки, пока мир ведёт поток. */
export function simShownTime(): number {
  return shownTime;
}

export function stopSim(): void {
  link?.stop();
  link = null;
  backlog = 0;
  view = NET_VIEW_IDLE;
  adoptedAt = -Infinity;
}

/** Приказ игрока, который экран уже применил к своему миру, уходит и потоку. */
export function forwardToSim(action: Action): void {
  link?.forward(action);
}

/** Мир для сохранения: с тем, чего у копии экрана нет, если мир ведёт поток. */
export function simSaved(state: GameState): GameState {
  return link ? link.saved(state) : state;
}

/** Собрать сохранение в потоке; `false` — потока нет, сохранение собирает экран. */
export function saveSimInBackground(
  host: Omit<SoloSave, 'state'>,
  rules: string,
  done: (raw: string | null) => void,
): boolean {
  if (!link) return false;
  link.save(host, rules, done);
  return true;
}

/** Начало кадра: поток поднят или погашен, присланное (мир, события и исходы своих приказов)
 *  взято. Сломавшийся поток отдаёт мир кадру. */
export function syncSim(nowReal: number): void {
  if (link && !eligible()) stopSim();
  if (!link && eligible()) {
    const port = script && workerPort(script);
    if (port) link = startSimLink(port, game.world(), game.me(), matchMode());
    else broken = true;
  }
  if (!link) return;
  // Присланное кадр берёт не чаще раза в `ADOPT_EVERY_MS`, а пока камера движется — в
  // `ADOPT_MOVING_MS` (`simClock.ts`, правило 7): каждый взятый мир он разбирает заново, а
  // движение между мирами досчитывают часы картинки. Им время мира потока идёт с каждым
  // пришедшим шагом, а не со взятием. Сломавшийся поток отдаёт всё, что успел прислать, сразу.
  const arrived = link.frame();
  if (arrived !== null) view = netViewSnapshot(view, arrived, nowReal);
  const due = adoptDue(nowReal, adoptedAt, mapMoving(nowReal)) || link.failed !== null;
  const sync = due ? link.take() : null;
  if (sync) {
    adoptedAt = nowReal;
    apply({ state: sync.state, events: sync.events });
    for (const o of [...sync.driverOrders, ...sync.refused]) settleOrder(o.type, o.error);
  }
  if (link.failed !== null) {
    // Мир на экране цел (последняя разность и неподтверждённые приказы) — кадр ведёт его дальше.
    // Чего у копии нет (чужая память тумана, мнения ботов о чужих местах), он берёт из последней
    // полной посылки потока: без них соперники в кадре забыли бы разведку, а боты — что думают
    // друг о друге.
    console.warn('sim worker failed:', link.failed);
    apply({ state: link.saved(game.world()), events: [] });
    stopSim();
    broken = true;
  }
}

/** Мир идёт: ход кадра копится к следующему шагу потока. `false` — потока нет, мир ведёт кадр. */
export function stepSim(dt: number, speed: number, nowReal: number): boolean {
  if (!link) return false;
  backlog = stepBacklog(backlog, dt, speed, HOUR);
  if (!link.busy && backlog > 0) {
    // От цели прошлого шага, а не от мира на экране: тот отстаёт на шаги, которых кадр не взял.
    link.step(link.time + backlog, !game.comicBusy(), game.aiPlayers(), soloAutoAssault, nowReal);
    backlog = 0;
  }
  return true;
}

/** Конец хода кадра: часы картинки. На паузе картинка стоит на мире — досчитывать нечего. */
export function settleSimClock(nowReal: number, running: boolean): void {
  if (!running) {
    backlog = 0;
    view = NET_VIEW_IDLE;
  }
  shownTime = netViewAt(view, nowReal, game.world().time);
}
