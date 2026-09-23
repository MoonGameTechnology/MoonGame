import type { GameModule, HandlerContext } from '../kernel/module';
import type { Fleet, FleetEdge, GameState, PlayerId, PlanetId } from '../state/gameState';
import { hoursToMs } from '../action/types';
import { legT } from '../state/fleetPosition';
import { fleetTravelSpeed, planRoute, routeDistance } from '../state/route';
import { forkAt, forkTAtStart, laneRoadLength, legEndT, snapToFork } from '../state/roads';
import { corridorVeto, isCorridorEdge } from '../state/corridor';
import { getStance } from '../state/diplomacy';

/**
 * Контракт возможности `fleet.course` (RETR-1): «дай этому флоту курс на узел».
 * Предоставляет модуль движения, потребляет модуль боя — так отступление уводит флот,
 * не заводя второй маршрутизатор. Возвращает код отказа строкой или `null` при успехе;
 * владение флотом проверяется внутри, потому что вызывающий приходит со своей дверью.
 */
export type FleetCourse = (
  args: { fleetId: string; to: PlanetId; playerId: PlayerId },
  h: HandlerContext,
) => string | null;

/** A target a `fleet.move` can aim at: a node, or a continuous point on a lane. */
interface MovePayload {
  fleetId: string;
  /** Destination node. */
  to?: string;
  /** Destination point ON a lane (continuous position) — the army stops partway
   *  down the road, Bytro-style, instead of at a node. */
  toEdge?: { from: string; to: string; t: number };
}

/** A planned journey, ready for `beginLeg`: the first leg runs `fromId`→`hops[0]`
 *  (starting at fraction `startT`), then each hop in turn; the LAST leg parks at
 *  `parkT` (<1) instead of reaching its node. */
interface Journey {
  fromId: PlanetId;
  hops: PlanetId[];
  startT: number;
  parkT: number;
}

/** Below this, a fraction is treated as a node (avoids degenerate parked edges). */
const EPS = 1e-4;

/**
 * Lazily-built route cache. The map topology (planet positions + links) is mostly
 * static, so each (from, to) node pair is computed once with Dijkstra and served
 * from the cache — keyed by `state.topology` so a hero temp lane (which mutates
 * `links`) bumps the version and invalidates stale routes.
 */
class RouteCache {
  private readonly cache = new Map<string, PlanetId[] | null>();

  lookup(state: GameState, from: PlanetId, to: PlanetId): PlanetId[] | null {
    // Key includes the topology version: a hero opening/closing a temp lane bumps it,
    // so stale routes computed before the link change are never served.
    const key = `${state.topology ?? 0}\0${from}\0${to}`;
    if (this.cache.has(key)) {
      const cached = this.cache.get(key)!;
      return cached ? [...cached] : null;
    }
    const result = planRoute(state, from, to);
    this.cache.set(key, result);
    return result ? [...result] : null;
  }
}

/** True when any hop enters territory its mover is at PEACE with (D2 gate predicate). */
function crossesPeace(state: GameState, playerId: string, hops: readonly PlanetId[]): boolean {
  for (const hop of hops) {
    const owner = state.planets[hop]?.owner ?? null;
    if (owner !== null && owner !== playerId && getStance(state, playerId, owner) === 'peace') {
      return true;
    }
  }
  return false;
}

/** Euclidean length of the lane between two nodes (0 if either is missing). */
/** Length of the lane's ROAD (ROADS-2) — forks and the crossing included; the straight
 *  line where the lane has no road. Every fraction a leg carries (`startT`, `endT`, a
 *  parked `t`) is a share of THIS length, so time, position and interception agree. */
function laneLength(state: GameState, a: PlanetId, b: PlanetId): number {
  return laneRoadLength(state, a, b);
}

/**
 * Starts a leg of a journey: the fleet travels `fromId`→`hops[0]` along the
 * sub-segment [`startT`, endT] of that lane, where endT = `parkT` when this is
 * the final hop (so the journey ends at a point on the lane) else 1. Schedules
 * the leg's arrival. Returns false if the leg cannot start (no nodes, or speed 0).
 */
function beginLeg(
  h: HandlerContext,
  fleet: Fleet,
  fromId: PlanetId,
  hops: PlanetId[],
  startT: number,
  parkT: number,
): boolean {
  const nextHop = hops[0];
  const origin = h.state.planets[fromId];
  const dest = nextHop ? h.state.planets[nextHop] : undefined;
  if (!nextHop || !origin || !dest) {
    return false;
  }
  // Where this leg stops: the park point on the last hop; on the way, the fork of the
  // next province when the way on shares its trail (ROADS-2) — the fleet goes round the
  // world, not through it. A fleet that set off from a point already past that fork
  // (parked on the trunk) goes on to the world instead of turning back.
  const endT = legEndT(h.state, fromId, nextHop, hops[1], startT, parkT);
  const span = endT - startT;
  if (span <= 0) {
    return false;
  }
  // The match's travel factor (Sector Zero ×5) rides the base, not a hook: every
  // `fleet.speed` contribution multiplies, so the order is immaterial, and the
  // estimates (`estimateTravelHours`, `journeyEtaMs`) read the very same base.
  const speed = h.hook<number>('fleet.speed', fleetTravelSpeed(fleet, h.ctx), {
    fleetId: fleet.id,
    from: fromId,
    to: nextHop,
  });
  if (speed <= 0) {
    return false;
  }
  // Distance covered = the fraction [startT,endT] of the lane's road.
  const legDist = laneLength(h.state, fromId, nextHop) * span;
  // timeScale compresses all real-time durations (GDD §3.1) — via hoursToMs.
  const legMs = hoursToMs(h.ctx, legDist / speed);
  fleet.movement = {
    from: fromId,
    to: nextHop,
    departedAt: h.ctx.now,
    arrivesAt: h.ctx.now + legMs,
    path: hops.slice(1),
    destination: hops[hops.length - 1],
    ...(startT > 0 ? { startT } : {}),
    ...(endT < 1 ? { endT } : {}),
    ...(parkT < 1 ? { parkT } : {}),
  };
  fleet.location = null;
  fleet.edge = null;
  h.schedule(fleet.movement.arrivesAt, 'fleet.arrival', {
    fleetId: fleet.id,
    departedAt: h.ctx.now,
    arrivesAt: fleet.movement.arrivesAt,
  });
  // A leg just started: the fleet now occupies the lane (`from`,`to`) over a known
  // window. Announced for EVERY leg (journey start AND each intermediate hop, which
  // `fleet.departed` does not cover) so collision modules can compute lane-crossing
  // intercepts. Carries no journey context — listeners read `fleet.movement`.
  h.emit('fleet.leg', { fleetId: fleet.id });
  return true;
}

/** Origin candidate: where a leg can start from (a node, or one end of the lane
 *  a parked fleet sits on). `lead` is the node(s) the first leg traverses to
 *  reach `routingNode`; `cost` is that lead's distance. */
interface Origin {
  fromId: PlanetId;
  routingNode: PlanetId;
  lead: PlanetId[];
  startT: number;
  cost: number;
}

/** Target candidate: the node Dijkstra routes to, plus an optional final partial
 *  leg into a lane (so the journey ends at a point), with its park fraction. */
interface Target {
  routeTo: PlanetId;
  final: PlanetId[];
  parkT: number;
  cost: number;
}

/**
 * The lanes a parked fleet can set off along. On a lane: that one. At a FORK (ROADS-3):
 * every lane of the fork's trail, each seen from the fork — it is one point on all of them,
 * so a fleet waiting there leaves by the road it needs rather than via the world and back.
 */
function anchorsOf(state: GameState, e: FleetEdge): FleetEdge[] {
  const fork = forkAt(state, e.from, e.to, e.t);
  if (!fork) {
    return [e];
  }
  return fork.exits.map((x) => ({
    from: fork.province,
    to: x,
    t: forkTAtStart(state, fork.province, x),
  }));
}

/** The places a fleet can begin a journey from. At a node: just that node. Parked
 *  on a lane: either end (the cheaper one wins after routing) — of every lane its
 *  point lies on (`anchorsOf`). */
function originsOf(state: GameState, fleet: Fleet): Origin[] {
  if (fleet.location) {
    return [{ fromId: fleet.location, routingNode: fleet.location, lead: [], startT: 0, cost: 0 }];
  }
  const e = fleet.edge;
  if (!e) {
    return [];
  }
  return anchorsOf(state, e).flatMap((a) => {
    const len = laneLength(state, a.from, a.to);
    return [
      // forward to `to`
      { fromId: a.from, routingNode: a.to, lead: [a.to], startT: a.t, cost: len * (1 - a.t) },
      // back to `from`
      { fromId: a.to, routingNode: a.from, lead: [a.from], startT: 1 - a.t, cost: len * a.t },
    ];
  });
}

/** The node(s) a journey can route toward. A node target: that node. An
 *  edge-point target: route to either endpoint, then a final partial leg parks. */
function targetsOf(state: GameState, payload: MovePayload): Target[] | { error: string } {
  if (payload.toEdge) {
    const { from, to, t } = payload.toEdge;
    if (typeof from !== 'string' || typeof to !== 'string' || typeof t !== 'number') {
      return { error: 'E_BAD_PAYLOAD' };
    }
    const a = state.planets[from];
    const b = state.planets[to];
    if (!a || !b) {
      return { error: 'E_NO_DESTINATION' };
    }
    if (!a.links?.includes(to) || !b.links?.includes(from)) {
      return { error: 'E_NOT_A_LANE' }; // a point can only sit on a real lane
    }
    // HERO-CORRIDOR: встать ПОСРЕДИ коридора нельзя — это прыжок, середины у него нет.
    // Иначе флот, припарковавшийся на коридорном ребре, после закрытия коридора остался
    // бы стоять на ребре, которого в графе больше нет.
    if (isCorridorEdge(state, from, to)) {
      return { error: 'E_NOT_A_LANE' };
    }
    // Near a node → just go to that node (no degenerate parked edge).
    if (t <= EPS) {
      return [{ routeTo: from, final: [], parkT: 1, cost: 0 }];
    }
    if (t >= 1 - EPS) {
      return [{ routeTo: to, final: [], parkT: 1, cost: 0 }];
    }
    const len = laneLength(state, from, to);
    return [
      { routeTo: from, final: [to], parkT: t, cost: len * t },
      { routeTo: to, final: [from], parkT: 1 - t, cost: len * (1 - t) },
    ];
  }
  if (typeof payload.to === 'string') {
    if (!state.planets[payload.to]) {
      return { error: 'E_NO_DESTINATION' };
    }
    return [{ routeTo: payload.to, final: [], parkT: 1, cost: 0 }];
  }
  return { error: 'E_BAD_PAYLOAD' };
}

/**
 * Plans the shortest journey for `fleet` to a node or a point on a lane,
 * considering every origin/target endpoint pairing (so a parked fleet may reverse
 * down its road and a lane-point may be approached from either end). Pure; ties
 * broken deterministically by the hop string. Returns null if nowhere is reachable.
 */
function planJourney(
  state: GameState,
  routes: RouteCache,
  fleet: Fleet,
  payload: MovePayload,
  // Diplomacy-aware replan (D2): with a veto predicate the mid-route is computed
  // DIRECTLY, bypassing RouteCache — a diplomatic route depends on owners and
  // stances, which change without bumping `state.topology`, so caching it would
  // serve stale detours. The cheap cached topology-only plan stays the fast path;
  // this parameter is only passed after that plan tripped the right-of-way gate.
  blocked?: (id: PlanetId) => boolean,
): Journey | { error: string } | null {
  // HERO-CORRIDOR: чужой ЛИЧНЫЙ коридор — не дорога. Вето по ребру зависит от ФЛОТА
  // (право прохода у того, кто несёт героя), а `RouteCache` ключуется только
  // топологией, поэтому при живом личном коридоре кэш обходится — та же причина, по
  // которой его обходит дипломатическое вето. Нет личных коридоров → `undefined`, и
  // быстрый кэшированный путь остаётся нетронутым.
  const edgeVeto = corridorVeto(state, fleet.id);
  // ROADS-3: a stop ordered near a fork is a stop AT it — the one point on a trail that
  // sees every road of it (`snapToFork`). Once, here, so both paths below aim the same.
  const te0 = payload.toEdge;
  const aim: MovePayload =
    te0 && typeof te0.from === 'string' && typeof te0.to === 'string' && typeof te0.t === 'number'
      ? { ...payload, toEdge: { ...te0, t: snapToFork(state, te0.from, te0.to, te0.t) } }
      : payload;
  const targets = targetsOf(state, aim);
  if ('error' in targets) {
    return targets;
  }
  const origins = originsOf(state, fleet);
  if (origins.length === 0) {
    return { error: 'E_FLEET_BUSY' }; // in transit / no anchor
  }

  // Fast path: repositioning ALONG the lane the fleet is already parked on — a
  // single direct leg, no detour to an endpoint (Bytro "drag the army down the
  // road"). Only when the target point is interior; node-ish targets fall through.
  // A fleet at a fork stands on every lane of its trail, so each of them counts.
  const e = fleet.edge;
  if (e && aim.toEdge) {
    const te = aim.toEdge;
    for (const a of anchorsOf(state, e)) {
      const same = (te.from === a.from && te.to === a.to) || (te.from === a.to && te.to === a.from);
      const q = te.from === a.from ? te.t : 1 - te.t; // target fraction along (a.from,a.to)
      if (same && q > EPS && q < 1 - EPS) {
        if (Math.abs(q - a.t) <= EPS) {
          return { error: 'E_SAME_LOCATION' };
        }
        return q > a.t
          ? { fromId: a.from, hops: [a.to], startT: a.t, parkT: q }
          : { fromId: a.to, hops: [a.from], startT: 1 - a.t, parkT: 1 - q };
      }
    }
  }

  let best: Journey | null = null;
  let bestCost = Infinity;
  let bestKey = '';
  for (const o of origins) {
    for (const t of targets) {
      const mid =
        blocked === undefined && edgeVeto === undefined
          ? routes.lookup(state, o.routingNode, t.routeTo)
          : planRoute(state, o.routingNode, t.routeTo, blocked, edgeVeto);
      if (mid === null) {
        continue; // unreachable by lanes from this origin endpoint
      }
      const hops = [...o.lead, ...mid, ...t.final];
      if (hops.length === 0) {
        continue; // already there
      }
      const cost = o.cost + routeDistance(state, o.routingNode, mid) + t.cost;
      const key = hops.join('\0');
      if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) <= 1e-9 && key < bestKey)) {
        best = { fromId: o.fromId, hops, startT: o.startT, parkT: t.parkT };
        bestCost = cost;
        bestKey = key;
      }
    }
  }
  return best;
}

/**
 * Movement — a base module (docs/modulesystem.md). Turns the intent `fleet.move`
 * into a real-time journey along the lane graph: it routes with Dijkstra and
 * travels hop by hop, scheduling each arrival. A fleet's position is continuous —
 * it can march to a node OR to any point ON a lane (`toEdge`), `fleet.stop` parks
 * it wherever it is, and a parked fleet re-routes from there (Bytro-style). At
 * each node it announces `fleet.transit` (intermediate) or `fleet.arrived` (final)
 * for collision checks; a mid-lane park announces `fleet.parked`, and every leg
 * start announces `fleet.leg` (so collision modules can intercept two hostile
 * fleets crossing ON a lane, not only at a node). Speed runs through the
 * `fleet.speed` hook (terrain).
 */
export const movementModule: GameModule = {
  id: 'movement',
  version: '1.3.0',
  setup(api) {
    // Closure-scoped cache, shared across actions; keyed by `state.topology` so a
    // hero temp lane mutating `links` invalidates stale routes (see RouteCache).
    const routes = new RouteCache();

    /**
     * RETR-1 — постановка курса ОДНОЙ функцией, общей для приказа и для шва.
     *
     * Здесь живёт всё, что делает курс курсом: перепланирование уже идущего флота,
     * маршрут по графу, право прохода (дипломатия) и объявление вылета. Отступление с
     * точкой отхода обязано ходить ТЕМ ЖЕ путём — иначе у одного правила («куда флот
     * вправе лететь») стало бы две реализации, и вторая неизбежно отстала бы от первой.
     *
     * Возвращает код отказа строкой либо `null` при успехе: вызывающий сам решает, что
     * это — отказ игроку (`fleet.move`) или отказ всего составного приказа (отступление).
     * Владение флотом и форму payload проверяет ВЫЗЫВАЮЩИЙ: у приказа и у шва разные
     * двери, и подменять чужую проверку своей эта функция не должна.
     */
    const setCourse = (
      h: HandlerContext,
      fleet: Fleet,
      payload: MovePayload,
      playerId: PlayerId,
    ): string | null => {
      if (fleet.battleId) {
        return 'E_FLEET_BUSY'; // in battle → not free to re-task
      }
      if (fleet.movement) {
        // RETASK: a NEW course to a fleet already under way is legal — halt it at its
        // current continuous position (the exact `fleet.stop` parking) and replan from
        // there. This is the composition stop→move the player could already issue as
        // two taps, collapsed into one order; no invariant can hold for one form and
        // not the other. Two deliberate asymmetries with a real stop:
        //  · no `fleet.parked` is emitted — the fleet never RESTS here (perimeter
        //    interception reacts to parked fleets, and this one is gone in the same
        //    instant);
        //  · if the replan below rejects (no route / right of way), the kernel drops
        //    the whole draft — so a FAILED re-task leaves the old course running
        //    instead of stranding the fleet mid-lane.
        // The abandoned leg's scheduled arrival stays in the timeline; the arrival
        // handler ignores it (its departedAt/arrivesAt no longer match).
        //
        // …but re-tasking INSIDE a corridor is refused, by the same rule and the same
        // code as `fleet.stop` (HERO-CORRIDOR / CMD-VIS): a corridor is a jump with no
        // middle, and a fleet parked on a corridor edge would be left standing on an
        // edge the graph loses when the corridor closes. The re-task parks the fleet
        // EXACTLY like a stop does, so the ban has to hold at both doors — otherwise
        // «Курс» becomes a second way to do the thing «Стоп» refuses.
        if (isCorridorEdge(h.state, fleet.movement.from, fleet.movement.to)) {
          return 'E_NOT_A_LANE';
        }
        const mv = fleet.movement;
        const frac = Math.min(1 - EPS, Math.max(EPS, legT(mv, h.ctx.now)));
        fleet.edge = { from: mv.from, to: mv.to, t: frac };
        fleet.movement = null;
        fleet.location = null;
      } else if (fleet.location === null && !fleet.edge) {
        return 'E_FLEET_BUSY'; // no anchor at all → nothing to route from
      }
      if (payload.to !== undefined && payload.to === fleet.location) {
        return 'E_SAME_LOCATION';
      }
      let plan = planJourney(h.state, routes, fleet, payload as MovePayload);
      if (plan === null) {
        return 'E_NO_ROUTE'; // not connected by lanes
      }
      if ('error' in plan) {
        return plan.error;
      }
      // Diplomacy gate (D2 — right of way): a fleet may not enter a node owned by a
      // player it's at PEACE with (must declare war first). Neutral, own, and
      // war/pact/alliance territory is passable. Checked on every hop, not just the
      // destination — passing THROUGH peace-locked territory is also forbidden.
      //
      // The gate does NOT get the last word over the ROUTE, only over the move: the
      // cached plan is topology-shortest, so when it trips the gate we REPLAN with a
      // diplomacy veto and take a legal detour if one exists. Vetoing the shortest
      // path outright (the pre-fix behaviour) cut fleets off from the entire map as
      // soon as bots' walk-in captures peppered the lanes — one peace-owned node on
      // the unique shortest path read as «no route anywhere», even to own worlds.
      if (crossesPeace(h.state, playerId, plan.hops)) {
        const detour = planJourney(h.state, routes, fleet, payload as MovePayload, (id) => {
          const owner = h.state.planets[id]?.owner ?? null;
          return (
            owner !== null &&
            owner !== playerId &&
            getStance(h.state, playerId, owner) === 'peace'
          );
        });
        // Re-check the detour: the veto exempts the DESTINATION node on purpose
        // (landing on a peace-locked world must reject as right-of-way, so the
        // client can offer the war declaration — not as a bogus «no route»).
        if (detour === null || 'error' in detour || crossesPeace(h.state, playerId, detour.hops)) {
          return 'E_NO_RIGHT_OF_WAY';
        }
        plan = detour;
      }
      const origin = fleet.location ?? fleet.edge?.from ?? null;
      if (!beginLeg(h, fleet, plan.fromId, plan.hops, plan.startT, plan.parkT)) {
        return 'E_FLEET_IMMOBILE';
      }
      h.emit('fleet.departed', {
        fleetId: fleet.id,
        from: origin,
        to: payload.to ?? plan.hops[plan.hops.length - 1],
        path: plan.hops,
      });
      return null;
    };

    /**
     * Шов для отступления с точкой отхода (RETR-1): модуль боя не импортирует модуль
     * движения (инвариант №3), поэтому курс он получает через реестр возможностей.
     * Нет модуля движения — возможности нет, и отступление просто расцепляет бой:
     * деградация к базовому поведению, а не падение.
     */
    api.provideCapability<FleetCourse>('fleet.course', ({ fleetId, to, playerId }, h) => {
      const fleet = h.state.fleets[fleetId];
      if (!fleet || fleet.owner !== playerId) return 'E_NO_FLEET';
      return setCourse(h, fleet, { fleetId, to }, playerId);
    });

    api.onAction('fleet.move', (action, h) => {
      const payload = action.payload as Partial<MovePayload>;
      if (typeof payload?.fleetId !== 'string' || (payload.to === undefined && !payload.toEdge)) {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = h.state.fleets[payload.fleetId];
      // Absent OR not-yours → one opaque code, so a client can't enumerate ids to
      // confirm fog-hidden enemy fleets exist (A06 — reject-code side-channel).
      if (!fleet || fleet.owner !== action.playerId) {
        return h.reject('E_NO_FLEET');
      }
      const err = setCourse(h, fleet, payload as MovePayload, action.playerId);
      if (err !== null) return h.reject(err);
    });

    api.onAction('fleet.stop', (action, h) => {
      const { fleetId } = action.payload as { fleetId?: string };
      if (typeof fleetId !== 'string') {
        return h.reject('E_BAD_PAYLOAD');
      }
      const fleet = h.state.fleets[fleetId];
      // Absent OR not-yours → one opaque code, so a client can't enumerate ids to
      // confirm fog-hidden enemy fleets exist (A06 — reject-code side-channel).
      if (!fleet || fleet.owner !== action.playerId) {
        return h.reject('E_NO_FLEET');
      }
      const mv = fleet.movement;
      if (!mv || fleet.battleId) {
        return h.reject('E_FLEET_BUSY'); // not under way (or in a battle) → nothing to halt
      }
      // HERO-CORRIDOR: остановка ПОСРЕДИ коридора запрещена тем же правилом, что и
      // парковка цели «Курса» (targetsOf): коридор — прыжок, середины у него нет, а
      // флот, вставший на коридорном ребре, после закрытия коридора остался бы стоять
      // на ребре, которого в графе больше нет. Код тот же — с точки зрения игрока
      // «здесь дороги нет»; вошёл в коридор — доезжай.
      if (isCorridorEdge(h.state, mv.from, mv.to)) {
        return h.reject('E_NOT_A_LANE');
      }
      // Park the fleet at its CURRENT continuous position on the lane — not at the
      // next node: the shared leg interpolation, clamped to the lane interior.
      const frac = Math.min(1 - EPS, Math.max(EPS, legT(mv, h.ctx.now)));
      const edge: FleetEdge = { from: mv.from, to: mv.to, t: frac };
      fleet.movement = null;
      fleet.location = null;
      fleet.edge = edge;
      // The leg's scheduled arrival is now stale; the arrival handler ignores it
      // (its `departedAt` no longer matches this fleet's movement).
      h.emit('fleet.parked', { fleetId, edge });
    });

    api.on('fleet.arrival', (event, h) => {
      const { fleetId, departedAt, arrivesAt } = event.payload as {
        fleetId: string;
        departedAt?: number;
        arrivesAt?: number;
      };
      const fleet = h.state.fleets[fleetId];
      const mv = fleet?.movement;
      if (!fleet || !mv || fleet.battleId) {
        return; // fleet gone, stale leg, or pulled into a battle → journey ends
      }
      // Stale arrival from a leg this fleet has since abandoned (stop/re-route). The
      // departure instant alone is NOT a unique leg id: a stop+reroute handled within
      // the same instant stamps both legs with the same `departedAt`, so we also match
      // the scheduled arrival time. (When two legs share BOTH, firing either at that
      // shared instant yields the correct result for the live movement.)
      if (
        (departedAt !== undefined && mv.departedAt !== departedAt) ||
        (arrivesAt !== undefined && mv.arrivesAt !== arrivesAt)
      ) {
        return;
      }
      const at = mv.to;
      const remaining = mv.path ?? [];
      const parkT = mv.parkT ?? 1;
      if (mv.endT !== undefined && mv.endT < 1) {
        // Final leg ends at a point ON the lane → park there (no node arrival).
        if (remaining.length === 0) {
          const edge: FleetEdge = { from: mv.from, to: mv.to, t: mv.endT };
          fleet.movement = null;
          fleet.location = null;
          fleet.edge = edge;
          h.emit('fleet.parked', { fleetId, edge });
          return;
        }
        // A FORK on the way (ROADS-2): the road goes on without visiting this world. The
        // owner's rule — the fleets stationed at the planet do not meet it, an empty
        // province is not taken — is kept by what does NOT fire here: no `fleet.transit`.
        // `fleet.fork` is its own event (a hero rides along into the province; ROADS-3
        // hangs the ambush on it).
        const next = remaining[0]!;
        fleet.movement = null;
        fleet.location = null;
        fleet.edge = null;
        h.emit('fleet.fork', { fleetId, at, from: mv.from, to: next });
        if (fleet.battleId) return;
        const startT = forkTAtStart(h.state, at, next);
        if (!beginLeg(h, fleet, at, remaining, startT, parkT)) {
          // Nothing left to fly — the journey ends AT this fork (a stop ordered there,
          // ROADS-3) — or it cannot go on (speed 0 / a node gone): stop at the fork, on the
          // road ahead.
          const edge: FleetEdge = { from: at, to: next, t: startT };
          fleet.edge = edge;
          h.emit('fleet.parked', { fleetId, edge });
        }
        return;
      }
      fleet.location = at;
      fleet.edge = null;
      fleet.movement = null;

      if (remaining.length === 0) {
        h.emit('fleet.arrived', { fleetId, at }); // final destination (a node)
      } else {
        // Intermediate hop: announce for collision checks, then continue. If a
        // collision starts a battle, it nulls this fleet's movement and this
        // next leg's scheduled arrival is ignored.
        h.emit('fleet.transit', { fleetId, at });
        if (!fleet.battleId && !beginLeg(h, fleet, at, remaining, 0, parkT)) {
          h.emit('fleet.stranded', { fleetId, at });
        }
      }
    });
  },
};
