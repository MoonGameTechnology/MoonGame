import { RARITIES, type GameData, type Rarity } from '../packages/shared-core/src/index';
import type { ForgeLadder } from './sectorZeroForge';

/**
 * Редкость модуля в профиле Sector Zero (SZE-5.2, решение владельца 2026-09-24).
 *
 * 1. **Редкость поднимается за чертёж и 3 дубля.** Чертёж — той ступени, НА КОТОРУЮ
 *    поднимаешь (мифический чертёж делает уникальный модуль мифическим); дубли — копии
 *    этого же модуля. Легендарный — вершина, выше не поднимается.
 * 2. **Редкость решает потолок звёзд.** Звёзды остались своей осью (Мастерская,
 *    Варранты, шанс и гарантия), но у простого модуля их до 3, у легендарного до 6 —
 *    `capByRarity` в данных. Звёзды, заточенные ДО появления потолков, не отнимаются:
 *    дальше они просто не растут.
 * 3. **Базовая ступень — из каталога.** Профиль хранит только ПОДНЯТУЮ ступень; нет
 *    записи — модуль той редкости, с какой он объявлен в данных.
 */

/** Сколько дублей съедает одно повышение. */
export const RARITY_COPIES = 3;

/** Ступень выше `r`, либо null — это вершина. */
export function nextRarity(r: Rarity): Rarity | null {
  return RARITIES[RARITIES.indexOf(r) + 1] ?? null;
}

interface RarityProfile {
  modules: readonly string[];
  moduleRarity: Readonly<Record<string, string>>;
  moduleCopies: Readonly<Record<string, number>>;
  blueprints: Readonly<Record<string, number>>;
}

/** Текущая редкость модуля: поднятая в профиле, иначе базовая из каталога (правило 3). */
export function profileRarity(
  p: Pick<RarityProfile, 'moduleRarity'>,
  id: string,
  data: GameData,
): Rarity {
  const base: Rarity = data.modules[id]?.rarity ?? 'simple';
  const raised = p.moduleRarity[id] as Rarity | undefined;
  return raised !== undefined && RARITIES.indexOf(raised) > RARITIES.indexOf(base) ? raised : base;
}

export type RaiseRefusal = 'E_RARITY_LOCKED' | 'E_RARITY_TOP' | 'E_NO_BLUEPRINT' | 'E_NO_COPIES';

/** Что нужно для следующей ступени и чего не хватает — одно вычисление на экран и на действие. */
export interface RaiseCheck {
  from: Rarity;
  to: Rarity | null;
  blueprints: number;
  copies: number;
  can: boolean;
  reason: RaiseRefusal | null;
}

export function raiseCheck(p: RarityProfile, id: string, data: GameData): RaiseCheck {
  const from = profileRarity(p, id, data);
  const to = nextRarity(from);
  const blueprints = to ? (p.blueprints[to] ?? 0) : 0;
  const copies = p.moduleCopies[id] ?? 0;
  const reason: RaiseRefusal | null =
    !data.modules[id] || !p.modules.includes(id)
      ? 'E_RARITY_LOCKED'
      : !to
        ? 'E_RARITY_TOP'
        : blueprints < 1
          ? 'E_NO_BLUEPRINT'
          : copies < RARITY_COPIES
            ? 'E_NO_COPIES'
            : null;
  return { from, to, blueprints, copies, can: reason === null, reason };
}

/** Общая лестница заточки вместе с потолками по редкости (`data.sectorZeroStars`). */
export type RarityLadder = ForgeLadder & { capByRarity?: Partial<Record<Rarity, number>> };

/** Лестница заточки КОНКРЕТНОГО модуля: общая, но с потолком его редкости (правило 2). */
export function moduleLadder(ladder: RarityLadder, rarity: Rarity): ForgeLadder {
  const own = ladder.capByRarity?.[rarity];
  return own === undefined ? ladder : { ...ladder, cap: Math.min(ladder.cap, own) };
}
