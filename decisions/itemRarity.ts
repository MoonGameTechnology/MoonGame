import type { ModuleDef, Rarity } from '../packages/shared-core/src/index';

/**
 * Что показывает карточка предмета о его ступени и прокачке (PVR-6.4).
 *
 * Редкость — поле самого модуля (решение владельца 2026-09-23), лестница цветов общая с
 * героями (hero-progression §0.2). Нет поля — «простой»: так старые данные и модули Роя,
 * которых игрок не видит, не требуют разметки.
 */
export function moduleRarity(def: Pick<ModuleDef, 'rarity'> | undefined): Rarity {
  return def?.rarity ?? 'simple';
}

/** Звёзды карточки: сколько зажечь и сколько оставить пустыми. Мусор на входе не ломает ряд. */
export function starRow(star: number, cap: number): { lit: number; empty: number } {
  const top = Math.max(0, Math.floor(Number.isFinite(cap) ? cap : 0));
  const lit = Math.min(top, Math.max(0, Math.floor(Number.isFinite(star) ? star : 0)));
  return { lit, empty: top - lit };
}
