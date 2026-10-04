/**
 * Пленный главы V «Голос Единения» (`docs/covenant-of-unity.md`, кирпич PVR-9.5) глазами
 * игрока и союзного бота: какими флотами его можно принять на борт, какой удар погубит его
 * вместе с убежищем и что делает с ним союзник.
 *
 * Правила взятия, погрузки и доставки — у ядра (`captiveModule`). Здесь только выбор: кому
 * показать кнопку, когда предупредить и какой приказ отдать. Окончательный ответ даёт ядро,
 * отказ приходит текстом.
 *
 * 1. **Кнопка погрузки** — свои флоты у взятого убежища: не в пути, не в бою, с кораблём.
 * 2. **Предупреждение ДО удара** (§«Ход миссии»: «показывается до опасного приказа, а не
 *    после удара»): пока пленный в убежище, уничтожение этого мира губит его.
 * 3. **Союзник, взявший убежище, сам довозит пленного**: пока его десант дерётся за убежище,
 *    корабли над ним ждут исхода; взял — грузит пленного на флот у убежища и ведёт носитель в
 *    безопасную зону. Своего флота у убежища нет — за пленным идёт ближайший свободный.
 *    Флот, занятый пленным, живёт этим приказом — остальной бот его не трогает. Взятое
 *    игроком союзник не перехватывает.
 */
import {
  planRoute,
  type Action,
  type Fleet,
  type GameState,
  type PlayerId,
} from '../packages/shared-core/src/index';
import { canTraverse, captiveLoad, moveFleet } from './actions';
import { captiveStage } from './missionObjectives';

/** Где флот будет: стоит — где стоит, летит — куда летит. */
const boundFor = (f: Fleet): string | null =>
  f.movement ? (f.movement.destination ?? f.movement.to) : f.location;

/** Свои флоты у взятого убежища, готовые принять пленного (правило 1). */
export function captiveCandidates(state: GameState, me: PlayerId): string[] {
  const c = state.captive;
  if (!c || c.lostAt !== undefined || captiveStage(state, me) !== 1) return [];
  return Object.values(state.fleets)
    .filter((f) => f.owner === me && f.location === c.hideout && !f.movement && !f.battleId)
    .filter((f) => f.units.some((u) => u.count > 0))
    .map((f) => f.id)
    .sort();
}

/** Уничтожение мира `planetId` погубит пленного (правило 2): это убежище, задание открыто,
 *  и пленный ещё не на борту. */
export function captiveAtRisk(state: GameState, planetId: string): boolean {
  const c = state.captive;
  return (
    !!c &&
    c.hideout === planetId &&
    c.carrier === undefined &&
    c.deliveredAt === undefined &&
    c.lostAt === undefined
  );
}

/** Приказы союзника о пленном (правило 3) и флоты, которые они занимают. */
export function allyCaptiveOrders(
  state: GameState,
  ally: PlayerId,
): { actions: Action[]; held: string[] } {
  const c = state.captive;
  if (!c || c.deliveredAt !== undefined || c.lostAt !== undefined) return { actions: [], held: [] };
  // Десант союзника ещё дерётся за убежище — его корабли над ним ждут исхода, чтобы сразу
  // принять пленного. Высаженный десант флот не держит, и без этого план увёл бы группу на сбор.
  if (c.takenBy === undefined) {
    const storming = Object.values(state.battles).some(
      (b) =>
        b.location === c.hideout &&
        b.phase === 'ground' &&
        b.sides.some((side) => side.owner === ally && side.role === 'attacker'),
    );
    if (!storming) return { actions: [], held: [] };
    const over = Object.values(state.fleets)
      .filter((f) => f.owner === ally && f.location === c.hideout && !f.movement)
      .map((f) => f.id)
      .sort();
    return { actions: [], held: over };
  }
  if (c.takenBy !== ally) return { actions: [], held: [] };
  if (c.carrier !== undefined) {
    const carrier = state.fleets[c.carrier];
    if (!carrier || carrier.owner !== ally) return { actions: [], held: [] };
    // В пути к зоне или в бою — приказ уже отдан или его решает бой.
    if (carrier.movement || carrier.battleId || carrier.location === c.zone)
      return { actions: [], held: [carrier.id] };
    return { actions: [moveFleet(ally, carrier.id, c.zone)], held: [carrier.id] };
  }
  const loader = captiveCandidates(state, ally)[0];
  if (loader) return { actions: [captiveLoad(ally, loader)], held: [loader] };
  // Флот уже идёт к убежищу или стоит там в бою — ждём его. Иначе посылаем ближайший
  // свободный по числу переходов, при равенстве — первый по id.
  const ships = Object.values(state.fleets)
    .filter((f) => f.owner === ally && f.units.some((u) => u.count > 0))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bound = ships.find((f) => boundFor(f) === c.hideout);
  if (bound) return { actions: [], held: [bound.id] };
  let best: { id: string; hops: number } | null = null;
  for (const f of ships) {
    if (f.movement || f.battleId || f.location === null) continue;
    const route = planRoute(
      state,
      f.location,
      c.hideout,
      (id) => !canTraverse(state, ally, state.planets[id]?.owner ?? null),
    );
    if (route && (best === null || route.length < best.hops))
      best = { id: f.id, hops: route.length };
  }
  return best
    ? { actions: [moveFleet(ally, best.id, c.hideout)], held: [best.id] }
    : { actions: [], held: [] };
}
