/**
 * Экранная сторона отдельного потока расчёта соло-мира: поднять поток, слать ему шаги и
 * приказы и собирать его разности в мир на экране.
 *
 * Мир ведёт поток; у экрана две копии. `base` — мир потока, каким его сделала последняя
 * пришедшая разность. Мир на экране — `base` плюс приказы игрока, которые поток ещё не
 * подтвердил: экран применяет приказ сам, сразу (отказ слышен в момент нажатия, флот
 * трогается без ожидания) и отсылает его потоку. С каждой разностью неподтверждённые
 * приказы накладываются на свежий `base` заново тем же ядром, поэтому мир на экране
 * совпадает с миром потока, как только поток их применит. Приказ, который экран принял, а
 * поток отверг (мир успел измениться за шаг), возвращается отказом с опозданием.
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
import { screenView, type SimReply, type SimRequest } from './simProtocol';

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
  /** Был ли среди них шаг мира (часы картинки меряют ход по шагам). */
  stepped: boolean;
}

export interface SimLink {
  /** Шаг отослан, а его разность ещё не пришла. */
  readonly busy: boolean;
  /** Почему поток сломался; `null` — работает. */
  readonly failed: string | null;
  step(
    target: number,
    drivers: boolean,
    ai: ReadonlyMap<string, AiProfile>,
    autoAssault: ReadonlySet<string>,
    now: number,
  ): void;
  /** Приказ игрока, который экран уже применил к своему миру. */
  forward(action: Action): void;
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
  let stepsOut = 0;
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
    if (reply.kind === 'sync' && reply.stepped) stepsOut -= 1;
    if (reply.kind === 'fail') failed = reply.message;
    inbox.push(reply);
  });
  port.post({ kind: 'init', state, me, ...(modeId !== undefined ? { modeId } : {}) });
  const merge = <T>(all: Record<string, T> | undefined, own: Record<string, T> | undefined) =>
    all === undefined && own === undefined ? undefined : { ...all, ...own };

  return {
    get busy() {
      return stepsOut > 0;
    },
    get failed() {
      return failed;
    },
    step(target, drivers, ai, autoAssault, now) {
      stepsOut += 1;
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
    take() {
      if (inbox.length === 0) return null;
      const events: DomainEvent[] = [];
      const driverOrders: DriverOrder[] = [];
      const refused: DriverOrder[] = [];
      let stepped = false;
      let synced = false;
      for (const reply of inbox.splice(0)) {
        if (reply.kind === 'full')
          extras = { fog: reply.fog, swarmIntel: reply.swarmIntel, approval: reply.approval };
        if (reply.kind !== 'sync') continue;
        synced = true;
        base = applyDelta(base, reply.delta);
        events.push(...reply.events);
        driverOrders.push(...reply.driverOrders);
        stepped ||= reply.stepped;
        for (const outcome of reply.orders) {
          const at = pending.findIndex((p) => p.id === outcome.id);
          if (at < 0) continue;
          const [done] = pending.splice(at, 1);
          if (outcome.error) refused.push({ type: done!.action.type, error: outcome.error });
        }
      }
      if (!synced) return null;
      let shown = base;
      for (const p of pending) shown = order(shown, p.action, shown.time).state;
      return { state: shown, events, driverOrders, refused, stepped };
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
