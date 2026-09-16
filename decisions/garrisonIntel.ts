// ЧТО ИГРОК ЗНАЕТ О ГАРНИЗОНЕ ЧУЖОГО МИРА — и знает ли вообще.
//
// Правило владельца №1 (2026-09-16): «бот не высаживает десант на планету, не зная,
// какой там гарнизон». Чтобы его соблюдать, нужно уметь отличать три разных ответа,
// которые до сих пор сливались в один:
//
//   · ВИЖУ СЕЙЧАС     — числа точные, это сама планета;
//   · ПОМНЮ           — числа из снимка тумана, на планете могло измениться всё;
//   · НЕ ЗНАЮ         — знания нет, и это НЕ «гарнизон пуст».
//
// Последнее различие и есть суть правила. Бот читал `planet.garrison` напрямую, то есть
// был ВСЕВЕДУЩ: пустой гарнизон невидимого мира он видел так же уверенно, как свой
// собственный. Память тумана в ядре есть давно (`visibilityModule` пишет `state.fog`),
// ей просто никто не пользовался.
//
// Fail-secure по смыслу: нет знания — `null`, а не пустой список. Пустой список значит
// «там точно никого», и спутать эти два ответа — ровно тот способ потерять десант,
// который правило и запрещает.
import { identifiedNodes } from '../packages/shared-core/src/state/visibility';
import type { GameState, PlayerId, PlanetId } from '../packages/shared-core/src/state/gameState';
import type { GameData, UnitStack } from '../packages/shared-core/src/index';

/**
 * Сколько живёт ПАМЯТЬ о гарнизоне, прежде чем перестать считаться знанием — сутки
 * игрового времени. За сутки мир успевает достроить оборону и принять подкрепление,
 * поэтому вчерашний снимок — уже не разведданные, а догадка.
 */
export const INTEL_MAX_AGE_MS = 24 * 3_600_000;

export interface GarrisonIntel {
  /** Что известно о гарнизоне. Пустой список значит «известно, что пусто». */
  units: UnitStack[];
  /** Когда это было правдой (игровое время). */
  at: number;
  /** Видно ПРЯМО СЕЙЧАС — тогда числа точные, а не вспомненные. */
  live: boolean;
}

/**
 * Что `viewerId` знает о гарнизоне мира `planetId`. `null` — не знает ничего.
 *
 * `identified` можно передать снаружи: на один тик бот спрашивает про десятки миров, а
 * `identifiedNodes` считает покрытие сенсоров по всему флоту — пересчитывать его на
 * каждый мир значит платить за один и тот же ответ столько раз, сколько миров на карте.
 */
export function knownGarrison(
  state: GameState,
  viewerId: PlayerId,
  planetId: PlanetId,
  data: GameData,
  identified?: ReadonlySet<string>,
): GarrisonIntel | null {
  const planet = state.planets[planetId];
  if (!planet) return null;
  const seen = identified ?? identifiedNodes(state, viewerId, data);
  if (seen.has(planetId)) {
    return { units: planet.garrison.map((st) => ({ ...st })), at: state.time, live: true };
  }
  const snap = state.fog?.[viewerId]?.[planetId];
  if (!snap) return null;
  return { units: snap.garrison.map((st) => ({ ...st })), at: snap.at, live: false };
}

/** Годятся ли эти разведданные для решения. Живое наблюдение годится всегда. */
export function freshIntel(intel: GarrisonIntel | null, now: number): boolean {
  if (!intel) return false;
  return intel.live || now - intel.at <= INTEL_MAX_AGE_MS;
}
