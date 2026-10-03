/**
 * Последний контрудар Роя (глава VI §8.7, кирпич PVR-8.4).
 *
 * Это ЭВРИСТИКА ИИ, а не правило мира: по ADR `docs/explanations/05` тактика NPC не живёт
 * в модулях ядра и не входит в контракт реплея. Здесь — чистая функция «кого и куда»,
 * которую зовут оба драйвера Роя: бот прототипа (`prototype/src/ai.ts`) и серверный
 * оркестратор (`packages/server/src/pveOrchestrator.ts`), как ответ на маяк (`beacon.ts`).
 * Одна функция на два хоста — чтобы Рой бил одинаково в одиночном забеге и на сервере.
 *
 * Правило:
 * 1. **Замысел объявляет карта** (`operation.counterattack: {after, target}`): внешние
 *    позиции Роя и цель удара.
 * 2. **Пора — когда Рой потерял все внешние позиции, а цель сторона штурма уже знает**
 *    (`missionFacts.found`). Рой бьёт по эвакуации, о которой знают, а не открывает её сам:
 *    иначе удар выдал бы место раньше эпизода (§8.4).
 * 3. **Идёт то, что уцелело**: флоты неразгромленных главных соединений (учёт контракта
 *    операции — вместе с влитыми подкреплениями) и построенные Роем флоты сбора
 *    (`isProducedForce`). Разгромленное соединение и уничтоженный флот не воскресают, нового
 *    ничего не появляется: драйвер отдаёт приказы только тем, кто есть (§8.7).
 * 4. **Свободный — в путь, остальные ждут своей очереди**: стоящий не в бою флот получает
 *    курс к цели; идущий доедет и получит приказ потом; стоящий у цели остаётся. Все они в
 *    `held`: общий бот их не уводит, не сливает и не шлёт ни на маяк, ни в улей.
 */
import type { FleetId, GameState, PlanetId, PlayerId } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { isProducedForce } from './pveStaging';

/** Тактика контрудара для драйверов Роя: кого держать и кого куда вести. */
export interface CounterattackPlan {
  /** Флоты контрудара: общий бот им приказов не отдаёт. */
  held: Set<FleetId>;
  /** Курсы свободных флотов к цели. */
  moves: Array<{ fleetId: FleetId; to: PlanetId }>;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Пора ли контрудару (правило 2). */
export function counterattackDue(state: GameState, npc: PlayerId): boolean {
  const ca = state.operation?.counterattack;
  if (!ca || state.pve?.npcPlayerId !== npc || !state.planets[ca.target]) return false;
  if (ca.after.some((id) => state.planets[id]?.owner === npc)) return false;
  return Object.values(state.missionFacts?.found ?? {}).some((sites) => sites.includes(ca.target));
}

/** Кого Рой (`npc`) ведёт в контрудар прямо сейчас. Детерминированно: id сравниваются. */
export function counterattackPlan(
  state: GameState,
  data: GameData,
  npc: PlayerId,
): CounterattackPlan {
  const plan: CounterattackPlan = { held: new Set(), moves: [] };
  if (!counterattackDue(state, npc)) return plan;
  const op = state.operation!;
  const target = op.counterattack!.target;
  const ids = new Set<FleetId>();
  for (const force of Object.values(op.forces))
    if (force.brokenAt === undefined) for (const id of force.fleets) ids.add(id);
  for (const [id, f] of Object.entries(state.fleets)) if (isProducedForce(f, data)) ids.add(id);
  for (const id of [...ids].sort(byId)) {
    const f = state.fleets[id];
    if (!f || f.owner !== npc || !f.units.some((u) => u.count > 0)) continue;
    plan.held.add(id);
    if (f.movement || f.battleId || f.location == null || f.location === target) continue;
    plan.moves.push({ fleetId: id, to: target });
  }
  return plan;
}
