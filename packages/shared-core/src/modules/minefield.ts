/**
 * Минный заградитель (SM-3.4) и мина как неподвижный отряд (SM-3.6).
 *
 * Флот с модулем-заградителем (стат `mineCharge` > 0) ставит мину за 15 минут на узле или
 * в точке дороги. Встав, мина становится ОТРЯДОМ во `fleets` (решение владельца 2026-09-30:
 * «мина по сущности тоже неподвижный космический юнит. Можно так же его выделить и
 * прочитать характеристики»): юнит `mine`, в стеке `count` — заряды, модули стека — боевая
 * часть заградителя, её `mineHit`. Карточку, удар челноков и туман мина получает теми же
 * путями, что любой флот, а своё у неё — только подрыв и скрытность.
 *
 * **Подрыв — встреча вплотную, как с обычным космическим юнитом.** Враждебный флот,
 * вошедший на узел мины (`fleet.arrived` / `fleet.transit`), встретивший её на дороге
 * (`fleet.intercept` / `fleet.meet` — те же встречи, что назначает модуль перехвата для
 * любых флотов) или атаковавший её приказом (`mine.contact` от `fleet.engage`), теряет долю
 * ТЕКУЩЕГО корпуса каждого космического стека; мина тратит заряд. Боя нет, и флот летит
 * дальше: мина — ловушка, а не стена (решение владельца 2026-09-30). Бой с миной не
 * заводит модуль боя — он её не видит противником.
 *
 * **Доля, а не число урона.** Мины бьют так же, как цена отступления (`combat.ts`):
 * `(1 − доля) × пул`, корабли гибнут, когда пул больше не наполняет их корпуса. Поэтому
 * мины при любой доле < 1 не добивают флот до конца, и не нужен разбор последнего
 * корабля, героя на борту и десанта в трюме: флот всегда остаётся флотом.
 *
 * **Только корабли** (решение владельца 2026-09-30: «мина наносит урон только космическим
 * кораблям»): десант в трюме и челноки в ангаре не страдают. **Щит мины не держит**:
 * снимается корпус.
 *
 * **Челноки уничтожают мину безопасно** — обычным ударом по корпусу: оружия у мины нет,
 * ответки нет. Это даёт сам удар челноков по флоту, здесь для этого кода нет.
 *
 * **Туман** — `state/minefields.ts` (`mineFleetVisible`): чужую мину видно только своим
 * флотом в пределах 24.
 */
import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet, MinelayingJob, MinefieldState, UnitStack } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { hoursToMs } from '../action/types';
import { effectiveStats } from '../util/loadout';
import { loadoutKey } from '../util/stacks';
import {
  INTERCEPT_TOL,
  isHostile,
  laneOccupancy,
  posAt,
  trunkOccupancies,
  trunkPosAt,
} from '../util/combat';
import { nextFleetSeq, requireOwnedUnengagedFleet } from '../util/fleet';
import { fleetPositionAt, fleetNodeAt } from '../state/fleetPosition';
import { isCorridorEdge } from '../state/corridor';
import { isMineFleet, MINE_INSTALL_HOURS, MINE_UNIT } from '../state/minefields';

/** Стат заградителя: сколько срабатываний даёт одна постановка. */
export const MINE_CHARGE_STAT = 'mineCharge';
/** Стат заградителя: доля текущего корпуса каждого стека за одно срабатывание. */
export const MINE_HIT_STAT = 'mineHit';
/** Больше этого заряда одна мина одного владельца не копит, сколько ни ставь. */
export const MINEFIELD_MAX_CHARGE = 6;
/** Потолок суммарной доли за один вход, сколько бы мин ни стояло на узле. */
export const MINE_HIT_MAX = 0.5;
/** Перезарядка заградителя между постановками, в игровых часах. */
export const MINE_COOLDOWN_HOURS = 6;

function slice(h: HandlerContext): MinefieldState {
  return (h.state.minefields ??= { readyAt: {} });
}

/** Снять пустой срез: без перезарядок и установок записи нет. */
function tidy(h: HandlerContext): void {
  const m = h.state.minefields;
  if (!m) return;
  if (m.installations && !Object.keys(m.installations).length) delete m.installations;
  if (m.ownerReadyAt && !Object.keys(m.ownerReadyAt).length) delete m.ownerReadyAt;
  if (m.struck && !Object.keys(m.struck).length) delete m.struck;
  if (!Object.keys(m.readyAt).length && !m.installations && !m.ownerReadyAt && !m.struck) delete h.state.minefields;
}

/** `mineHit` стека — доля, которую снимает один его заряд. */
function hitOf(stack: UnitStack, data: GameData): number {
  const def = data.units[stack.unit];
  return def && stack.count > 0 ? (effectiveStats(def, stack, data)[MINE_HIT_STAT] ?? 0) : 0;
}

/**
 * Стек мин, который поставит флот: боевая часть — модули заградителя того стека, чей
 * `mineHit` выше. Берутся ТОЛЬКО модули мин: остальное снаряжение носителя (щит, пушки)
 * мине не передаётся — иначе она получила бы корабельные статы. Нет заградителя → `null`.
 */
function mineStackOf(fleet: Fleet, data: GameData): UnitStack | null {
  let best: { stack: UnitStack; hit: number; charge: number } | null = null;
  for (const st of fleet.units) {
    const def = data.units[st.unit];
    if (!def || !(st.count > 0)) continue;
    const eff = effectiveStats(def, st, data);
    const charge = Math.floor(eff[MINE_CHARGE_STAT] ?? 0);
    const hit = eff[MINE_HIT_STAT] ?? 0;
    if (!(charge > 0) || !(hit > 0)) continue;
    if (!best || hit > best.hit || (hit === best.hit && charge > best.charge)) best = { stack: st, hit, charge };
  }
  if (!best) return null;
  const mods = (best.stack.modules ?? []).filter((id) => {
    const stats = data.modules[id]?.effects.stats ?? {};
    return (stats[MINE_HIT_STAT] ?? 0) > 0 || (stats[MINE_CHARGE_STAT] ?? 0) > 0;
  });
  const only = <T>(rec: Record<string, T> | undefined): Record<string, T> | undefined => {
    const out = Object.fromEntries(mods.filter((id) => rec?.[id] !== undefined).map((id) => [id, rec![id]!]));
    return Object.keys(out).length ? out : undefined;
  };
  const stars = only(best.stack.moduleStars);
  const rarity = only(best.stack.moduleRarity);
  return {
    unit: MINE_UNIT,
    count: Math.min(MINEFIELD_MAX_CHARGE, best.charge),
    ...(mods.length ? { modules: mods } : {}),
    ...(stars ? { moduleStars: stars } : {}),
    ...(rarity ? { moduleRarity: rarity } : {}),
  };
}

/** Та же точка: узел — узел, точка дороги — та же дорога и та же доля (в любую сторону). */
function samePlace(f: Fleet, job: MinelayingJob): boolean {
  if (job.location !== null) return f.location === job.location && !f.edge;
  const e = f.edge, j = job.edge;
  if (f.location !== null || !e || !j) return false;
  if (e.from === j.from && e.to === j.to) return Math.abs(e.t - j.t) < 1e-9;
  return e.from === j.to && e.to === j.from && Math.abs(1 - e.t - j.t) < 1e-9;
}

/** Та же боевая часть — стеки складываются в один. */
const sameWarhead = (a: UnitStack, b: UnitStack): boolean =>
  a.unit === b.unit && a.hp === undefined && b.hp === undefined &&
  loadoutKey(a.modules) === loadoutKey(b.modules) &&
  JSON.stringify(a.moduleStars ?? {}) === JSON.stringify(b.moduleStars ?? {}) &&
  JSON.stringify(a.moduleRarity ?? {}) === JSON.stringify(b.moduleRarity ?? {});

/** Поставить мину: добавить заряды своей мине в той же точке или завести новый отряд.
 *  `created` — отряд новый: только о нём модулю перехвата есть что сказать. */
function placeMine(h: HandlerContext, job: MinelayingJob): { mine: Fleet; created: boolean } {
  // Заряды вливаются только в отряд таких же мин. Ракетная мина в той же точке — тоже
  // мина-отряд (SM-3.7a), но с чужим стеком она перестала бы быть ракетной и замолчала
  // навсегда (замечание Codex на #1499).
  const own = Object.keys(h.state.fleets).sort()
    .map((id) => h.state.fleets[id]!)
    .find((f) => f.owner === job.owner && !f.movement && isMineFleet(f, h.ctx.data) && samePlace(f, job) &&
      f.units.every((st) => st.unit === job.stack.unit));
  if (own) {
    const match = own.units.find((st) => sameWarhead(st, job.stack));
    if (match) match.count += job.stack.count;
    else own.units.push({ ...job.stack });
    // Заряды сверх потолка срезаются с конца: новое не вытесняет уже стоящее.
    let room = MINEFIELD_MAX_CHARGE;
    for (const st of own.units) {
      st.count = Math.min(st.count, room);
      room -= st.count;
    }
    own.units = own.units.filter((st) => st.count > 0);
    return { mine: own, created: false };
  }
  const id = `fleet:mine:${job.owner}:${h.ctx.now}:${nextFleetSeq(h.state)}`;
  const mine: Fleet = {
    id,
    owner: job.owner,
    location: job.location,
    movement: null,
    ...(job.edge ? { edge: { ...job.edge } } : {}),
    units: [{ ...job.stack }],
    landing: [],
    traits: [],
    battleId: null,
  };
  h.state.fleets[id] = mine;
  return { mine, created: true };
}

/** Снять одну мину со стека: заряд потрачен, корпус урезан под оставшиеся. */
function spendCharge(stack: UnitStack, data: GameData): void {
  stack.count -= 1;
  if (stack.hp === undefined) return;
  const def = data.units[stack.unit];
  const perHull = def ? (effectiveStats(def, stack, data).hp ?? 0) : 0;
  stack.hp = Math.min(stack.hp, Math.max(0, stack.count) * perHull);
}

/** Урон подрыва по КОСМИЧЕСКИМ стекам флота: доля текущего корпуса, мимо щита. */
function damageShips(h: HandlerContext, fleet: Fleet, hit: number, at: string, by: string): number {
  const data = h.ctx.data;
  let lost = 0;
  for (const stack of fleet.units) {
    const def = data.units[stack.unit];
    if (!def || def.domain !== 'space' || !(stack.count > 0)) continue;
    const eff = effectiveStats(def, stack, data);
    const perHull = (eff.hp ?? 0) > 0 ? eff.hp! : 1;
    const newHull = (1 - hit) * (stack.hp ?? stack.count * perHull);
    const newCount = Math.ceil(newHull / perHull);
    if (!(newCount > 0) || newCount > stack.count) continue; // fail-secure: ни гибели флота, ни роста
    const died = stack.count - newCount;
    stack.count = newCount;
    stack.hp = newHull;
    if (stack.shieldHp !== undefined) stack.shieldHp = Math.min(stack.shieldHp, newCount * (eff.shield ?? 0));
    if (died > 0) {
      lost += died;
      h.emit('unit.died', { unit: stack.unit, count: died, at, owner: fleet.owner, fleetId: fleet.id, killedBy: by });
    }
  }
  fleet.lastDamagedAt = h.ctx.now;
  return lost;
}

/**
 * Подрыв: флот `victimId` вошёл вплотную в мины `mineIds`. Каждая враждебная мина тратит
 * один заряд самой сильной боевой части; доли складываются до потолка `MINE_HIT_MAX`.
 * Мина без зарядов снимается с карты: `fleet.destroyed` с пометкой `spent` — отряд ушёл,
 * но это не потеря, и журнал не объявляет гибель флота после уже объявленного подрыва.
 */
function detonate(h: HandlerContext, victimId: string, mineIds: readonly string[]): void {
  const data = h.ctx.data;
  const victim = h.state.fleets[victimId];
  if (!victim || isMineFleet(victim, data) || !victim.units.some((s) => s.count > 0)) return;
  const by: string[] = [];
  const spent: string[] = [];
  let hit = 0;
  for (const id of [...new Set(mineIds)].sort()) {
    const mine = h.state.fleets[id];
    if (!mine || mine.id === victim.id || !isMineFleet(mine, data) || !isHostile(h, mine.owner, victim.owner)) continue;
    let best: UnitStack | undefined;
    for (const st of mine.units) if (hitOf(st, data) > (best ? hitOf(best, data) : 0)) best = st;
    if (!best) continue;
    hit += hitOf(best, data);
    spendCharge(best, data);
    if (!by.includes(mine.owner)) by.push(mine.owner);
    spent.push(mine.id);
  }
  if (spent.length === 0) return;
  hit = Math.min(MINE_HIT_MAX, hit);
  const first = h.state.fleets[spent[0]!]!;
  const at = first.location ?? fleetNodeAt(h.state, first, h.ctx.now) ?? '';
  const position = fleetPositionAt(h.state, first, h.ctx.now);
  const lost = hit > 0 ? damageShips(h, victim, hit, at, by[0]!) : 0;
  h.emit('mines.triggered', { fleetId: victimId, at, ...(position ? { position } : {}), owner: victim.owner, by, hit, lost, mines: spent });
  for (const id of spent) {
    const mine = h.state.fleets[id];
    if (!mine) continue;
    mine.units = mine.units.filter((st) => st.count > 0);
    if (mine.units.length > 0) continue;
    h.emit('fleet.destroyed', { fleetId: id, owner: mine.owner, spent: true });
    delete h.state.fleets[id];
  }
}

/** Та же точка дороги у двух стоящих отрядов: та же дорога и та же доля (в любую сторону). */
/** Одна ли это ФИЗИЧЕСКАЯ точка дороги. Сравниваются координаты, а не записи рёбер: мины в
 *  ромбе развилки стоят на разных лейнах тропы, но в одной точке общего ствола, и встречи с
 *  ними перехват назначает одновременно (замечание Codex на #1414). */
function sameRoadPoint(h: HandlerContext, a: Fleet, b: Fleet): boolean {
  if (a.location !== null || b.location !== null || !a.edge || !b.edge) return false;
  const pa = fleetPositionAt(h.state, a, h.ctx.now);
  const pb = fleetPositionAt(h.state, b, h.ctx.now);
  return !!pa && !!pb && Math.abs(pa.x - pb.x) < 1e-6 && Math.abs(pa.y - pb.y) < 1e-6;
}

/**
 * Подрыв на дороге: флот `victimId` сошёлся с миной `mineId`. Срабатывают ВСЕ мины этой
 * точки дороги разом — как на узле, с одним потолком `MINE_HIT_MAX` на вход. Встреч с
 * ними модуль перехвата назначил по одной на пару; первая в этот момент подрывает всё,
 * остальные уже не находят, что взрывать (ревью #1411: доли разных владельцев
 * применялись по очереди к уменьшенному корпусу, и потолок считался на каждую отдельно).
 */
function detonateOnRoad(h: HandlerContext, victimId: string, mineId: string): void {
  const m = slice(h);
  if (m.struck?.[victimId] === h.ctx.now) {
    tidy(h);
    return;
  }
  const hit = h.state.fleets[mineId];
  if (!hit) return;
  const mines = Object.keys(h.state.fleets).sort().filter((id) => {
    const f = h.state.fleets[id]!;
    return id === mineId || (isMineFleet(f, h.ctx.data) && sameRoadPoint(h, f, hit));
  });
  (m.struck ??= {})[victimId] = h.ctx.now;
  detonate(h, victimId, mines);
}

/**
 * Мина и другой флот встретились — вернуть пару «жертва, мина», если это она.
 *
 * Флот, который в эту секунду ОТЪЕЗЖАЕТ от точки мины, с ней не сталкивается: он уже
 * подорвался, когда встал на неё, а встреча «в точке старта» — это отъезд, а не удар.
 */
function mineAndVictim(h: HandlerContext, a: string, b: string): { victim: string; mine: string } | null {
  const fa = h.state.fleets[a];
  const fb = h.state.fleets[b];
  if (!fa || !fb) return null;
  const ma = isMineFleet(fa, h.ctx.data);
  const mb = isMineFleet(fb, h.ctx.data);
  if (ma === mb) return null; // две мины не встречаются; два флота — не наш случай
  const pair = ma ? { victim: b, mine: a } : { victim: a, mine: b };
  if (h.state.fleets[pair.victim]!.movement?.departedAt === h.ctx.now) return null;
  return pair;
}

export const minefieldModule: GameModule = {
  id: 'minefield',
  // 2.0.0: мина — неподвижный отряд; подрыв при встрече, флот летит дальше (SM-3.6).
  // 2.1.0: ревью #1411 — мина не ставит мины; мины одной точки дороги срабатывают одним
  // подрывом с общим потолком; пополнение не назначает вторую встречу.
  // 2.2.0: заряды не вливаются в ракетную мину той же точки — она тоже отряд (SM-3.7a).
  version: '2.2.0',
  setup(api) {
    api.onAction('fleet.layMines', (action, h) => {
      const { fleetId } = (action.payload ?? {}) as { fleetId?: unknown };
      if (typeof fleetId !== 'string') return h.reject('E_BAD_PAYLOAD');
      // Свой стоящий флот: не в пути, не на полосе, не в бою (`E_NO_FLEET` / `E_FLEET_BUSY`).
      const fleet = requireOwnedUnengagedFleet(h, fleetId, action.playerId);
      const edge = fleet.edge;
      if (fleet.movement || (fleet.location === null && (!edge || !(edge.t > 0 && edge.t < 1) ||
        !h.state.planets[edge.from]?.links?.includes(edge.to) || isCorridorEdge(h.state, edge.from, edge.to)))) return h.reject('E_FLEET_BUSY');
      const stack = mineStackOf(fleet, h.ctx.data);
      if (!stack) return h.reject('E_NO_MINELAYER');
      const m = slice(h);
      if (Math.max(m.readyAt[fleetId] ?? 0, m.ownerReadyAt?.[fleet.owner] ?? 0) > h.ctx.now) return h.reject('E_MINES_COOLDOWN');
      if (!fleetPositionAt(h.state, fleet, h.ctx.now)) return h.reject('E_FLEET_BUSY');

      const readyAt = h.ctx.now + hoursToMs(h.ctx, MINE_INSTALL_HOURS);
      (m.installations ??= {})[fleetId] = {
        owner: fleet.owner,
        readyAt,
        location: fleet.location,
        ...(fleet.location === null && edge ? { edge: { ...edge } } : {}),
        stack,
      };
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
      const layer = h.state.fleets[fleetId];
      // Носитель на месте, свободен и всё ещё несёт заградитель — иначе установка сорвана.
      const stillThere = !!layer && layer.owner === job.owner && !layer.movement && !layer.battleId &&
        (job.location !== null
          ? layer.location === job.location
          : !!layer.edge && !!job.edge && layer.edge.from === job.edge.from && layer.edge.to === job.edge.to &&
            Math.abs(layer.edge.t - job.edge.t) < 1e-9);
      if (!stillThere || !mineStackOf(layer, h.ctx.data)) {
        tidy(h);
        return;
      }
      const { mine, created } = placeMine(h, job);
      const charge = mine.units.reduce((n, st) => n + st.count, 0);
      const position = fleetPositionAt(h.state, mine, h.ctx.now);
      h.emit('mines.laid', { owner: job.owner, fleetId: mine.id, at: job.location ?? job.edge!.from, ...(position ? { position } : {}), charge });
      // Мина на дороге — стоящая точка для модуля перехвата: он назначит встречу каждому,
      // кто идёт по этой дороге, как с любым стоящим на ней флотом. Только НОВАЯ: у
      // пополненной встречи уже назначены, и повтор дал бы второй подрыв за один проход
      // (ревью #1411).
      if (created && mine.edge) h.emit('fleet.parked', { fleetId: mine.id, edge: mine.edge });
      tidy(h);
    });

    // Движение носителя срывает установку.
    api.on('fleet.leg', (event, h) => {
      const { fleetId } = event.payload as { fleetId: string };
      const m = h.state.minefields;
      if (m?.installations) delete m.installations[fleetId];
      tidy(h);
    });

    // Вход на узел: конечная точка (`fleet.arrived`) и промежуточный узел маршрута
    // (`fleet.transit`) — транзит мину не проскакивает.
    for (const type of ['fleet.arrived', 'fleet.transit'])
      api.on(type, (event, h) => {
        const { fleetId, at } = (event.payload ?? {}) as { fleetId?: unknown; at?: unknown };
        if (typeof fleetId !== 'string' || typeof at !== 'string') return;
        const mines = Object.keys(h.state.fleets).sort().filter((id) => {
          const f = h.state.fleets[id]!;
          return f.location === at && !f.edge && isMineFleet(f, h.ctx.data);
        });
        if (mines.length) detonate(h, fleetId, mines);
      });

    // Встреча на дороге — те же `fleet.intercept` / `fleet.meet`, что модуль перехвата
    // назначает любым флотам. Проверяем встречу в момент срабатывания тем же правилом,
    // что бой: оба на месте и в одной точке, иначе встреча устарела.
    api.on('fleet.intercept', (event, h) => {
      const { a, b } = event.payload as { a: string; b: string };
      const pair = mineAndVictim(h, a, b);
      if (!pair) return;
      const oa = laneOccupancy(h.state.fleets[a]!);
      const ob = laneOccupancy(h.state.fleets[b]!);
      if (!oa || !ob || oa.lo !== ob.lo || oa.hi !== ob.hi) return;
      if (Math.abs(posAt(oa, h.ctx.now) - posAt(ob, h.ctx.now)) > INTERCEPT_TOL) return;
      detonateOnRoad(h, pair.victim, pair.mine);
    });
    api.on('fleet.meet', (event, h) => {
      const { a, b, trunk } = event.payload as { a: string; b: string; trunk: string };
      const pair = mineAndVictim(h, a, b);
      if (!pair) return;
      const oa = trunkOccupancies(h.state, h.state.fleets[a]!).find((o) => o.key === trunk);
      const ob = trunkOccupancies(h.state, h.state.fleets[b]!).find((o) => o.key === trunk);
      if (!oa || !ob) return;
      if (Math.abs(trunkPosAt(oa, h.ctx.now) - trunkPosAt(ob, h.ctx.now)) > INTERCEPT_TOL) return;
      detonateOnRoad(h, pair.victim, pair.mine);
    });

    // Корабли атаковали мину приказом (`fleet.engage`): вплотную — значит, подрыв по ним.
    api.on('mine.contact', (event, h) => {
      const { fleetId, mines } = (event.payload ?? {}) as { fleetId?: unknown; mines?: unknown };
      if (typeof fleetId !== 'string' || !Array.isArray(mines)) return;
      detonate(h, fleetId, mines.filter((x): x is string => typeof x === 'string'));
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
      for (const [fleetId, at] of Object.entries(m.struck ?? {}))
        if (at < h.ctx.now) delete m.struck![fleetId];
      tidy(h);
    });
  },
};
