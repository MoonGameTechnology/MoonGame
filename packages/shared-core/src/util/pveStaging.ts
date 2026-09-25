/**
 * Откуда идут волны и что уходит вместе с ними (решения владельца 2026-09-24: «волны идут
 * только из дальнего мира; к ним прибавляется то, что произвёл уже сам Рой»).
 *
 * 1. **Волна рождается в улье** — мире, где она рождалась на посеве (`PveState.home`),
 *    пока он в руках NPC. Прежнее правило «мир NPC с наименьшим id» переносило роды к
 *    любому занятому пустому миру, в главе I — в двух шагах от дома игрока.
 * 2. **Улей пал — следующий дальний мир** (ответ владельца): мир NPC, самый дальний от
 *    миров игроков. Рой отступает вглубь, но волны не рождаются у порога игрока. Ничья —
 *    меньший id; миров игроков нет вовсе — меньший id, как было.
 * 3. **Построенное Роем уходит с волной.** Корабли, которые NPC построил на верфях, авто-сбор
 *    складывает во флот сбора (признак `rally`); такой флот ждёт в улье и вливается в
 *    ближайшую волну вместе с трюмом. Узлы сети (`relayRange`) с волной не уходят — их место
 *    на посту. Стартовые флоты карты живут своей жизнью: они не построены Роем.
 *
 * Правило 1–3 читают модуль волн (ядро: где рождается и что вливается) и драйверы Роя
 * (тактика: флот сбора не уводится из улья и едет туда, если построен на другой верфи).
 */
import type { Fleet, FleetId, GameState, PlanetId, PlayerId } from '../state/gameState';
import type { GameData } from '../data/schemas';

/** Признак флота сбора: сюда авто-сбор кладёт свежепостроенные корабли. */
export const RALLY_TRAIT = 'rally';

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Где рождается следующая волна (правила 1–2). */
export function waveStagingWorld(state: GameState): PlanetId | undefined {
  const pve = state.pve;
  if (!pve) return undefined;
  const npc = pve.npcPlayerId;
  if (pve.home !== undefined && state.planets[pve.home]?.owner === npc) return pve.home;
  const mine = Object.values(state.planets)
    .filter((p) => p.owner === npc)
    .sort((a, b) => byId(a.id, b.id));
  if (mine.length === 0) return undefined;
  const theirs = Object.values(state.planets).filter(
    (p) => p.owner !== null && p.owner !== npc && !state.players[p.owner]?.npc,
  );
  if (theirs.length === 0) return mine[0]!.id;
  let best = mine[0]!;
  let bestD = -1;
  for (const p of mine) {
    const d = Math.min(
      ...theirs.map((t) =>
        Math.sqrt(
          (t.position.x - p.position.x) * (t.position.x - p.position.x) +
            (t.position.y - p.position.y) * (t.position.y - p.position.y),
        ),
      ),
    );
    if (d > bestD) {
      best = p;
      bestD = d;
    }
  }
  return best.id;
}

/** Флот — построенное Роем, которое уходит с волной (правило 3). */
export function isProducedForce(fleet: Fleet, data: GameData): boolean {
  return (
    fleet.traits.includes(RALLY_TRAIT) &&
    !fleet.units.some((st) => (data.units[st.unit]?.relayRange ?? 0) > 0)
  );
}

/** Построенное Роем, стоящее в `at` и готовое уйти с волной: ни в пути, ни в бою. */
export function producedForcesAt(
  state: GameState,
  data: GameData,
  npc: PlayerId,
  at: PlanetId,
): FleetId[] {
  return Object.keys(state.fleets)
    .sort(byId)
    .filter((id) => {
      const f = state.fleets[id]!;
      return (
        f.owner === npc &&
        f.location === at &&
        !f.movement &&
        !f.battleId &&
        isProducedForce(f, data)
      );
    });
}

/** Тактика сбора для драйверов Роя: что держать в улье и что туда вести. */
export interface MusterPlan {
  /** Флоты сбора в улье: общий бот их не уводит и не сливает — они ждут волну. */
  held: Set<FleetId>;
  /** Флоты сбора на других верфях — в улей. */
  moves: Array<{ fleetId: FleetId; to: PlanetId }>;
}

export function musterPlan(state: GameState, data: GameData, npc: PlayerId): MusterPlan {
  const plan: MusterPlan = { held: new Set(), moves: [] };
  const home = waveStagingWorld(state);
  if (home === undefined || state.pve?.npcPlayerId !== npc) return plan;
  for (const id of Object.keys(state.fleets).sort(byId)) {
    const f = state.fleets[id]!;
    if (f.owner !== npc || !isProducedForce(f, data)) continue;
    plan.held.add(id);
    // Стоящий на другой верфи — в улей; идущий куда-то доедет, и приказ получит потом.
    if (f.battleId || f.movement || f.location === home) continue;
    plan.moves.push({ fleetId: id, to: home });
  }
  return plan;
}
