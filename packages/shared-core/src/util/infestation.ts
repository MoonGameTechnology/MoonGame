/**
 * Заражённые постройки Роя (решение владельца 2026-09-24, после плейтеста: «у людей
 * почему-то есть ресурс биомасса»). Постройки с признаком `infected` — яма биомассы,
 * синаптический дигестер, улей — это органы Роя, а не заводы: работают они только у
 * фракции, которая ест биомассу (`consume_biomass`). Раньше признак лежал в данных и не
 * читался нигде, поэтому человек, взявший мир Роя или построивший яму сам, получал
 * биомассу.
 *
 * Одно правило на всех: экономика не начисляет добычу и не берёт содержание, ворота
 * стройки не пускают не-Рой, а на захваченном мире наземный гарнизон зачищает такие
 * постройки (`construction.ts`). Модули друг друга не импортируют — правило лежит здесь.
 */
import type { BuildingDef, GameData } from '../data/schemas';
import type { GameState, PlayerId } from '../state/gameState';

/** Признак постройки-органа Роя. */
export const INFECTED_TRAIT = 'infected';
/** Признак фракции, которая ест биомассу (Рой). */
export const FEEDS_ON_BIOMASS_TRAIT = 'consume_biomass';

/** Орган ли Роя эта постройка. */
export function isInfected(def: Pick<BuildingDef, 'traits'> | undefined): boolean {
  return def?.traits.includes(INFECTED_TRAIT) ?? false;
}

/** Ест ли владелец биомассу — то есть Рой ли он. Нет владельца или фракции — нет. */
export function feedsOnBiomass(
  state: Pick<GameState, 'players'>,
  owner: PlayerId | null,
  data: GameData,
): boolean {
  if (owner === null) return false;
  const faction = state.players[owner]?.faction;
  return (
    faction !== undefined && (data.factions[faction]?.traits ?? []).includes(FEEDS_ON_BIOMASS_TRAIT)
  );
}

/** Работает ли постройка у этого владельца: обычная — у всех, заражённая — только у Роя. */
export function worksFor(
  state: Pick<GameState, 'players'>,
  owner: PlayerId | null,
  def: Pick<BuildingDef, 'traits'> | undefined,
  data: GameData,
): boolean {
  return !isInfected(def) || feedsOnBiomass(state, owner, data);
}
