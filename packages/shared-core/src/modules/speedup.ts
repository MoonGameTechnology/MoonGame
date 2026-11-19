/**
 * Ускорение очередей (TEC-3, `docs/time-economy-roadmap.md`): игрок сокращает ожидание
 * стройки, производства или исследования. Цена, бюджет и учёт — `util/speedup.ts`; сдвигает
 * очередь её владелец через возможность (`construction.hasten`, `technology.hasten`).
 *
 * Два действия:
 *
 * - `queue.speedup` — за Суверены ◆. ◆ живут на счёте аккаунта, вне партии, поэтому это
 *   действие ТОЛЬКО ХОСТА (как ремонт за ◆): в `actionPayloadSchemas` его нет, клиент его
 *   не пришлёт. Хост узнаёт цену той же `speedupPrice`, списывает её и подаёт действие с
 *   этой ценой; ядро пересчитывает её на своём состоянии и отказывает (`E_PRICE_CHANGED`),
 *   если она разошлась, — тогда хост возвращает списанное. Партия без золота
 *   (`match.goldActions: false`) такого действия не принимает.
 * - `queue.finish` — бесплатное окончание последних минут очереди (`freeFinishMinutes`).
 *   Его шлёт клиент; оно не тратит ни ◆, ни бюджет и доступно в любой партии.
 *
 * Ускоряется не больше остатка очереди и не больше бюджета K: хост просит часы, ядро
 * отказывает, если их больше, чем осталось у очереди или в бюджете, — без молчаливой
 * обрезки, иначе цена в действии и списанное разошлись бы.
 *
 * - `resources.buy` (TEC-4) — ресурс на `hours` эталонных часов за ◆: столько, сколько
 *   стоят эти часы по матрице (`resourceForHours`, вниз до целого). Тоже только хоста, из
 *   того же бюджета K и по той же цене, что ускорение (решение владельца: один бюджет на
 *   всё, что сокращает путь за ◆): купить час металла и ускорить стройку на час — одна и
 *   та же трата.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Action } from '../action/types';
import {
  finishesFree,
  recordSpeedup,
  speedupLeftHours,
  speedupPrice,
  type QueueHasten,
  type QueueRef,
} from '../util/speedup';
import { hasTimeValue, resourceForHours } from '../util/timeValue';

/** Разобрать ссылку на очередь из полезной нагрузки; `null` — кривая нагрузка. */
function readRef(payload: Record<string, unknown>): QueueRef | null {
  if (payload.kind === 'construction' && typeof payload.seq === 'number' && Number.isInteger(payload.seq))
    return { kind: 'construction', seq: payload.seq };
  if (payload.kind === 'research' && typeof payload.technology === 'string')
    return { kind: 'research', technology: payload.technology };
  return null;
}

/** Владелец очереди, или отказ: без него эту очередь ускорить нечем. */
function ownerOf(h: HandlerContext, ref: QueueRef): QueueHasten | null {
  return h.capability<QueueHasten>(ref.kind === 'construction' ? 'construction.hasten' : 'technology.hasten') ?? null;
}

function speedup(action: Action, h: HandlerContext): void {
  const p = (action.payload ?? {}) as Record<string, unknown>;
  const ref = readRef(p);
  const hours = p.hours;
  const price = p.price;
  if (!ref || typeof hours !== 'number' || !(hours > 0) || !Number.isFinite(hours) ||
    typeof price !== 'number' || !Number.isInteger(price) || price < 0) {
    return h.reject('E_BAD_PAYLOAD');
  }
  if (!h.state.players[action.playerId]) return h.reject('E_FORBIDDEN');
  const def = h.ctx.data.timeValue;
  if (!hasTimeValue(def)) return h.reject('E_NOT_AVAILABLE');
  if (h.state.match.goldActions === false) return h.reject('E_GOLD_OFF');
  const owner = ownerOf(h, ref);
  const remaining = owner?.remaining(h, action.playerId, ref) ?? null;
  if (!owner || remaining === null || !(remaining > 0)) return h.reject('E_NOT_ACTIVE');
  if (hours > remaining + 1e-9) return h.reject('E_SPEEDUP_TOO_LONG');
  if (hours > speedupLeftHours(h.state, action.playerId, def, h.ctx) + 1e-9) {
    return h.reject('E_SPEEDUP_BUDGET');
  }
  if (speedupPrice(h.state, action.playerId, hours, def, h.ctx) !== price) {
    return h.reject('E_PRICE_CHANGED');
  }
  if (!owner.hasten(h, action.playerId, ref, hours)) return h.reject('E_NOT_ACTIVE');
  recordSpeedup(h.state, action.playerId, hours, h.ctx);
  h.emit('queue.sped', { playerId: action.playerId, ...ref, hours, sovereigns: price });
}

function buyResources(action: Action, h: HandlerContext): void {
  const p = (action.payload ?? {}) as Record<string, unknown>;
  const { resource, hours, price } = p;
  if (typeof resource !== 'string' || typeof hours !== 'number' || !(hours > 0) || !Number.isFinite(hours) ||
    typeof price !== 'number' || !Number.isInteger(price) || price < 0) {
    return h.reject('E_BAD_PAYLOAD');
  }
  const player = h.state.players[action.playerId];
  if (!player) return h.reject('E_FORBIDDEN');
  const def = h.ctx.data.timeValue;
  if (!hasTimeValue(def)) return h.reject('E_NOT_AVAILABLE');
  if (h.state.match.goldActions === false) return h.reject('E_GOLD_OFF');
  const amount = Math.floor(resourceForHours(resource, hours, def));
  if (!Object.hasOwn(def.referenceHour, resource) || amount < 1) return h.reject('E_BAD_PAYLOAD');
  if (hours > speedupLeftHours(h.state, action.playerId, def, h.ctx) + 1e-9) {
    return h.reject('E_SPEEDUP_BUDGET');
  }
  if (speedupPrice(h.state, action.playerId, hours, def, h.ctx) !== price) {
    return h.reject('E_PRICE_CHANGED');
  }
  player.resources[resource] = (player.resources[resource] ?? 0) + amount;
  recordSpeedup(h.state, action.playerId, hours, h.ctx);
  h.emit('resources.bought', { playerId: action.playerId, resource, amount, hours, sovereigns: price });
}

function finish(action: Action, h: HandlerContext): void {
  const ref = readRef((action.payload ?? {}) as Record<string, unknown>);
  if (!ref) return h.reject('E_BAD_PAYLOAD');
  if (!h.state.players[action.playerId]) return h.reject('E_FORBIDDEN');
  const def = h.ctx.data.timeValue;
  const owner = ownerOf(h, ref);
  const remaining = owner?.remaining(h, action.playerId, ref) ?? null;
  if (!owner || remaining === null || !(remaining > 0)) return h.reject('E_NOT_ACTIVE');
  if (!finishesFree(remaining, def)) return h.reject('E_NOT_FREE');
  if (!owner.hasten(h, action.playerId, ref, remaining)) return h.reject('E_NOT_ACTIVE');
  h.emit('queue.sped', { playerId: action.playerId, ...ref, hours: remaining, sovereigns: 0, free: true });
}

export const speedupModule: GameModule = {
  id: 'speedup',
  // 1.1.0: `resources.buy` — ресурсы за ◆ из того же бюджета K (TEC-4).
  version: '1.1.0',
  setup(api) {
    api.onAction('queue.speedup', speedup);
    api.onAction('resources.buy', buyResources);
    api.onAction('queue.finish', finish);
  },
};
