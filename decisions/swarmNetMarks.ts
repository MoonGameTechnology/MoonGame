/**
 * Что игрок видит от сети Роя на карте (решение владельца 2026-09-24: «только
 * разведанное»).
 *
 * Узел сети — центр данных на мире или флот с ретранслятором. Игрок видит его круг связи,
 * только когда видит сам узел: мир опознан, флот стоит (или идёт) у опознанного узла. Связь
 * между двумя видимыми узлами рисуется, если их круги сходятся, — ровно по тому правилу,
 * по которому течёт знание (`linked`). Что делается в сети дальше видимого, игрок узнаёт
 * по поведению Роя, а не по карте: ни питания узлов, ни знания частей здесь нет.
 */
import {
  fleetNodeAt,
  linked,
  swarmNodes,
  type GameData,
  type GameState,
  type NetNode,
} from '../packages/shared-core/src/index';

export interface NetMark {
  x: number;
  y: number;
  /** Радиус связи в единицах карты. */
  r: number;
  kind: 'center' | 'relay';
}

export interface SwarmNetMarks {
  nodes: NetMark[];
  /** Пары индексов в `nodes`, чьи круги сходятся. */
  links: Array<[number, number]>;
}

/** Видимые игроку узлы сети Роя. `known` — опознан ли узел карты (туман клиента). */
export function swarmNetMarks(
  state: GameState,
  data: GameData,
  known: (planetId: string | null | undefined) => boolean,
): SwarmNetMarks {
  const npc = state.pve?.npcPlayerId;
  if (npc === undefined) return { nodes: [], links: [] };
  const seen: NetNode[] = swarmNodes(state, data, npc, state.time).filter((n) => {
    if (n.kind === 'center') return known(n.id.slice('planet:'.length));
    const fleet = state.fleets[n.id.slice('fleet:'.length)];
    return !!fleet && known(fleetNodeAt(state, fleet, state.time));
  });
  const links: Array<[number, number]> = [];
  for (let i = 0; i < seen.length; i++)
    for (let j = i + 1; j < seen.length; j++) if (linked(seen[i]!, seen[j]!)) links.push([i, j]);
  return { nodes: seen.map((n) => ({ x: n.x, y: n.y, r: n.r, kind: n.kind })), links };
}
