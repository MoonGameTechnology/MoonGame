import {
  STEWARD_LOSS_LIMIT,
  fleetBaseSpeed,
  forkTAtStart,
  getStance,
  hoursToMs,
  hullPool,
  isVisibleTo,
  journeyDestination,
  laneRoadLength,
  previewBattle,
  type Context,
  type GameState,
  type PlanetId,
  type PlayerId,
} from '../packages/shared-core/src/index';

/** Кого и куда посылает засада: крыло `fleetId` встаёт на развилку провинции `node` —
 *  точку `t` дороги `node`→`exit`, — чтобы встретить `target`. */
export interface AmbushPlan {
  fleetId: string;
  node: PlanetId;
  exit: PlanetId;
  t: number;
  target: string;
  /** Прогноз потерь крыла в этой встрече (доля корпусов). */
  fraction: number;
}

/**
 * Засада «Хранителя» на развилке (ROADS-6, резолюция владельца 2026-09-23).
 *
 * Враг, идущий к нашим мирам МИМО нашей планеты боковой дорогой, стоящих у неё не
 * встречает (решение владельца, `roads-roadmap.md` §0.2): встретить его можно только на
 * развилке этой тропы. Автопилот делает то, что сделал бы игрок: ставит туда крыло.
 *
 * Условия — всё, что автопилот знает честно, и ничего сверх:
 * - враг в войне, ВИДЕН (`isVisibleTo` — то же правило тумана, что у `scanNodeThreats`) и
 *   его текущая нога кончается на развилке НАШЕЙ провинции, а путь идёт дальше — это
 *   обход её планеты (`legEndT` ROADS-2 ставит конец ноги на развилку ровно тогда);
 * - идёт он к НАШЕМУ миру — засада обороняет, а не охотится;
 * - крыло стоит у этой же планеты, свободно и успевает на развилку с запасом `margin`
 *   раньше врага; провинция не под угрозой и не точка удержания (`guarded`) — иначе
 *   крыло нужно там, где стоит;
 * - прогноз встречи — победа крыла с потерями ниже `STEWARD_LOSS_LIMIT`. Крыло в этой
 *   встрече НАПАДАЮЩЕЕ: оно встаёт на развилку, когда враг уже в пути, и встречу
 *   назначает его стоянка (ROADS-3).
 *
 * На развилку — одно крыло: стоящий там ловит всех, кто идёт по тропе. Из подходящих —
 * сильнейшее, как у контрудара. Чистая функция: ни приказов, ни журнала — их пишет
 * `stewardGuard.ts`.
 */
export function stewardAmbushes(
  state: GameState,
  ai: PlayerId,
  ctx: Context,
  opts: {
    identified: Set<PlanetId>;
    /** Крыло уже получило задачу в этом такте. */
    busy: (fleetId: string) => boolean;
    /** Провинция, с которой крыло снимать нельзя (угроза, точка удержания). */
    guarded: (node: PlanetId) => boolean;
    /** Запас по времени: крыло обязано встать на развилку хотя бы на столько раньше. */
    margin: number;
  },
): AmbushPlan[] {
  const plans: AmbushPlan[] = [];
  const claimed = new Set<string>(); // крылья, уже посланные в этом такте
  const forks = new Set<string>(); // развилки, куда крыло уже послано
  for (const id of Object.keys(state.fleets).sort()) {
    const enemy = state.fleets[id]!;
    const mv = enemy.movement;
    if (enemy.owner === ai || enemy.battleId || !mv) continue;
    if (getStance(state, ai, enemy.owner) !== 'war') continue;
    if (!((mv.endT ?? 1) < 1) || !(mv.path && mv.path.length > 0)) continue; // не обход
    if (!(mv.arrivesAt > ctx.now)) continue;
    const node = state.planets[mv.to];
    if (!node || node.owner !== ai || opts.guarded(node.id)) continue;
    if (state.planets[journeyDestination(mv)]?.owner !== ai) continue;
    if (!isVisibleTo(state, ai, { fleetId: id }, ctx.data, opts.identified)) continue;
    const t = forkTAtStart(state, node.id, mv.from);
    if (!(t > 0) || !(t < 1)) continue;
    // Развилка — одна на ТРОПУ: враги с разных её веток приходят в одну точку.
    const trail = node.roads?.trails.findIndex((tr) => tr.exits.includes(mv.from)) ?? -1;
    const key = `${node.id}#${trail}`;
    if (forks.has(key)) continue;
    const trunk = laneRoadLength(state, node.id, mv.from) * t;
    const wings = Object.values(state.fleets)
      .filter(
        (f) =>
          f.owner === ai &&
          f.location === node.id &&
          !f.movement &&
          !f.battleId &&
          !opts.busy(f.id) &&
          !claimed.has(f.id) &&
          f.units.some((s) => s.count > 0),
      )
      .sort(
        (a, b) =>
          hullPool(b.units, ctx.data) - hullPool(a.units, ctx.data) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    for (const wing of wings) {
      const speed = fleetBaseSpeed(wing, ctx.data);
      if (!(speed > 0)) continue;
      const arrives = ctx.now + hoursToMs(ctx, trunk / speed);
      if (arrives + opts.margin > mv.arrivesAt) continue; // не успеет — не посылать
      const fight = previewBattle(wing.units, enemy.units, ctx.data);
      if (fight.outcome !== 'attacker' || fight.attacker.damageFraction >= STEWARD_LOSS_LIMIT) {
        continue;
      }
      plans.push({
        fleetId: wing.id,
        node: node.id,
        exit: mv.from,
        t,
        target: id,
        fraction: fight.attacker.damageFraction,
      });
      claimed.add(wing.id);
      forks.add(key);
      break;
    }
  }
  return plans;
}
