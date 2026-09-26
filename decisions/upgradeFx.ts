import type { GameData, Rarity } from '../packages/shared-core/src/index';
import { profileRarity } from './moduleRarity';
import type { SectorProgressAction, SectorZeroProgress, ShipSlot } from './sectorZeroProgress';

/**
 * Что ОТМЕТИТЬ после улучшения в подготовке Sector Zero (заказ владельца 2026-09-26: «ещё бы
 * анимацию улучшения»). Экран перерисовывается целиком, и без отклика игрок ищет глазами,
 * что изменилось: звезда в ряду из пяти, плитка слота среди шести. Решение отвечает «что
 * поднялось и где» — рисует и анимирует хозяин экрана.
 *
 * ## Исход читается по ПРОФИЛЮ, а не по тому, прошло ли действие
 *
 * Неудачная попытка улучшения тоже меняет профиль (сгорели Варранты, вырос счётчик попыток),
 * и по «действие прошло» её не отличить от удачной. Поэтому сравниваются профили до и после:
 * выросла звезда — успех, вырос только счётчик — промах. Никакой «почти удачи»: ровно два
 * исхода, как у самой кузни (`sectorZeroForge.ts`).
 *
 * Действия, которые ничего не улучшают (надеть, открыть, купить), отклика не получают:
 * вспышка на каждом нажатии обесценила бы вспышку улучшения.
 */
export type UpgradeFx =
  /** Модулю досталась звезда `star`. */
  | { kind: 'star'; id: string; star: number }
  /** Попытка улучшения модуля сгорела: звезда та же, Варранты списаны. */
  | { kind: 'miss'; id: string }
  /** Модуль поднялся до ступени `rarity`. */
  | { kind: 'rarity'; id: string; rarity: Rarity }
  /** Звезда корабля открыла слот `slot` на корпусе `hull`. */
  | { kind: 'slot'; hull: string; slot: ShipSlot }
  /** Герой получил звезду `star`. */
  | { kind: 'hero-star'; id: string; star: number };

export function upgradeFx(
  action: SectorProgressAction,
  before: SectorZeroProgress,
  after: SectorZeroProgress,
  data: GameData,
): UpgradeFx | null {
  switch (action.kind) {
    case 'forge': {
      const star = after.stars[action.id] ?? 0;
      if (star > (before.stars[action.id] ?? 0)) return { kind: 'star', id: action.id, star };
      const tried = (after.forgeTries[action.id] ?? 0) > (before.forgeTries[action.id] ?? 0);
      return tried ? { kind: 'miss', id: action.id } : null;
    }
    case 'raise-rarity': {
      const rarity = profileRarity(after, action.id, data);
      return rarity !== profileRarity(before, action.id, data)
        ? { kind: 'rarity', id: action.id, rarity }
        : null;
    }
    case 'hull-star':
      return (after.hullStars[action.hull]?.length ?? 0) > (before.hullStars[action.hull]?.length ?? 0)
        ? { kind: 'slot', hull: action.hull, slot: action.slot }
        : null;
    case 'upgrade-hero': {
      const star = after.heroes[action.id]?.level ?? 0;
      return star > (before.heroes[action.id]?.level ?? 0) ? { kind: 'hero-star', id: action.id, star } : null;
    }
    default:
      return null;
  }
}
