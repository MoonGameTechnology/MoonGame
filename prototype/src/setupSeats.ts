/**
 * Раскладка мест на экране сетапа: кто каким домом играет (REFM-44).
 *
 * Правила, которые легко потерять при правке экрана:
 *
 * 1. **Мест больше, чем домов.** Дома раздаются ПО КРУГУ, и на втором круге к имени
 *    добавляется номер — иначе два места назывались бы одинаково, и в дипломатии
 *    игрок не понял бы, кому именно объявляет войну.
 * 2. **Твой дом идёт первым, остальные — стабильным порядком.** Раздача не должна
 *    зависеть от того, в каком порядке пришли ключи: одинаковый выбор — одинаковая
 *    расстановка, иначе экран «перетасовывает» соперников на ровном месте.
 * 3. **Ноль соперников — законный режим, а не ошибка.** Ядро не завершает матч
 *    одного игрока (для победы нужны минимум две активные стороны), поэтому пустая
 *    песочница — это мирное место почитать описания и освоить интерфейс. Кнопка
 *    старта в этом случае обязана остаться живой, только назваться иначе.
 *
 * Бонусы дома читаются ИЗ ДАННЫХ: список того, что усиливает фракция, — не
 * интерфейсная константа, иначе он разойдётся с тем, что считает ядро.
 */

/** Роль места: ты, ИИ или выключено. */
export type SeatRole = 'human' | 'ai' | 'off';

/** Раздать дома местам: твой первый, остальные по кругу в стабильном порядке. */
export function seatFactionIds(mine: string, factions: readonly string[], seats: number): string[] {
  const ordered = [mine, ...factions.filter((f) => f !== mine)];
  if (ordered.length === 0) return [];
  return Array.from({ length: seats }, (_, i) => ordered[i % ordered.length]!);
}

/**
 * Имя дома для места: со второго круга к нему добавляется номер круга. `houses` —
 * сколько всего домов; ноль домов не должен делить на ноль.
 */
export function houseNameFor(base: string, index: number, houses: number): string {
  const cycle = Math.floor(index / Math.max(1, houses)) + 1;
  return cycle === 1 ? base : `${base} ${cycle}`;
}

/** Пассивы дома в том виде, в каком их держат данные. */
export interface FactionPassives {
  productionBonus?: number;
  combatDamageBonus?: number;
  fleetSpeedBonus?: number;
  radarRangeBonus?: number;
}

/** Одна строка читаемого бонуса: что усиливает и на сколько процентов. */
export interface FactionBonus {
  kind: 'economy' | 'damage' | 'speed' | 'radar';
  pct: number;
}

/** Бонусы дома в порядке показа. Нулевые не занимают строку — их просто нет. */
export function factionBonuses(p: FactionPassives | undefined): FactionBonus[] {
  if (!p) return [];
  const rows: Array<[FactionBonus['kind'], number | undefined]> = [
    ['economy', p.productionBonus],
    ['damage', p.combatDamageBonus],
    ['speed', p.fleetSpeedBonus],
    ['radar', p.radarRangeBonus],
  ];
  return rows
    .filter(([, v]) => !!v)
    .map(([kind, v]) => ({ kind, pct: Math.round((v ?? 0) * 100) }));
}

/** Сколько мест занято ИИ. Место 1 — всегда ты, оно в счёт соперников не идёт. */
export function rivalCount(slots: readonly SeatRole[]): number {
  return slots.slice(1).filter((r) => r === 'ai').length;
}
