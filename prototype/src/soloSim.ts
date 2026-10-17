/**
 * Соло-мир без экрана: ход мира и соло-драйверы одним шагом — то, что кадр прототипа
 * делает за мир, пока сервер не играет. Нужен отдельному потоку расчёта (`simWorker.ts`):
 * там нет ни DOM, ни ленты, ни звука, поэтому шаг возвращает события и исходы приказов,
 * а рассказывает о них экран.
 *
 * Порядок шага тот же, что у кадра в `main.ts`: мир до цели, затем драйверы
 * (авто-отступление первым, авто-штурм, столкновения, цепочки, ИИ). Драйверы те же самые
 * (`soloDrivers.ts`), и пути приказов у них те же: чужое место применяется локально, своё —
 * тоже локально, но его исход отдаётся экрану (отказ слышен и пишется в ленту, принятый
 * учит тур). Мир здесь меняется только ядром — `advance` и `order`, как на экране.
 */
import type { Action, DomainEvent, GameState } from '../../packages/shared-core/src/index';
import type { AiProfile } from './ai';
import { advance, order } from './protoKernel';
import { initSoloDrivers } from './soloDrivers';

/** Приказ своего места, который выдал драйвер: что это было и не отказало ли ядро. */
export interface DriverOrder {
  type: string;
  error?: string;
}

/** Итог шага: события по порядку и исходы своих приказов драйверов. */
export interface SoloStep {
  events: DomainEvent[];
  driverOrders: DriverOrder[];
}

export interface SoloSim {
  /** Мир сейчас. */
  state(): GameState;
  /** Мир до `target`, затем драйверы (если `drivers`). Места ИИ и опт-ин авто-штурма —
   *  нынешние экрана: он их меняет, поток только читает. */
  step(
    target: number,
    drivers: boolean,
    ai: ReadonlyMap<string, AiProfile>,
    autoAssault: ReadonlySet<string>,
  ): SoloStep;
  /** Приказ игрока в нынешний миг мира. */
  order(action: Action): { events: DomainEvent[]; error?: string };
}

export function createSoloSim(start: GameState, me: string): SoloSim {
  let s = start;
  let seats: ReadonlyMap<string, AiProfile> = new Map();
  let assault: ReadonlySet<string> = new Set();
  let events: DomainEvent[] = [];
  let driverOrders: DriverOrder[] = [];
  const run = (a: Action): string | undefined => {
    const out = order(s, a, s.time);
    s = out.state;
    events.push(...out.events);
    return out.error;
  };
  const drivers = initSoloDrivers({
    state: () => s,
    me: () => me,
    aiSeats: () => seats,
    applyLocal: (a) => void run(a),
    playerOrder: (a) => {
      const error = run(a);
      driverOrders.push(error ? { type: a.type, error } : { type: a.type });
    },
    autoAssault: (id) => assault.has(id),
  });
  drivers.reset();
  return {
    state: () => s,
    step(target, withDrivers, ai, autoAssault) {
      seats = ai;
      assault = autoAssault;
      events = [];
      driverOrders = [];
      const out = advance(s, target);
      s = out.state;
      events.push(...out.events);
      if (withDrivers) {
        drivers.driveAutoRetreat();
        drivers.autoEngage();
        drivers.checkFleetClashes();
        drivers.driveChains();
        drivers.runAI();
      }
      return { events, driverOrders };
    },
    order(action) {
      events = [];
      const error = run(action);
      return error ? { events, error } : { events };
    },
  };
}
