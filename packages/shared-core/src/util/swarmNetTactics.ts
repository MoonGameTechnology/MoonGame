/**
 * Где Рою держать сеть — эвристика ИИ, общая обоим драйверам Роя (`docs/swarm-behavior.md`
 * §6, решения владельца 2026-09-24).
 *
 * Это ТАКТИКА, а не правило мира: по ADR `docs/explanations/05` она живёт вне модулей ядра
 * и не входит в контракт реплея. Здесь — чистая функция «кого куда и что строить», которую
 * зовут бот забега (`prototype/src/ai.ts`) и серверный оркестратор
 * (`packages/server/src/pveOrchestrator.ts`): одна тактика на два хоста, чтобы сеть
 * строилась одинаково офлайн и на сервере.
 *
 * Правила v0:
 *
 * 1. **Пост сети — флот с большим ретранслятором** (признак `relay_post`). Драйверы не
 *    отдают ему своих приказов и не сливают его с другими: пост стоит там, куда его
 *    поставила сеть, со своей небольшой охраной из данных карты.
 * 2. **Цепочка тянется от центра данных к фронту.** Фронт — ближайший к мирам Роя мир
 *    игрока: туда идут волны. Путь — кратчайший по лейнам от ближайшего к фронту
 *    работающего центра. Посты встают на пути жадно: каждый следующий — самый дальний
 *    мир, до которого круги ещё сходятся, и цепочка кончается, когда малый ретранслятор
 *    волны у фронта уже дотягивается до последнего поста.
 * 3. **Пост идёт на ближайшее к нему место цепочки.** Лишние посты стоят, где стоят:
 *    они и так держат покрытие.
 * 4. **Постов не хватает — Рой строит ещё один**, по одному за раз, на верфи своего мира,
 *    если хватает запаса. Готовый ретранслятор со стапеля попадает во флот сбора
 *    (`auto-rally`) вместе с прочими новыми кораблями — такой флот ретранслятор отдаёт:
 *    пост без боевого флота на плечах.
 * 5. **Центров не осталось — Рой ставит новый** на мире с верфью (одна постройка за раз):
 *    без центра часть сети строит вслепую, и ИИ это чинит.
 */
import type { FleetId, GameState, Planet, PlanetId, PlayerId } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { buildingLevel } from '../data/schemas';
import { fleetPositionAt } from '../state/fleetPosition';
import { swarmNet } from './swarmNet';

/** Признак юнита — большой ретранслятор, пост сети. */
export const RELAY_POST_TRAIT = 'relay_post';
/** Сколько чужих кораблей пост может нести охраной, прежде чем его отделят (правило 4). */
const ESCORT_MAX = 2;

export interface SwarmNetPlan {
  /** Флоты-посты: драйверы не отдают им своих приказов и не сливают их (правило 1). */
  held: Set<FleetId>;
  moves: Array<{ fleetId: FleetId; to: PlanetId }>;
  /** Отделить ретранслятор от флота сбора (правило 4). */
  splits: Array<{ fleetId: FleetId; take: Array<{ unit: string; count: number }> }>;
  builds: Array<{ planetId: PlanetId; unit?: string; building?: string }>;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));

/** Кратчайший по лейнам путь от `from` до `to` (включая оба конца). Соседи — по id. */
function lanePath(state: GameState, from: PlanetId, to: PlanetId): PlanetId[] | null {
  const prev = new Map<PlanetId, PlanetId | null>([[from, null]]);
  const queue: PlanetId[] = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    if (at === to) break;
    for (const next of [...(state.planets[at]?.links ?? [])].sort(byId)) {
      if (prev.has(next) || !state.planets[next]) continue;
      prev.set(next, at);
      queue.push(next);
    }
  }
  if (!prev.has(to)) return null;
  const path: PlanetId[] = [];
  for (let at: PlanetId | null = to; at !== null; at = prev.get(at) ?? null) path.push(at);
  return path.reverse();
}

export function swarmNetPlan(state: GameState, data: GameData, npc: PlayerId): SwarmNetPlan {
  const plan: SwarmNetPlan = { held: new Set(), moves: [], splits: [], builds: [] };
  const postUnits = Object.keys(data.units)
    .filter((id) => data.units[id]!.traits.includes(RELAY_POST_TRAIT))
    .sort(byId);
  if (postUnits.length === 0) return plan;
  const postRange = Math.max(...postUnits.map((id) => data.units[id]!.relayRange));
  const waveRange = Math.min(
    ...Object.values(data.units)
      .filter((u) => u.relayRange > 0)
      .map((u) => u.relayRange),
  );

  const fleets = Object.values(state.fleets)
    .filter((f) => f.owner === npc)
    .sort((a, b) => byId(a.id, b.id));
  const posts = fleets.filter((f) =>
    f.units.some((st) => st.count > 0 && postUnits.includes(st.unit)),
  );
  for (const f of posts) plan.held.add(f.id);

  // Правило 4: ретранслятор со стапеля отделяется от флота сбора.
  const settled: typeof posts = [];
  for (const f of posts) {
    const others = f.units
      .filter((st) => !postUnits.includes(st.unit))
      .reduce((n, st) => n + st.count, 0);
    if (others > ESCORT_MAX && f.location !== null && !f.movement && !f.battleId) {
      plan.splits.push({
        fleetId: f.id,
        take: f.units
          .filter((st) => postUnits.includes(st.unit) && st.count > 0)
          .map((st) => ({ unit: st.unit, count: st.count })),
      });
      continue;
    }
    settled.push(f);
  }

  // Правило 2: цепочка от работающего центра к фронту.
  const view = swarmNet(state, data, npc, state.time);
  const centers = view.nodes.filter((n) => n.kind === 'center' && view.powered.has(n.id));
  const mine = Object.values(state.planets).filter((p) => p.owner === npc);
  const human = (p: Planet): boolean =>
    p.owner !== null && p.owner !== npc && !state.players[p.owner]?.npc;
  let front: Planet | undefined;
  let frontD = Infinity;
  for (const p of Object.values(state.planets)
    .filter(human)
    .sort((a, b) => byId(a.id, b.id))) {
    for (const m of mine) {
      const d = dist(p.position, m.position);
      if (d < frontD) {
        frontD = d;
        front = p;
      }
    }
  }
  const chain: PlanetId[] = [];
  if (front && centers.length > 0) {
    const anchorNode = [...centers].sort(
      (a, b) => dist(a, front!.position) - dist(b, front!.position) || byId(a.id, b.id),
    )[0]!;
    const anchor = anchorNode.id.slice('planet:'.length);
    const path = lanePath(state, anchor, front.id);
    if (path) {
      let last = state.planets[anchor]!.position;
      let reach = anchorNode.r;
      let i = 0;
      while (dist(last, front.position) > reach + waveRange) {
        let pick = -1;
        for (let j = i + 1; j < path.length - 1; j++) {
          if (dist(last, state.planets[path[j]!]!.position) <= reach + postRange) pick = j;
        }
        if (pick < 0) break; // разрыв длиннее связи — дальше цепочку не дотянуть
        chain.push(path[pick]!);
        last = state.planets[path[pick]!]!.position;
        reach = postRange;
        i = pick;
      }
    }
  }

  // Правило 3: на каждое место цепочки — ближайший свободный пост.
  const free = settled.filter((f) => !f.battleId);
  for (const spot of chain) {
    const at = state.planets[spot]!.position;
    let best: { f: (typeof free)[number]; d: number } | null = null;
    for (const f of free) {
      const pos = fleetPositionAt(state, f, state.time);
      if (!pos) continue;
      const d = dist(pos, at);
      if (!best || d < best.d || (d === best.d && f.id < best.f.id)) best = { f, d };
    }
    if (!best) break;
    free.splice(free.indexOf(best.f), 1);
    const f = best.f;
    const heading = f.movement ? (f.movement.destination ?? f.movement.to) : f.location;
    if (heading !== spot) plan.moves.push({ fleetId: f.id, to: spot });
  }

  // Правила 4–5: постройка того, чего не хватает, по одному за раз.
  // «Уже заказано» — и в работе (`construction.complete` в расписании), и в очереди мира:
  // верфь, занятая крейсером, держит ретранслятор в очереди, и без второй проверки бот
  // заказывал бы его каждый тик.
  type Order = { kind?: string; unit?: string; building?: string; playerId?: string };
  const queued = (match: (p: Order) => boolean): boolean =>
    state.scheduled.some(
      (e) =>
        e.type === 'construction.complete' &&
        (e.payload as Order).playerId === npc &&
        match(e.payload as Order),
    ) || mine.some((p) => (p.buildQueue ?? []).some((q) => q.playerId === npc && match(q)));
  const purse = state.players[npc]?.resources ?? {};
  const affords = (cost: Record<string, number>): boolean =>
    Object.entries(cost).every(([res, n]) => (purse[res] ?? 0) >= n);
  const yard = mine
    .filter((p) =>
      p.buildings.some((b) => b.hp > 0 && data.buildings[b.type]?.enablesShipConstruction),
    )
    .sort((a, b) => byId(a.id, b.id))[0];
  const postUnit = postUnits[0]!;
  if (
    yard &&
    chain.length > settled.length &&
    !queued((p) => p.kind === 'unit' && postUnits.includes(p.unit ?? '')) &&
    affords(data.units[postUnit]!.cost)
  ) {
    plan.builds.push({ planetId: yard.id, unit: postUnit });
  }
  const centerBuilding = Object.keys(data.buildings)
    .sort(byId)
    .find((id) => buildingLevel(data.buildings[id]!, 1).relayRange > 0);
  const standing = view.nodes.some((n) => n.kind === 'center');
  if (
    yard &&
    centerBuilding &&
    !standing &&
    !queued((p) => p.kind === 'building' && p.building === centerBuilding) &&
    affords(data.buildings[centerBuilding]!.cost)
  ) {
    plan.builds.push({ planetId: yard.id, building: centerBuilding });
  }
  return plan;
}
