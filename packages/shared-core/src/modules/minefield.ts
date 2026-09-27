/**
 * Минный заградитель (SM-3.4, фаза 3 `docs/ship-modules-roadmap.md`).
 *
 * Флот с модулем-заградителем (стат `mineCharge` > 0) ставит минное поле за 15 минут на узле или
 * в точке дороги. Враждебный флот, который пересекает эту точку или входит на узел,
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
 * **Туман.** Владелец видит свои поля; остальные — только с расстояния до 24.
 * Сигнатура минимальна. Таймеры установки и пересечения остаются приватными.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Minefield, MinefieldState } from '../state/gameState';
import { hoursToMs } from '../action/types';
import { bestFleetStat, effectiveStats } from '../util/loadout';
import { isHostile } from '../util/combat';
import { requireOwnedUnengagedFleet } from '../util/fleet';
import { fleetPositionAt, fleetNodeAt } from '../state/fleetPosition';
import { isCorridorEdge } from '../state/corridor';
import { fieldPosition, fieldRoadT, MINE_INSTALL_HOURS } from '../state/minefields';

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
  if (Object.keys(m.fields).length === 0 && Object.keys(m.readyAt).length === 0 && !Object.keys(m.installations ?? {}).length && !Object.keys(m.ownerReadyAt ?? {}).length)
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
          at: h.state.planets[at] ? at : fleetNodeAt(h.state, fleet, h.ctx.now) ?? at,
          owner: fleet.owner,
          fleetId,
          killedBy: by[0]!,
        });
      }
    }
    fleet.lastDamagedAt = h.ctx.now;
  }
  const position = Object.values(byOwner).map((f) => fieldPosition(h.state, at, f)).find((p) => p !== null);
  h.emit('mines.triggered', { fleetId, at, position, owner: fleet.owner, by, hit, lost });
  tidy(h);
}

/** Exact crossing time, so a fast ship cannot jump over a mine between scans. */
function scheduleCrossing(h: HandlerContext, fleetId: string, key: string): void {
  const fleet = h.state.fleets[fleetId];
  const field = Object.values(h.state.minefields?.fields[key] ?? {}).find((f) => f.edge);
  const mv = fleet?.movement;
  if (!fleet || !field?.position || !mv || isCorridorEdge(h.state, mv.from, mv.to)) return;
  const t = fieldRoadT(h.state, mv.from, mv.to, field.position);
  const start = mv.startT ?? 0, end = mv.endT ?? 1;
  if (t === null || end === start) return;
  const fraction = (t - start) / (end - start);
  if (fraction <= 0 || fraction > 1) return;
  const at = Math.ceil(mv.departedAt + fraction * (mv.arrivesAt - mv.departedAt));
  if (at < h.ctx.now) return;
  const payload = { fleetId, key, departedAt: mv.departedAt, arrivesAt: mv.arrivesAt, from: mv.from, to: mv.to };
  if (h.state.scheduled.some((e) => e.type === 'mines.crossed' && e.at === at && JSON.stringify(e.payload) === JSON.stringify(payload))) return;
  h.schedule(at, 'mines.crossed', payload);
}

export const minefieldModule: GameModule = {
  id: 'minefield',
  version: '1.1.0',
  setup(api) {
    api.onAction('fleet.layMines', (action, h) => {
      const { fleetId } = (action.payload ?? {}) as { fleetId?: unknown };
      if (typeof fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      // Свой стоящий флот: не в пути, не на полосе, не в бою (`E_NO_FLEET` / `E_FLEET_BUSY`).
      const fleet = requireOwnedUnengagedFleet(h, fleetId, action.playerId);
      const edge = fleet.edge;
      if (fleet.movement || (fleet.location === null && (!edge || !(edge.t > 0 && edge.t < 1) ||
        !h.state.planets[edge.from]?.links?.includes(edge.to) || isCorridorEdge(h.state, edge.from, edge.to)))) return h.reject('E_FLEET_BUSY');
      const data = h.ctx.data;
      const charge = Math.floor(bestFleetStat(fleet.units, MINE_CHARGE_STAT, data));
      const hit = bestFleetStat(fleet.units, MINE_HIT_STAT, data);
      if (!(charge > 0) || !(hit > 0)) return h.reject('E_NO_MINELAYER');
      const m = slice(h);
      if (Math.max(m.readyAt[fleetId] ?? 0, m.ownerReadyAt?.[fleet.owner] ?? 0) > h.ctx.now) return h.reject('E_MINES_COOLDOWN');

      const pos = fleetPositionAt(h.state, fleet, h.ctx.now);
      if (!pos) return h.reject('E_FLEET_BUSY');
      const key = fleet.location ?? `road:${pos.x}:${pos.y}`;
      const field: Minefield = { charge: Math.min(MINEFIELD_MAX_CHARGE, charge), hit,
        position: { ...pos }, ...(fleet.location === null && edge ? { edge: { ...edge } } : {}) };
      const readyAt = h.ctx.now + hoursToMs(h.ctx, MINE_INSTALL_HOURS);
      (m.installations ??= {})[fleetId] = { key, owner: fleet.owner, readyAt, field };
      h.schedule(readyAt, 'mines.armed', { fleetId, readyAt });
      m.readyAt[fleetId] = h.ctx.now + hoursToMs(h.ctx, MINE_COOLDOWN_HOURS);
      (m.ownerReadyAt ??= {})[fleet.owner] = m.readyAt[fleetId]!;
      h.emit('mines.installing', { fleetId, owner: fleet.owner, readyAt });
    });

    api.on('mines.armed', (event, h) => {
      const { fleetId, readyAt } = event.payload as { fleetId: string; readyAt: number };
      const m = h.state.minefields;
      const job = m?.installations?.[fleetId];
      if (!m || !job || job.readyAt !== readyAt) return;
      delete m.installations![fleetId];
      const { key, owner, field } = job;
      const fleet = h.state.fleets[fleetId];
      const at = fleet && fleetPositionAt(h.state, fleet, h.ctx.now);
      const pos = fieldPosition(h.state, key, field);
      if (!fleet || fleet.owner !== owner || fleet.movement || fleet.battleId || !at || !pos ||
        (at.x - pos.x) ** 2 + (at.y - pos.y) ** 2 > 1e-8 || bestFleetStat(fleet.units, MINE_CHARGE_STAT, h.ctx.data) < 1) {
        tidy(h); return;
      }
      const byOwner = (m.fields[key] ??= {});
      const prev = byOwner[owner];
      byOwner[owner] = { ...field, charge: Math.min(MINEFIELD_MAX_CHARGE, field.charge + (prev?.charge ?? 0)),
        hit: Math.max(field.hit, prev?.hit ?? 0) };
      h.emit('mines.laid', { owner, at: key, position: pos, charge: byOwner[owner]!.charge });
      if (field.edge) for (const f of Object.values(h.state.fleets)) scheduleCrossing(h, f.id, key);
    });
    api.on('fleet.leg', (event, h) => {
      const { fleetId } = event.payload as { fleetId: string };
      const m = h.state.minefields;
      if (m?.installations) delete m.installations[fleetId];
      for (const key of Object.keys(m?.fields ?? {})) scheduleCrossing(h, fleetId, key);
      tidy(h);
    });
    api.on('mines.crossed', (event, h) => {
      const p = event.payload as { fleetId: string; key: string; departedAt: number; arrivesAt: number; from: string; to: string };
      const fleet = h.state.fleets[p.fleetId];
      const mv = fleet?.movement;
      const sameLeg = mv && mv.departedAt === p.departedAt && mv.arrivesAt === p.arrivesAt && mv.from === p.from && mv.to === p.to;
      if (!sameLeg) {
        // Arrival can run first at a partial leg endpoint (park or shared-road fork).
        // Accept only the actual endpoint at the original arrival instant, not a stale route.
        const pos = fleet && fleetPositionAt(h.state, fleet, h.ctx.now);
        const field = Object.values(h.state.minefields?.fields[p.key] ?? {})[0];
        const mine = field && fieldPosition(h.state, p.key, field);
        if (p.arrivesAt !== h.ctx.now || !pos || !mine || (pos.x - mine.x) ** 2 + (pos.y - mine.y) ** 2 > 1e-8) return;
      }
      trigger(h, p.fleetId, p.key);
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
      for (const [owner, at] of Object.entries(m.ownerReadyAt ?? {}))
        if (at <= h.ctx.now) delete m.ownerReadyAt![owner];
      tidy(h);
    });
  },
};
