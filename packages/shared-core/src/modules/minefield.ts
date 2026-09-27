/**
 * Минный заградитель (SM-3.4, фаза 3 `docs/ship-modules-roadmap.md`).
 *
 * Флот с модулем-заградителем (стат `mineCharge` > 0) ставит минное поле на узле, где
 * стоит. Враждебный флот, который входит на этот узел — конечной точкой или транзитом, —
 * теряет долю ТЕКУЩЕГО корпуса каждого стека, а поле тратит заряд. На нуле поле
 * снимается.
 *
 * **Доля, а не число урона.** Мины бьют так же, как цена отступления (`combat.ts`):
 * `(1 − доля) × пул`, корабли гибнут, когда пул больше не наполняет их корпуса. Поэтому
 * мины при любой доле < 1 не добивают флот до конца, и не нужен разбор последнего
 * корабля, героя на борту и десанта в трюме: флот всегда остаётся флотом.
 *
 * **Щит мины не держит**: снимается корпус. Иначе минное поле против щитовых корпусов
 * было бы пустым местом, а щит и без того отдыхает между боями.
 *
 * **Туман.** Поле видит только владелец (`visibleState`). О срабатывании узнают жертва
 * и тот, кто видит узел (`mines.triggered` несёт `owner` и `at`).
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Minefield, MinefieldState } from '../state/gameState';
import { hoursToMs } from '../action/types';
import { bestFleetStat, effectiveStats } from '../util/loadout';
import { isHostile } from '../util/combat';
import { requireOwnedIdleFleet } from '../util/fleet';

/** Стат заградителя: сколько срабатываний даёт одна постановка. */
export const MINE_CHARGE_STAT = 'mineCharge';
/** Стат заградителя: доля текущего корпуса каждого стека за одно срабатывание. */
export const MINE_HIT_STAT = 'mineHit';
/** Больше этого заряда одно поле одного владельца не копит, сколько ни ставь. */
export const MINEFIELD_MAX_CHARGE = 6;
/** Потолок суммарной доли за один вход, сколько бы полей ни стояло на узле. */
export const MINE_HIT_MAX = 0.5;
/** Перезарядка заградителя между постановками, в игровых часах. */
export const MINE_COOLDOWN_HOURS = 6;

function slice(h: HandlerContext): MinefieldState {
  return (h.state.minefields ??= { fields: {}, readyAt: {} });
}

/** Снять пустое: поле без заряда, узел без полей, весь срез без записей. */
function tidy(h: HandlerContext): void {
  const m = h.state.minefields;
  if (!m) return;
  for (const [node, byOwner] of Object.entries(m.fields)) {
    for (const [owner, f] of Object.entries(byOwner)) if (!(f.charge > 0)) delete byOwner[owner];
    if (Object.keys(byOwner).length === 0) delete m.fields[node];
  }
  if (Object.keys(m.fields).length === 0 && Object.keys(m.readyAt).length === 0)
    delete h.state.minefields;
}

/** Вход флота на узел: сработать враждебным полям. */
function trigger(h: HandlerContext, fleetId: string, at: string): void {
  const fleet = h.state.fleets[fleetId];
  const byOwner = h.state.minefields?.fields[at];
  if (!fleet || !byOwner) return;
  const by: string[] = [];
  let hit = 0;
  for (const [owner, field] of Object.entries(byOwner)) {
    if (!(field.charge > 0) || !isHostile(h, owner, fleet.owner)) continue;
    hit += field.hit;
    field.charge -= 1;
    by.push(owner);
  }
  if (by.length === 0) return;
  hit = Math.min(MINE_HIT_MAX, hit);
  const data = h.ctx.data;
  let lost = 0;
  if (hit > 0) {
    for (const stack of fleet.units) {
      const def = data.units[stack.unit];
      if (!def || !(stack.count > 0)) continue;
      const eff = effectiveStats(def, stack, data);
      const perHull = (eff.hp ?? 0) > 0 ? eff.hp! : 1;
      const newHull = (1 - hit) * (stack.hp ?? stack.count * perHull);
      const newCount = Math.ceil(newHull / perHull);
      if (!(newCount > 0) || newCount > stack.count) continue; // fail-secure: ни гибели флота, ни роста
      const died = stack.count - newCount;
      stack.count = newCount;
      stack.hp = newHull;
      if (stack.shieldHp !== undefined) {
        const perShield = eff.shield ?? 0;
        stack.shieldHp = Math.min(stack.shieldHp, newCount * perShield);
      }
      if (died > 0) {
        lost += died;
        h.emit('unit.died', {
          unit: stack.unit,
          count: died,
          at,
          owner: fleet.owner,
          fleetId,
          killedBy: by[0]!,
        });
      }
    }
    fleet.lastDamagedAt = h.ctx.now;
  }
  h.emit('mines.triggered', { fleetId, at, owner: fleet.owner, by, hit, lost });
  tidy(h);
}

export const minefieldModule: GameModule = {
  id: 'minefield',
  version: '1.0.0',
  setup(api) {
    api.onAction('fleet.layMines', (action, h) => {
      const { fleetId } = action.payload as { fleetId?: unknown };
      if (typeof fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      // Свой стоящий флот: не в пути, не на полосе, не в бою (`E_NO_FLEET` / `E_FLEET_BUSY`).
      const fleet = requireOwnedIdleFleet(h, fleetId, action.playerId);
      const data = h.ctx.data;
      const charge = Math.floor(bestFleetStat(fleet.units, MINE_CHARGE_STAT, data));
      const hit = bestFleetStat(fleet.units, MINE_HIT_STAT, data);
      if (!(charge > 0) || !(hit > 0)) return h.reject('E_NO_MINELAYER');
      const m = slice(h);
      if ((m.readyAt[fleetId] ?? 0) > h.ctx.now) return h.reject('E_MINES_COOLDOWN');

      const node = (m.fields[fleet.location] ??= {});
      const prev: Minefield | undefined = node[fleet.owner];
      node[fleet.owner] = {
        charge: Math.min(MINEFIELD_MAX_CHARGE, (prev?.charge ?? 0) + charge),
        hit: Math.max(prev?.hit ?? 0, hit),
      };
      m.readyAt[fleetId] = h.ctx.now + hoursToMs(h.ctx, MINE_COOLDOWN_HOURS);
      h.emit('mines.laid', {
        fleetId,
        at: fleet.location,
        owner: fleet.owner,
        charge: node[fleet.owner]!.charge,
      });
    });

    // Вход на узел: конечная точка (`fleet.arrived`) и промежуточный узел маршрута
    // (`fleet.transit`) — транзит поле не проскакивает.
    for (const type of ['fleet.arrived', 'fleet.transit'])
      api.on(type, (event, h) => {
        const { fleetId, at } = (event.payload ?? {}) as { fleetId?: unknown; at?: unknown };
        if (typeof fleetId === 'string' && typeof at === 'string') trigger(h, fleetId, at);
      });

    // Перезарядка погибшего или отработавшего флота больше ничего не значит — чистим,
    // чтобы запись не жила в состоянии вечно.
    api.on('time.advanced', (_event, h) => {
      const m = h.state.minefields;
      if (!m) return;
      for (const [fleetId, at] of Object.entries(m.readyAt))
        if (at <= h.ctx.now || !h.state.fleets[fleetId]) delete m.readyAt[fleetId];
      tidy(h);
    });
  },
};
