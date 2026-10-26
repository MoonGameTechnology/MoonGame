/**
 * Экранная сторона отдельного потока расчёта соло-мира: поднять поток, слать ему шаги и
 * приказы и собирать его разности в мир на экране.
 *
 * Мир ведёт поток; у экрана две копии. `base` — мир потока, каким его сделала последняя
 * разность, которую забрал кадр. Мир на экране — `base` плюс приказы игрока, которые поток ещё
 * не подтвердил: экран применяет приказ сам, сразу (отказ слышен в момент нажатия, флот
 * трогается без ожидания) и отсылает его потоку. С каждой разностью неподтверждённые
 * приказы накладываются на свежий `base` заново тем же ядром, поэтому мир на экране
 * совпадает с миром потока, как только поток их применит. Приказ, который экран принял, а
 * поток отверг (мир успел измениться за шаг), возвращается отказом с опозданием.
 *
 * Присланное экран забирает не в каждом кадре (правило 7 в `decisions/simClock.ts`), и мир на
 * экране отстаёт от мира потока на шаги, которых он ещё не взял. Поэтому следующий шаг
 * отсчитывается от {@link SimLink.time}, а не от мира на экране, а часы картинки получают
 * время мира потока с приходом каждого шага ({@link SimLink.frame}), а не со взятием мира.
 *
 * Чего у копии нет — памяти тумана и разведки Роя чужих мест и мнений ботов о чужих местах
 * (`screenView`). Для сохранения на уходе со страницы поток раз в {@link FULL_EVERY_MS}
 * присылает их целиком, и {@link SimLink.saved} подкладывает их под мир на экране. Строку
 * сохранения по такту собирает сам поток ({@link SimLink.save}) из своего полного мира.
 */
import type { SimWorkerScript } from '../../decisions/simWorker';
import type { SoloSave } from '../../decisions/soloSave';
import type { Action, DomainEvent, GameState } from '../../packages/shared-core/src/index';
import { applyDelta } from '../../packages/shared-core/src/index';
import type { AiProfile } from './ai';
import { approvalLedger, fullApproval } from './botFavour';
import { order } from './protoKernel';
import type { DriverOrder } from './soloSim';
import { screenView, spreadTreasuries, type SimReply, type SimRequest } from './simProtocol';

/** Как часто экран просит у потока память тумана всех мест для сохранения. */
export const FULL_EVERY_MS = 10_000;

/** Канал до потока. В игре — `Worker`, в тесте — хозяин мира в том же процессе. */
export interface SimPort {
  post(request: SimRequest): void;
  listen(handler: (reply: SimReply) => void): void;
  close(): void;
}

/** Что изменилось на экране с прошлого {@link SimLink.take}. */
export interface SimSync {
  /** Мир на экране: мир потока плюс неподтверждённые приказы игрока. */
  state: GameState;
  /** События шагов и приказов драйверов, по порядку. Приказы игрока экран уже рассказал. */
  events: DomainEvent[];
  /** Свои приказы, которые выдали драйверы потока. */
  driverOrders: DriverOrder[];
  /** Приказы игрока, которые экран принял, а поток отверг. */
  refused: DriverOrder[];
}

export interface SimLink {
  /** Шаг отослан, а его разность ещё не пришла. */
  readonly busy: boolean;
  /** Почему поток сломался; `null` — работает. */
  readonly failed: string | null;
  /** Время мира потока после всех отосланных шагов: цель последнего из них. */
  readonly time: number;
  step(
    target: number,
    drivers: boolean,
    ai: ReadonlyMap<string, AiProfile>,
    autoAssault: ReadonlySet<string>,
    now: number,
  ): void;
  /** Приказ игрока, который экран уже применил к своему миру. */
  forward(action: Action): void;
  /** Начался кадр: время мира потока после последнего шага, пришедшего с прошлого кадра, —
   *  часам картинки; `null` — шагов не приходило. Зовётся каждый кадр, и когда мир кадр не
   *  берёт: иначе часы картинки отсчитывали бы ход от взятия, а не от прихода. */
  frame(): number | null;
  /** Собрать пришедшее; `null` — разностей не было. */
  take(): SimSync | null;
  /** Мир на экране с тем, чего у копии нет (память тумана всех мест, весь стол симпатий), —
   *  для сохранения и для мира, который кадр ведёт сам, когда поток сломался. */
  saved(state: GameState): GameState;
  /** Собрать строку сохранения в потоке; `done` получит её, `null` — писать нечего. Поток
   *  остановлен или сломался — `done` не позовут. */
  save(host: Omit<SoloSave, 'state'>, rules: string, done: (raw: string | null) => void): void;
  stop(): void;
}

/** Поток `simWorker.ts` из файла сборки или из исходника строкой (`decisions/simWorker.ts`).
 *  `null` — поток не поднялся. */
export function workerPort(script: SimWorkerScript): SimPort | null {
  try {
    const inline = 'source' in script;
    const url = inline
      ? URL.createObjectURL(new Blob([script.source], { type: 'text/javascript' }))
      : script.url;
    const worker = new Worker(url);
    return {
      post: (request) => worker.postMessage(request),
      listen: (handler) => {
        worker.onmessage = (event: MessageEvent<SimReply>) => handler(event.data);
        worker.onerror = (event) => {
          event.preventDefault();
          handler({ kind: 'fail', message: event.message || 'worker error' });
        };
      },
      close: () => {
        worker.terminate();
        if (inline) URL.revokeObjectURL(url);
      },
    };
  } catch {
    return null;
  }
}

export function startSimLink(
  port: SimPort,
  state: GameState,
  me: string,
  modeId: string | undefined,
): SimLink {
  // Копия с самого начала такая, какой её держит поток (`shown` в `simHost.ts`): его разности
  // считаются от неё, и стол симпатий, который в первых шагах не менялся, не остался бы полным.
  let base = screenView(state, me);
  const pending: Array<{ id: number; action: Action }> = [];
  let nextId = 1;
  /** Цели отосланных шагов, разность которых ещё не пришла, по порядку. */
  const targets: number[] = [];
  let time = state.time;
  /** Время мира потока после последнего пришедшего шага, которого кадр ещё не видел. */
  let arrived: number | null = null;
  let failed: string | null = null;
  let fullAt = -Infinity;
  let extras = { fog: state.fog, swarmIntel: state.swarmIntel, approval: approvalLedger(state) };
  const inbox: SimReply[] = [];
  const saves = new Map<number, (raw: string | null) => void>();
  let nextSave = 1;
  port.listen((reply) => {
    // Строка слота идёт в слот сразу, между кадрами, а не ждёт кадр в очереди разностей.
    if (reply.kind === 'saved') {
      const done = saves.get(reply.id);
      saves.delete(reply.id);
      done?.(reply.raw);
      return;
    }
    if (reply.kind === 'sync' && reply.stepped) arrived = targets.shift() ?? arrived;
    if (reply.kind === 'fail') failed = reply.message;
    inbox.push(reply);
  });
  port.post({ kind: 'init', state, me, ...(modeId !== undefined ? { modeId } : {}) });
  const merge = <T>(all: Record<string, T> | undefined, own: Record<string, T> | undefined) =>
    all === undefined && own === undefined ? undefined : { ...all, ...own };

  return {
    get busy() {
      return targets.length > 0;
    },
    get failed() {
      return failed;
    },
    get time() {
      return time;
    },
    step(target, drivers, ai, autoAssault, now) {
      targets.push(target);
      time = target;
      port.post({ kind: 'step', target, drivers, ai: [...ai], autoAssault: [...autoAssault] });
      if (now - fullAt >= FULL_EVERY_MS) {
        fullAt = now;
        port.post({ kind: 'full' });
      }
    },
    forward(action) {
      const id = nextId++;
      pending.push({ id, action });
      port.post({ kind: 'order', id, action });
    },
    frame() {
      const t = arrived;
      arrived = null;
      return t;
    },
    take() {
      if (inbox.length === 0) return null;
      const events: DomainEvent[] = [];
      const driverOrders: DriverOrder[] = [];
      const refused: DriverOrder[] = [];
      const syncs: Array<Extract<SimReply, { kind: 'sync' }>> = [];
      for (const reply of inbox.splice(0)) {
        if (reply.kind === 'full')
          extras = { fog: reply.fog, swarmIntel: reply.swarmIntel, approval: reply.approval };
        if (reply.kind !== 'sync') continue;
        syncs.push(reply);
        base = applyDelta(base, reply.delta);
        events.push(...reply.events);
        driverOrders.push(...reply.driverOrders);
        for (const outcome of reply.orders) {
          const at = pending.findIndex((p) => p.id === outcome.id);
          if (at < 0) continue;
          const [done] = pending.splice(at, 1);
          if (outcome.error) refused.push({ type: done!.action.type, error: outcome.error });
        }
      }
      if (syncs.length === 0) return null;
      base = spreadTreasuries(base, syncs);
      let shown = base;
      for (const p of pending) shown = order(shown, p.action, shown.time).state;
      return { state: shown, events, driverOrders, refused };
    },
    saved: (shown) =>
      fullApproval(
        {
          ...shown,
          fog: merge(extras.fog, shown.fog),
          swarmIntel: merge(extras.swarmIntel, shown.swarmIntel),
        },
        extras.approval,
      ),
    save(host, rules, done) {
      const id = nextSave++;
      saves.set(id, done);
      port.post({ kind: 'save', id, rules, host });
    },
    stop: () => {
      saves.clear();
      port.close();
    },
  };
}
