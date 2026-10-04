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
 *
 * Правила v1 (глава V «Разорванная сеть», `docs/sector-zero-map-concepts.md` §7.4):
 *
 * 6. **Хребет сети стоит.** Пост, который связывает центры между собой, — основной или
 *    резервной цепочкой — держит место, и цепочка к фронту его не забирает. Хребет — посты
 *    на кратчайших (по числу связей) путях от центра к центру, и ещё один слой: посты,
 *    которые связывают центры без первых (резервная цепочка). Параллельные связи равной
 *    длины входят в первый слой. Сеть раскладки не разбирает сама себя, и разрыв остаётся
 *    делом рук противника. Пост, стоящий на мире с работающим центром, в хребет не входит:
 *    он «на стапеле», круг центра там и так есть, и новый ретранслятор не застревает у
 *    верфи, где его построили. Место цепочки, где уже стоит пост хребта, занято.
 * 7. **Разорванную сеть Рой чинит.** Центр не в части улья — Рой тянет цепочку постов от
 *    ближайшего узла части улья к ближайшему узлу отрезанной части (тот же жадный шаг по
 *    лейнам, что к фронту), по одному разрыву за раз. Сперва свободными постами, не
 *    хватает — строит новый на ближайшей к разрыву верфи, по одному за раз и за свои
 *    средства: бесплатного узла и охраны за спиной нет. Починка важнее цепочки к фронту.
 *    Цепочку, которую не дотянуть (разрыв лейна длиннее связи), Рой не начинает.
 */
import type { FleetId, GameState, Planet, PlanetId, PlayerId } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { buildingLevel } from '../data/schemas';
import { fleetPositionAt } from '../state/fleetPosition';
import { isForkSite } from '../state/forkSite';
import {
  fleetHolder,
  linked,
  planetHolder,
  swarmNet,
  type HolderId,
  type NetNode,
} from './swarmNet';

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

/**
 * Посты на кратчайших (по числу связей) путях между центрами. Центр — конец пути, а не
 * пересадка: путь от одного центра к другому идёт только через посты.
 */
function shortestLinkPosts(centers: readonly NetNode[], posts: readonly NetNode[]): Set<HolderId> {
  const nodes = [...centers, ...posts];
  const near = new Map(nodes.map((n) => [n.id, nodes.filter((m) => m !== n && linked(n, m))]));
  const hops = new Map<HolderId, Map<HolderId, number>>();
  for (const c of centers) {
    const d = new Map<HolderId, number>([[c.id, 0]]);
    const queue = [c];
    while (queue.length > 0) {
      const n = queue.shift()!;
      if (n !== c && n.kind === 'center') continue;
      for (const m of near.get(n.id)!) {
        if (d.has(m.id)) continue;
        d.set(m.id, d.get(n.id)! + 1);
        queue.push(m);
      }
    }
    hops.set(c.id, d);
  }
  const out = new Set<HolderId>();
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const from = hops.get(centers[i]!.id)!;
      const to = hops.get(centers[j]!.id)!;
      const span = from.get(centers[j]!.id);
      if (span === undefined) continue;
      for (const p of posts) {
        const a = from.get(p.id);
        const b = to.get(p.id);
        if (a !== undefined && b !== undefined && a + b === span) out.add(p.id);
      }
    }
  }
  return out;
}

/**
 * Хребет сети (правило 6): посты кратчайших связей между центрами — и ещё один слой, который
 * связывает центры без них (резервная цепочка любой длины). Дальше слоёв нет: пост цепочки
 * к фронту, случайно замкнувший круг, хребтом не становится, и Рой не строит новые посты
 * взамен застрявших. `eligible` — посты, которые вообще могут быть хребтом.
 */
function spinePosts(live: readonly NetNode[], eligible: ReadonlySet<HolderId>): Set<HolderId> {
  const centers = live.filter((n) => n.kind === 'center');
  let pool = live.filter((n) => n.kind === 'relay' && eligible.has(n.id));
  const spine = new Set<HolderId>();
  for (let layer = 0; layer < 2; layer++) {
    const found = shortestLinkPosts(centers, pool);
    if (found.size === 0) break;
    for (const id of found) spine.add(id);
    pool = pool.filter((n) => !found.has(n.id));
  }
  return spine;
}

/**
 * Жадная цепочка постов по пути `path` (лейны): от узла `from` дальше и дальше, пока круг
 * последнего поста не сойдётся с кругом цели (`to` с радиусом `toR`). Каждый следующий пост —
 * самый дальний мир пути, до которого круги ещё сходятся. `complete` — цепочка дотянулась.
 */
function greedyChain(
  state: GameState,
  path: readonly PlanetId[],
  from: { x: number; y: number; r: number },
  to: { x: number; y: number },
  toR: number,
  postRange: number,
): { spots: PlanetId[]; complete: boolean } {
  const spots: PlanetId[] = [];
  let last: { x: number; y: number } = from;
  let reach = from.r;
  let i = 0;
  while (dist(last, to) > reach + toR) {
    let pick = -1;
    for (let j = i + 1; j < path.length - 1; j++) {
      if (dist(last, state.planets[path[j]!]!.position) <= reach + postRange) pick = j;
    }
    if (pick < 0) return { spots, complete: false }; // разрыв длиннее связи
    spots.push(path[pick]!);
    last = state.planets[path[pick]!]!.position;
    reach = postRange;
    i = pick;
  }
  return { spots, complete: true };
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

  const view = swarmNet(state, data, npc, state.time);
  const live = view.nodes.filter((n) => view.powered.has(n.id));
  const centers = live.filter((n) => n.kind === 'center');
  const mine = Object.values(state.planets).filter((p) => p.owner === npc);

  // Правило 6: хребет держит место — свободны только остальные посты. Пост на мире с
  // работающим центром — на стапеле, не в хребте.
  const atCenter = (f: (typeof posts)[number]): boolean =>
    !f.movement && f.location != null && centers.some((c) => c.id === planetHolder(f.location!));
  const spine = spinePosts(
    live,
    new Set(posts.filter((f) => !atCenter(f)).map((f) => fleetHolder(f.id))),
  );
  const loose = settled.filter((f) => !spine.has(fleetHolder(f.id)));

  // Правило 7: центр вне части улья — цепочка от ближайшего узла улья к ближайшему узлу
  // отрезанной части. Узлы-опоры — центры и стоящие посты: волна с малым ретранслятором
  // уйдёт, а цепочка к ней останется висеть.
  const repair: PlanetId[] = [];
  const home = state.pve?.npcPlayerId === npc ? state.pve.home : undefined;
  const hub = centers.find((n) => home !== undefined && n.id === planetHolder(home)) ?? centers[0];
  const planetOf = (n: NetNode): PlanetId | undefined => {
    if (n.kind === 'center') return n.id.slice('planet:'.length);
    const f = state.fleets[n.id.slice('fleet:'.length)];
    return f && !f.movement && f.location != null && posts.includes(f) ? f.location : undefined;
  };
  if (hub) {
    const hubPart = view.partOf.get(hub.id);
    const anchors = live.filter((n) => planetOf(n) !== undefined);
    const ours = anchors.filter((n) => view.partOf.get(n.id) === hubPart);
    let gap: { a: NetNode; b: NetNode; d: number } | undefined;
    for (const b of anchors) {
      const part = view.partOf.get(b.id);
      if (part === hubPart || !centers.some((c) => view.partOf.get(c.id) === part)) continue;
      for (const a of ours) {
        const d = dist(a, b);
        const tie = gap && d === gap.d && (byId(a.id, gap.a.id) || byId(b.id, gap.b.id)) < 0;
        if (!gap || d < gap.d || tie) gap = { a, b, d };
      }
    }
    const path = gap ? lanePath(state, planetOf(gap.a)!, planetOf(gap.b)!) : null;
    if (gap && path) {
      const link = greedyChain(state, path, gap.a, gap.b, gap.b.r, postRange);
      if (link.complete) repair.push(...link.spots);
    }
  }

  // Правило 2: цепочка от работающего центра к фронту.
  // Крепость игрока на развилке — не мир и не фронт (FORT-6.1): лейнов к ней нет, и
  // цепочка к ней не протянулась бы никогда.
  const human = (p: Planet): boolean =>
    p.owner !== null && p.owner !== npc && !state.players[p.owner]?.npc && !isForkSite(p);
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
    // Разрыв длиннее связи — дальше цепочку не дотянуть, но начало её всё равно держит.
    if (path)
      chain.push(
        ...greedyChain(state, path, anchorNode, front.position, waveRange, postRange).spots,
      );
  }

  // Правило 3: на каждое место цепочки — ближайший свободный пост; починка — первой. Место,
  // где стоит (или куда идёт) пост хребта, уже занято.
  const headingOf = (f: (typeof posts)[number]): PlanetId | null =>
    f.movement ? (f.movement.destination ?? f.movement.to) : f.location;
  const taken = new Set(
    settled.filter((f) => spine.has(fleetHolder(f.id))).map((f) => headingOf(f)),
  );
  const spots = [...repair, ...chain.filter((spot) => !repair.includes(spot))].filter(
    (spot) => !taken.has(spot),
  );
  const free = loose.filter((f) => !f.battleId);
  for (const spot of spots) {
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
    if (headingOf(best.f) !== spot) plan.moves.push({ fleetId: best.f.id, to: spot });
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
  const yards = mine
    .filter((p) =>
      p.buildings.some((b) => b.hp > 0 && data.buildings[b.type]?.enablesShipConstruction),
    )
    .sort((a, b) => byId(a.id, b.id));
  const yard = yards[0];
  // Починке не хватает постов — ретранслятор строится на ближайшей к разрыву верфи.
  const nearGap = (spot: PlanetId): Planet | undefined => {
    const at = state.planets[spot]!.position;
    return [...yards].sort(
      (a, b) => dist(a.position, at) - dist(b.position, at) || byId(a.id, b.id),
    )[0];
  };
  const postYard = repair.length > loose.length ? nearGap(repair[0]!) : yard;
  const postUnit = postUnits[0]!;
  if (
    postYard &&
    spots.length > loose.length &&
    !queued((p) => p.kind === 'unit' && postUnits.includes(p.unit ?? '')) &&
    affords(data.units[postUnit]!.cost)
  ) {
    plan.builds.push({ planetId: postYard.id, unit: postUnit });
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
