/**
 * Провод между экраном и отдельным потоком расчёта соло-мира (`simWorker.ts` ↔
 * `simLink.ts`). Только типы и одно чистое правило — какую часть мира поток шлёт экрану.
 *
 * Мир живёт в потоке; у экрана — копия, которую поток держит свежей разностями
 * (`diffState`) после каждого сообщения. Копия полная, кроме памяти тумана и разведки Роя
 * ЧУЖИХ мест и мнений ботов о чужих местах: эти записи меняются у всех мест на каждом
 * отрезке времени и составляли большую часть разности (память на FFA-50 — ~0,6 МБ за шаг из
 * ~0,9, стол симпатий на frontier-100 — 166 КБ из 204), а экран читает только свои.
 * Для записи на уходе со страницы поток присылает их целиком отдельным ответом (`full`), а
 * строку сохранения по такту собирает сам (`save`): кадр её только кладёт в слот.
 *
 * Казна копится у всех мест на каждом шаге, и место, у которого сменилась только она, едет
 * не записью, а числами подряд (`Treasuries`): на frontier-100 это 124 места на каждом шаге,
 * и распаковка их записей занимала экран дольше всей остальной разности.
 */
import type { SoloSave } from '../../decisions/soloSave';
import type {
  Action,
  DomainEvent,
  GameState,
  Player,
  StateDelta,
} from '../../packages/shared-core/src/index';
import { deepEqual } from '../../packages/shared-core/src/util/clone';
import type { AiProfile } from './ai';
import { approvalView, type ApprovalLedger } from './botFavour';
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
  /** Память тумана, разведку Роя и симпатии ботов всех мест — для сохранения партии. */
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
      /** Казна мест, которых в разности нет, хотя она у них сменилась (`packTreasuries`). */
      treasuries: Treasuries;
      events: DomainEvent[];
      driverOrders: DriverOrder[];
      orders: OrderOutcome[];
      stepped: boolean;
      /** Сколько стоил шаг в потоке, мс. */
      ms: number;
    }
  | {
      kind: 'full';
      fog: GameState['fog'];
      swarmIntel: GameState['swarmIntel'];
      approval: ApprovalLedger | undefined;
    }
  /** Ответ на `save`: строка для слота; `null` — писать нечего (партия кончилась) или
   *  собрать не вышло. */
  | { kind: 'saved'; id: number; raw: string | null }
  /** Поток сломался: экран продолжает мир у себя. */
  | { kind: 'fail'; message: string };

/** Мир, каким его видит копия экрана: память тумана и разведка Роя — только свои, из стола
 *  симпатий — только мнение ботов о себе (`approvalView`, как у сервера). */
export function screenView(state: GameState, me: string): GameState {
  const own = <T>(rec: Record<string, T> | undefined): Record<string, T> | undefined =>
    rec === undefined ? undefined : me in rec ? { [me]: rec[me] as T } : {};
  return approvalView({ ...state, fog: own(state.fog), swarmIntel: own(state.swarmIntel) }, me);
}

/** Казна мест числами подряд: у места `ids[j]` значения его казны в порядке её ключей
 *  начинаются с `values[at[j]]`. Сами ключи не едут: они те же, что у места в копии экрана. */
export interface Treasuries {
  ids: string[];
  at: Uint32Array;
  values: Float64Array;
}

/** Вынуть из разности места, у которых с копии экрана `prev` сменилась только казна: их
 *  казна поедет числами. Место остаётся в разности целиком, если у него сменилось ещё
 *  что-то, сменились ключи казны или в ней не число. */
export function packTreasuries(
  prev: GameState,
  delta: StateDelta,
): { delta: StateDelta; treasuries: Treasuries } {
  const changed = delta.changed.players as Record<string, Player> | undefined;
  const ids: string[] = [];
  const at: number[] = [];
  const values: number[] = [];
  if (changed) {
    const whole: Record<string, Player> = {};
    for (const id of Object.keys(changed)) {
      const now = changed[id]!;
      const was = prev.players[id];
      if (!was || !onlyTreasury(was, now)) {
        whole[id] = now;
        continue;
      }
      ids.push(id);
      at.push(values.length);
      for (const k of Object.keys(now.resources)) values.push(now.resources[k]!);
    }
    if (ids.length > 0) {
      const rest = { ...delta.changed };
      if (Object.keys(whole).length > 0) rest.players = whole;
      else delete rest.players;
      delta = { ...delta, changed: rest };
    }
  }
  return {
    delta,
    treasuries: { ids, at: new Uint32Array(at), values: new Float64Array(values) },
  };
}

/** У места сменилась только казна, и её числа ложатся по прежним ключам. */
function onlyTreasury(was: Player, now: Player): boolean {
  const before = Object.keys(was.resources);
  const after = Object.keys(now.resources);
  if (before.length !== after.length) return false;
  for (let i = 0; i < after.length; i++) {
    if (before[i] !== after[i] || typeof now.resources[after[i]!] !== 'number') return false;
  }
  return deepEqual({ ...was, resources: null }, { ...now, resources: null });
}

/** Разложить по записям мест казну из разностей, только что наложенных на копию экрана
 *  `state` по порядку. Место получает казну из последней разности, где она есть: разности
 *  идут с конца, и место, пришедшее целиком или ушедшее, несёт свою казну само, поэтому числа
 *  из разностей до него ему не нужны. Остальное в записи места — прежнее. */
export function spreadTreasuries(
  state: GameState,
  syncs: ReadonlyArray<{ delta: StateDelta; treasuries: Treasuries }>,
): GameState {
  const done = new Set<string>();
  let players: Record<string, Player> | null = null;
  for (let r = syncs.length - 1; r >= 0; r--) {
    const { delta, treasuries } = syncs[r]!;
    const { ids, at, values } = treasuries;
    for (let j = 0; j < ids.length; j++) {
      const id = ids[j]!;
      if (done.has(id)) continue;
      done.add(id);
      players ??= { ...state.players };
      const player = players[id]!;
      const resources = { ...player.resources };
      let i = at[j]!;
      for (const k of Object.keys(resources)) resources[k] = values[i++]!;
      players[id] = { ...player, resources };
    }
    for (const id of Object.keys(delta.changed.players ?? {})) done.add(id);
    for (const id of delta.removed.players ?? []) done.add(id);
  }
  return players ? { ...state, players } : state;
}
