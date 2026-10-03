/**
 * Контракт операции главы VI «Нулевой комплекс» (`docs/sector-zero-map-concepts.md` §8.8,
 * кирпич PVR-8.3).
 *
 * Карта объявляет контракт полем `operation`; загрузчик заводит `state.operation`. Главу
 * выигрывают три результата ВМЕСТЕ, в любом порядке военных действий:
 *
 * 1. **Производство подавлено** — враг не держит ни одного названного очага. Кто взял
 *    очаг, игрок или союзник, неважно (§8.3: успехи союзника — наравне). Отбил враг очаг
 *    назад — очаг снова действует: правило живое, а не «однажды взят».
 * 2. **Главные силы разгромлены** — у каждого названного соединения корпуса осталось не
 *    больше доли `breakAt` стартового. Учёт идёт за флотом: слияние переносит его в
 *    принимающий, деление тянет на отделённый, влитые подкрепления — часть соединения.
 *    Порог — доля, а не «ни одного корабля»: последний спрятавшийся разведчик главу не
 *    держит (§8.8). Разгром — навсегда: подкрепления, влитые в остаток, соединение не
 *    воскрешают (§8.7).
 * 3. **Основная эвакуация завершена** — беженцев в убежище доставлено не меньше
 *    `evacuate` (`missionFacts.evacuated`, доставку считает `missionFactsModule`).
 *    Погрузка — ещё не доставка.
 *
 * **Поражение** — эвакуация стала невозможной: доставленных, идущих и ждущих в доках
 * беженцев меньше порога. Порог объявлен картой, а не выводится из потерь задним числом.
 *
 * Модуль пишет факты (`brokenAt`, `completedAt`, `lostAt`) и шлёт события; вердикт выносит
 * `victoryModule` по `operation.completed`/`operation.lost`, как с накопителем главы IV.
 * Судит против врага штурма (`state.pve.npcPlayerId`): без PvE контракт инертен. Модули
 * встречаются на шине по имени события, импорта друг друга нет.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { GameData } from '../data/schemas';
import type {
  Fleet,
  GameState,
  OperationForce,
  PlanetId,
  PlayerId,
  UnitStack,
} from '../state/gameState';

/** Признак юнита-беженца — тот же словарь данных, что у `missionFactsModule`
 *  (`EVACUEE_TRAIT`): модули друг друга не импортируют. */
const EVACUEE = 'evacuee';

/** Живой стек: корабли есть, и бой не обнулил его корпус. */
const alive = (st: UnitStack): boolean => st.count > 0 && (st.hp ?? 1) > 0;

/** Сторона штурма — чей это контракт: не враг и не житель карты. По id, для реплея. */
function attackers(state: GameState, enemy: PlayerId): PlayerId[] {
  return Object.keys(state.players)
    .sort()
    .filter((id) => id !== enemy && !state.players[id]?.npc);
}

/** Корпус кораблей соединения сейчас: Σ count × hp по всем его флотам. */
export function forceHp(state: GameState, data: GameData, force: OperationForce): number {
  let hp = 0;
  for (const id of force.fleets)
    for (const st of state.fleets[id]?.units ?? []) {
      const def = data.units[st.unit];
      if (def?.domain === 'space' && alive(st)) hp += st.count * def.stats.hp;
    }
  return hp;
}

/** Контракт глазами судьи — один источник для вердикта и для панели главы (PVR-8.5). */
export interface OperationStatus {
  /** Очаги, которые враг всё ещё держит. */
  held: PlanetId[];
  /** Разгромленные соединения (id из карты), по алфавиту. */
  broken: string[];
  /** Соединений в контракте. */
  forces: number;
  /** Беженцев доставлено в убежище. */
  delivered: number;
  /** Сколько нужно довести. */
  need: number;
  /** Сколько ещё можно довести всего: доставлено + в пути + ждут в доках. */
  possible: number;
  /** Три результата сошлись. */
  done: boolean;
  /** Эвакуация стала невозможной. */
  lost: boolean;
}

/** Состояние контракта. `null` — контракта нет или штурм ещё не начат (врага не знаем). */
export function operationStatus(state: GameState, data: GameData): OperationStatus | null {
  const op = state.operation;
  const enemy = state.pve?.npcPlayerId;
  if (!op || enemy === undefined) return null;
  const held = op.production.filter((id) => state.planets[id]?.owner === enemy);
  const ids = Object.keys(op.forces).sort();
  const broken = ids.filter((id) => op.forces[id]!.brokenAt !== undefined);
  // Беженцы стороны штурма (`attackers`).
  const ours = (owner: string): boolean => owner !== enemy && !state.players[owner]?.npc;
  let delivered = 0;
  for (const [owner, n] of Object.entries(state.missionFacts?.evacuated ?? {}))
    if (ours(owner)) delivered += n;
  let left = 0;
  const count = (f: Fleet): void => {
    if (!ours(f.owner)) return;
    for (const st of f.units)
      if (alive(st) && data.units[st.unit]?.traits.includes(EVACUEE)) left += st.count;
  };
  for (const f of Object.values(state.fleets)) count(f);
  for (const p of Object.values(state.planets)) for (const f of p.awaitingFleets ?? []) count(f);
  const need = op.evacuate;
  const possible = delivered + left;
  return {
    held,
    broken,
    forces: ids.length,
    delivered,
    need,
    possible,
    done: held.length === 0 && broken.length === ids.length && delivered >= need,
    lost: possible < need,
  };
}

/** Соединение ушло из флота `from` во флот `to`: слияние заменяет, деление добавляет. */
function follow(h: HandlerContext, from: unknown, to: unknown, split: boolean): void {
  const op = h.state.operation;
  if (!op || typeof from !== 'string' || typeof to !== 'string') return;
  for (const id of Object.keys(op.forces).sort()) {
    const force = op.forces[id]!;
    if (!force.fleets.includes(from)) continue;
    const kept = split ? force.fleets : force.fleets.filter((f) => f !== from);
    force.fleets = kept.includes(to) ? kept : [...kept, to];
  }
}

/** Проверить контракт: сперва разгромы (навсегда), затем исход. События — каждому игроку
 *  стороны штурма (`owner`): по этому ключу их и пропускает туман. */
function judge(h: HandlerContext): void {
  const op = h.state.operation;
  if (!op || !h.state.pve || op.completedAt !== undefined || op.lostAt !== undefined) return;
  const side = attackers(h.state, h.state.pve.npcPlayerId);
  for (const id of Object.keys(op.forces).sort()) {
    const force = op.forces[id]!;
    force.fleets = force.fleets.filter((f) => h.state.fleets[f] !== undefined);
    if (force.brokenAt !== undefined) continue;
    if (forceHp(h.state, h.ctx.data, force) > op.breakAt * force.hp) continue;
    force.brokenAt = h.ctx.now;
    for (const owner of side) h.emit('operation.force.broken', { owner, force: id });
  }
  const status = operationStatus(h.state, h.ctx.data)!;
  if (status.lost) {
    op.lostAt = h.ctx.now;
    for (const owner of side)
      h.emit('operation.lost', { owner, possible: status.possible, need: status.need });
  } else if (status.done) {
    op.completedAt = h.ctx.now;
    for (const owner of side) h.emit('operation.completed', { owner, delivered: status.delivered });
  }
}

/** Поводы проверить контракт: всё, что меняет очаги, корпус соединений и беженцев. */
const JUDGED_ON = [
  'time.advanced',
  'planet.captured',
  'battle.resolved',
  'fleet.destroyed',
  'evac.delivered',
] as const;

export const operationModule: GameModule = {
  id: 'operation',
  version: '1.0.0',
  setup(api) {
    api.on('fleet.merged', (event, h) => {
      const p = event.payload as { from?: unknown; into?: unknown };
      follow(h, p.from, p.into, false);
    });
    api.on('fleet.split', (event, h) => {
      const p = event.payload as { from?: unknown; to?: unknown };
      follow(h, p.from, p.to, true);
    });
    for (const type of JUDGED_ON) api.on(type, (_event, h) => judge(h));
  },
};
