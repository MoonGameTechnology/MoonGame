/**
 * RETR-2 — кто СЕЙЧАС обязан отступить по стоячему приказу.
 *
 * Чистая функция, и это граница ответственности, а не стилистика: правило «пора
 * отходить» живёт в ЯДРЕ, а драйверы (`packages/server/src/standingOrderDriver.ts` и
 * прототипный `soloDrivers.ts`) только превращают ответ в приказ. Посчитай порог в
 * драйвере — и он разъедется между сервером и прототипом, как уже разъезжались стоячие
 * приказы до CONV-7.
 *
 * Порог — доля ОСТАВШЕГОСЯ корпуса от максимального (решение владельца 2026-09-22):
 * «уходи, когда от флота осталось меньше 30%». Считается по тем же стекам, по которым
 * считается урон (`hullFraction` → `missingHull`/`maxHull`), поэтому порог не может
 * разойтись с тем, что игрок видит на полоске флота.
 */
import type { GameData } from '../data/schemas';
import type { GameState, PlanetId, PlayerId } from './gameState';
import { hullFraction } from '../util/repair';

/** Флот, которому приказ велит уходить прямо сейчас, и куда. */
export interface AutoRetreatDue {
  fleetId: string;
  owner: PlayerId;
  to: PlanetId;
}

/**
 * Флоты, у которых стоит авто-отступление, которые ПРЯМО СЕЙЧАС в бою и чей корпус
 * просел до порога. Обход по отсортированным ключам: JSONB не хранит порядок ключей
 * объекта, и несортированный дал бы порядок приказов, зависящий от хоста и гибернации
 * (инвариант №6) — ровно ту же ловушку уже ловили три соседних драйвера.
 *
 * Здесь НЕ проверяется, можно ли отступить: это решит сам `fleet.retreat` (десант, к
 * примеру, отступать не умеет и ответит `E_CANNOT_RETREAT`). Вторая копия его условий
 * разъехалась бы с ним на первой же правке.
 */
export function autoRetreatDue(state: GameState, data: GameData): AutoRetreatDue[] {
  const orders = state.autoRetreat;
  if (!orders) return [];
  const out: AutoRetreatDue[] = [];
  for (const fleetId of Object.keys(orders).sort()) {
    const order = orders[fleetId];
    const fleet = state.fleets[fleetId];
    if (!order || !fleet) continue;
    // Приказ срабатывает только В БОЮ: «осталось мало корпуса» само по себе не повод
    // куда-то лететь — побитый флот, стоящий в доке, никуда бежать не должен.
    if (fleet.battleId == null || !state.battles[fleet.battleId]) continue;
    if (hullFraction(fleet, data) > order.at) continue;
    out.push({ fleetId, owner: fleet.owner, to: order.to });
  }
  return out;
}
