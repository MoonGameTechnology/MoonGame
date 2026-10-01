import type { GameData } from '../data/schemas';
import { defHasTrait } from '../data/traits';
import type { Fleet, GameState } from './gameState';
import { fleetPositionAt } from './fleetPosition';
import { deepClone } from '../util/clone';

export const MINE_SIGNATURE = 0.1;
export const MINE_DETECTION_RANGE = 24;
export const MINE_INSTALL_HOURS = 0.25;

/** Юнит мины (SM-3.6): в стеке `count` — заряды, модули — боевая часть заградителя. */
export const MINE_UNIT = 'mine';
/** Трейт, по которому ядро узнаёт мину. Правило по трейту, а не по id: модулю боя и
 *  тумана заградитель не известен, а новая мина в данных получит правило сама. */
export const MINE_TRAIT = 'mine';

/**
 * Мина — неподвижный отряд (SM-3.6, решение владельца 2026-09-30: «мина по сущности тоже
 * неподвижный космический юнит»). Отряд — мина, если в нём живы только мины: чужой юнит
 * делает его обычным флотом, и тогда правила мины к нему не применяются (fail-secure —
 * флот не спрячется под туманом мины и не пройдёт сквозь бой).
 */
export function isMineFleet(fleet: Pick<Fleet, 'units'>, data: GameData): boolean {
  const live = fleet.units.filter((s) => s.count > 0);
  return live.length > 0 && live.every((s) => defHasTrait(data.units[s.unit], MINE_TRAIT));
}

/**
 * Видна ли чужая мина: только если свой флот стоит не дальше `MINE_DETECTION_RANGE` от неё
 * (решение владельца 2026-09-30: «только вблизи»). Опознанный узел, окно шпионажа и союзник
 * её не раскрывают — иначе мина перестала бы быть ловушкой. Свои мины сенсором не служат.
 */
export function mineFleetVisible(state: GameState, mine: Fleet, viewer: string, data: GameData): boolean {
  if (mine.owner === viewer) return true;
  const at = fleetPositionAt(state, mine, state.time);
  if (!at) return false;
  return Object.values(state.fleets).some((f) => {
    if (f.owner !== viewer || !f.units.some((u) => u.count > 0) || isMineFleet(f, data)) return false;
    const pos = fleetPositionAt(state, f, state.time);
    return !!pos && (pos.x - at.x) ** 2 + (pos.y - at.y) ** 2 <= MINE_DETECTION_RANGE ** 2;
  });
}

/** Срез заградителей для зрителя: перезарядки и установки — только свои. */
export function visibleMinefields(state: GameState, viewer: string): GameState['minefields'] {
  if (!state.minefields) return undefined;
  const view = deepClone(state.minefields);
  // `struck` — служебная метка подрыва: id подорвавшегося флота, в том числе скрытого
  // туманом. Наружу не идёт никому (замечание Codex на #1414).
  delete view.struck;
  for (const id of Object.keys(view.readyAt))
    if (state.fleets[id]?.owner !== viewer) delete view.readyAt[id];
  for (const owner of Object.keys(view.ownerReadyAt ?? {}))
    if (owner !== viewer) delete view.ownerReadyAt![owner];
  for (const [id, job] of Object.entries(view.installations ?? {}))
    if (job.owner !== viewer) delete view.installations![id];
  return Object.keys(view.readyAt).length ||
    Object.keys(view.ownerReadyAt ?? {}).length ||
    Object.keys(view.installations ?? {}).length
    ? view
    : undefined;
}
