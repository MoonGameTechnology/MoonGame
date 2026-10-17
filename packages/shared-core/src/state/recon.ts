import type { GameData } from '../data/schemas';
import { defHasTrait } from '../data/traits';
import type { Fleet } from './gameState';

/** Трейт разведчика: по нему ядро узнаёт корабль, который провинцию не берёт. */
export const RECON_TRAIT = 'recon';

/**
 * Разведка ли отряд: в нём живы только разведчики (решение владельца 2026-10-16,
 * «разведчик не захватывает»). Такой флот не берёт пустую провинцию ни прилётом, ни с
 * орбиты; пустой мир он занимает только десантом из трюма, высадкой, как защищённый.
 * Своего трюма у разведчиков нет (решение владельца 2026-10-17: ни вместимости в данных,
 * ни грузового отсека, ни ремонтного ангара — `allowed.excludeTraits`), так что десант
 * бывает лишь у флота, собранного до этого правила. Один боевой корабль в отряде делает
 * его обычным флотом. Правило по трейту, а не по id:
 * новый разведчик в данных получит его сам.
 */
export function isReconFleet(fleet: Pick<Fleet, 'units'>, data: GameData): boolean {
  const live = fleet.units.filter((s) => s.count > 0);
  return live.length > 0 && live.every((s) => defHasTrait(data.units[s.unit], RECON_TRAIT));
}
