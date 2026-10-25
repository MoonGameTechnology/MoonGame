/**
 * Провод между экраном и отдельным потоком расчёта соло-мира (`simWorker.ts` ↔
 * `simLink.ts`). Только типы и одно чистое правило — какую часть мира поток шлёт экрану.
 *
 * Мир живёт в потоке; у экрана — копия, которую поток держит свежей разностями
 * (`diffState`) после каждого сообщения. Копия полная, кроме памяти тумана и разведки Роя
 * ЧУЖИХ мест: эти записи меняются у всех мест на каждом отрезке времени и составляли
 * большую часть разности (на FFA-50 ~0,6 МБ за шаг из ~0,9), а экран читает только свои.
 * Для записи на уходе со страницы поток присылает их целиком отдельным ответом (`full`), а
 * строку сохранения по такту собирает сам (`save`): кадр её только кладёт в слот.
 */
import type { SoloSave } from '../../decisions/soloSave';
import type {
  Action,
  DomainEvent,
  GameState,
  StateDelta,
} from '../../packages/shared-core/src/index';
import type { AiProfile } from './ai';
import type { DriverOrder } from './soloSim';

/** Экран → поток. */
export type SimRequest =
  /** Мир партии: поток заводит его заново. Режим матча — тот, что вооружил экран. */
  | { kind: 'init'; state: GameState; me: string; modeId?: string }
  /** Шаг: мир до `target`, затем драйверы. Места ИИ и опт-ин авто-штурма — нынешние. */
  | {
      kind: 'step';
      target: number;
      drivers: boolean;
      ai: Array<[string, AiProfile]>;
      autoAssault: string[];
    }
  /** Приказ игрока, уже принятый копией экрана. `id` растёт с каждым приказом. */
  | { kind: 'order'; id: number; action: Action }
  /** Память тумана и разведку Роя всех мест — для сохранения партии. */
  | { kind: 'full' }
  /** Собрать строку сохранения партии здесь, а не в кадре: мир — свой, политики хоста —
   *  экрана. `rules` — сверка правил слота (`decisions/soloSave.ts`). */
  | { kind: 'save'; id: number; rules: string; host: Omit<SoloSave, 'state'> };

/** Исход приказа игрока в потоке. */
export interface OrderOutcome {
  id: number;
  error?: string;
}

/** Поток → экран. */
export type SimReply =
  /** После каждого `step` и `order`: что изменилось в мире с прошлой разности. */
  | {
      kind: 'sync';
      delta: StateDelta;
      events: DomainEvent[];
      driverOrders: DriverOrder[];
      orders: OrderOutcome[];
      stepped: boolean;
      /** Сколько стоил шаг в потоке, мс. */
      ms: number;
    }
  | { kind: 'full'; fog: GameState['fog']; swarmIntel: GameState['swarmIntel'] }
  /** Ответ на `save`: строка для слота; `null` — писать нечего (партия кончилась) или
   *  собрать не вышло. */
  | { kind: 'saved'; id: number; raw: string | null }
  /** Поток сломался: экран продолжает мир у себя. */
  | { kind: 'fail'; message: string };

/** Мир, каким его видит копия экрана: память тумана и разведка Роя — только свои. */
export function screenView(state: GameState, me: string): GameState {
  const own = <T>(rec: Record<string, T> | undefined): Record<string, T> | undefined =>
    rec === undefined ? undefined : me in rec ? { [me]: rec[me] as T } : {};
  return { ...state, fog: own(state.fog), swarmIntel: own(state.swarmIntel) };
}
