/**
 * Сеть Роя — кто с кем связан прямо сейчас (`docs/swarm-behavior.md`, решения владельца
 * 2026-09-24).
 *
 * Чистая функция над состоянием: её читают модуль сети (копирование знания при
 * событиях), модуль адаптации (что знает часть органа), драйверы Роя (куда ставить
 * ретрансляторы) и клиент (что рисовать). Одна геометрия на всех — иначе рисовалась бы
 * одна сеть, а знание текло бы по другой.
 *
 * Правила:
 *
 * 1. **Узел — это центр данных или ретранслятор.** Центр — здание мира с радиусом связи
 *    (`relayRange` уровня), ретранслятор — флот, несущий юнит с радиусом связи (большой
 *    или малый). Позиция флота берётся в момент `now` — идущий ретранслятор связывает
 *    по пути, а не только в конце пути.
 * 2. **Связь — пересечение кругов** (решение владельца): два узла связаны, когда
 *    расстояние между ними не больше суммы радиусов. Связность транзитивна: цепочка
 *    ретрансляторов связывает дальние миры.
 * 3. **Узел ест энергию** (решение владельца «сеть ест энергию»). Пока у Роя нет долга
 *    по энергии, питаются все. Долг (`Player.arrears` содержит `energy`) — работают
 *    только узлы, на которые хватает номинальной выработки его миров, ближние к центрам
 *    первыми; первый не поместившийся гасит себя и всех дальше. Нехватка рвёт сеть с
 *    краёв, а не случайной дырой посередине.
 * 4. **Часть сети — связная компонента узлов.** Её ключ — наименьший id держателя среди
 *    её узлов: стабилен при любом порядке ключей в состоянии.
 * 5. **Держатели знания** — центры, флоты и миры Роя. Флот с ретранслятором — узел сам.
 *    Флот без ретранслятора связан, только стоя на своём мире с работающим центром
 *    (ответ владельца: «без малого ретранслятора опыт передаётся только по возвращении
 *    на свою планету с центром»). Мир без центра связан, если его накрывает круг
 *    работающего узла (территориальное покрытие). Всё прочее — отрезано: своя часть из
 *    одного держателя.
 */
import type { FleetId, GameState, PlanetId, PlayerId } from '../state/gameState';
import { buildingLevel, type GameData } from '../data/schemas';
import { fleetPositionAt } from '../state/fleetPosition';

/** Держатель знания: `planet:<id>` или `fleet:<id>`. */
export type HolderId = string;
export const planetHolder = (id: PlanetId): HolderId => `planet:${id}`;
export const fleetHolder = (id: FleetId): HolderId => `fleet:${id}`;

/** Ресурс, который ест сеть. */
export const NET_ENERGY = 'energy';

export interface NetNode {
  /** Держатель, которым узел и является. */
  id: HolderId;
  kind: 'center' | 'relay';
  x: number;
  y: number;
  /** Радиус связи, map units. */
  r: number;
  /** Энергия в сутки, которую узел ест. */
  upkeep: number;
}

export interface SwarmNetView {
  /** Все узлы места в момент `now`, в порядке id. */
  nodes: NetNode[];
  /** Узлы, на которые хватило энергии. */
  powered: Set<HolderId>;
  /** Держатель → ключ его части. Есть у каждого центра, флота и мира места. */
  partOf: Map<HolderId, string>;
}

const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Узлы сети места `owner` в момент `now` (правило 1). */
export function swarmNodes(
  state: GameState,
  data: GameData,
  owner: PlayerId,
  now: number,
): NetNode[] {
  const out: NetNode[] = [];
  for (const id of Object.keys(state.planets).sort()) {
    const planet = state.planets[id];
    if (!planet || planet.owner !== owner) continue;
    let r = 0;
    let upkeep = 0;
    for (const b of planet.buildings) {
      if (b.hp <= 0) continue; // руины не связывают
      const def = data.buildings[b.type];
      if (!def) continue;
      const level = buildingLevel(def, b.level);
      if (level.relayRange <= 0) continue;
      r = Math.max(r, level.relayRange);
      upkeep += level.upkeep[NET_ENERGY] ?? 0;
    }
    if (r > 0)
      out.push({
        id: planetHolder(id),
        kind: 'center',
        x: planet.position.x,
        y: planet.position.y,
        r,
        upkeep,
      });
  }
  for (const id of Object.keys(state.fleets).sort()) {
    const fleet = state.fleets[id];
    if (!fleet || fleet.owner !== owner) continue;
    let r = 0;
    let upkeep = 0;
    for (const stack of fleet.units) {
      if (stack.count <= 0) continue;
      const def = data.units[stack.unit];
      if (!def || def.relayRange <= 0) continue;
      r = Math.max(r, def.relayRange);
      upkeep += (def.upkeep[NET_ENERGY] ?? 0) * stack.count;
    }
    if (r <= 0) continue;
    const at = fleetPositionAt(state, fleet, now);
    if (!at) continue;
    out.push({ id: fleetHolder(id), kind: 'relay', x: at.x, y: at.y, r, upkeep });
  }
  return out;
}

/** Номинальная выработка энергии миров места за сутки (по уровням зданий). */
function energyPerDay(state: GameState, data: GameData, owner: PlayerId): number {
  let perHour = 0;
  for (const id of Object.keys(state.planets).sort()) {
    const planet = state.planets[id];
    if (!planet || planet.owner !== owner) continue;
    for (const b of planet.buildings) {
      if (b.hp <= 0) continue;
      const def = data.buildings[b.type];
      if (def) perHour += buildingLevel(def, b.level).produces[NET_ENERGY] ?? 0;
    }
  }
  return perHour * 24;
}

const d2 = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);

/** Какие узлы питаются (правило 3). */
export function poweredNodes(
  state: GameState,
  data: GameData,
  owner: PlayerId,
  nodes: readonly NetNode[],
): Set<HolderId> {
  if (!state.players[owner]?.arrears?.includes(NET_ENERGY)) return new Set(nodes.map((n) => n.id));
  const budget = energyPerDay(state, data, owner);
  const centers = nodes.filter((n) => n.kind === 'center').sort(byId);
  const reach = (n: NetNode): number =>
    centers.length === 0 ? 0 : Math.min(...centers.map((c) => d2(c, n)));
  const relays = nodes
    .filter((n) => n.kind === 'relay')
    .sort((a, b) => reach(a) - reach(b) || byId(a, b));
  const out = new Set<HolderId>();
  let spent = 0;
  for (const node of [...centers, ...relays]) {
    if (spent + node.upkeep > budget) break; // дальше — темно
    spent += node.upkeep;
    out.add(node.id);
  }
  return out;
}

/** Связаны ли два узла (правило 2). */
export function linked(a: NetNode, b: NetNode): boolean {
  const r = a.r + b.r;
  return d2(a, b) <= r * r;
}

/** Карта частей сети места `owner` в момент `now`. */
export function swarmNet(
  state: GameState,
  data: GameData,
  owner: PlayerId,
  now: number,
): SwarmNetView {
  const nodes = swarmNodes(state, data, owner, now);
  const powered = poweredNodes(state, data, owner, nodes);
  const live = nodes.filter((n) => powered.has(n.id));

  // Связные компоненты — объединение по пересечению кругов.
  const parent = new Map<HolderId, HolderId>(live.map((n) => [n.id, n.id]));
  const root = (id: HolderId): HolderId => {
    let at = id;
    while (parent.get(at) !== at) at = parent.get(at)!;
    return at;
  };
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (!linked(live[i]!, live[j]!)) continue;
      const a = root(live[i]!.id);
      const b = root(live[j]!.id);
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b); // корень — наименьший id
    }
  }
  const partOf = new Map<HolderId, string>();
  for (const n of live) partOf.set(n.id, root(n.id));

  // Миры: центр — сам узел; без работающего центра — под кругом живого узла или отрезан.
  for (const id of Object.keys(state.planets).sort()) {
    const planet = state.planets[id];
    if (!planet || planet.owner !== owner) continue;
    const holder = planetHolder(id);
    if (partOf.has(holder)) continue;
    const cover = live.find((n) => d2(n, planet.position) <= n.r * n.r);
    partOf.set(holder, cover ? root(cover.id) : holder);
  }
  // Флоты без живого ретранслятора: только стоя на своём мире с работающим центром.
  for (const id of Object.keys(state.fleets).sort()) {
    const fleet = state.fleets[id];
    if (!fleet || fleet.owner !== owner) continue;
    const holder = fleetHolder(id);
    if (partOf.has(holder)) continue;
    const home =
      fleet.location != null && !fleet.movement ? planetHolder(fleet.location) : undefined;
    const centerThere =
      home !== undefined && live.some((n) => n.id === home && n.kind === 'center');
    partOf.set(holder, centerThere ? root(home) : holder);
  }
  return { nodes, powered, partOf };
}

/** Держатели каждой части: ключ части → её держатели в порядке id. */
export function partsOf(view: SwarmNetView): Map<string, HolderId[]> {
  const out = new Map<string, HolderId[]>();
  for (const [holder, part] of [...view.partOf.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const list = out.get(part);
    if (list) list.push(holder);
    else out.set(part, [holder]);
  }
  return out;
}

/** Что знает держатель прямо сейчас: столкновения и рецепты. */
export interface SwarmKnown {
  /** Номера столкновений, известные части; `null` — сети нет, знание Роя общее. */
  known: ReadonlySet<number> | null;
  /** Рецепты части: модуль → уровень, который она умеет растить. */
  recipes: Record<string, number>;
}

/**
 * Знание, доступное держателю `holder` в момент `now`: объединение знания всех
 * держателей его части. Сети нет (`state.swarmNet` не заведён — модуль не собран или
 * матч не PvE) — знание общее, как было до сети: весь журнал и общий рецепт. Это
 * откат по инварианту 3, а не второе правило.
 */
export function knowledgeOf(
  state: GameState,
  data: GameData,
  owner: PlayerId,
  holder: HolderId,
  now: number,
  given?: SwarmNetView,
): SwarmKnown {
  const net = state.swarmNet;
  if (!net) return { known: null, recipes: { ...(state.swarmRecipes ?? {}) } };
  const view = given ?? swarmNet(state, data, owner, now);
  const part = view.partOf.get(holder) ?? holder;
  const known = new Set<number>();
  const recipes: Record<string, number> = {};
  const members = [...view.partOf.entries()].filter(([, p]) => p === part).map(([h]) => h);
  if (!view.partOf.has(holder)) members.push(holder);
  for (const member of members.sort()) {
    const k = net.holders[member];
    if (!k) continue;
    for (const ordinal of k.known) known.add(ordinal);
    for (const [moduleId, level] of Object.entries(k.recipes ?? {}))
      recipes[moduleId] = Math.max(recipes[moduleId] ?? 0, level);
  }
  return { known, recipes };
}
