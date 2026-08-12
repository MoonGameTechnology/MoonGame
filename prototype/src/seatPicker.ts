/**
 * Выбор дома при входе в матч (REFM-49).
 *
 * Сервер отдаёт список КРЕСЕЛ (`playerId` + дом + занято ли), а игрок выбирает ДОМ.
 * Между этими двумя вещами и живут все правила ниже.
 *
 * 1. **Дом выбирают, кресло достаётся.** Строка обязана нести конкретное свободное
 *    кресло: именно оно уезжает в `?slot=`. Отправишь один лишь дом — сервер посадит
 *    «куда-нибудь», и выбор игрока превратится в пожелание.
 * 2. **Кресло берётся ПЕРВОЕ СВОБОДНОЕ, а не первое.** В доме обычно несколько мест,
 *    и часть уже занята: `seats[0]` сплошь и рядом чужое. Взять его — гарантированный
 *    отказ на месте, которое игрок видел серым.
 * 3. **Полный дом — не выбор.** Признак нужен отдельный: «мест 0/2» и «мест 1/2»
 *    рисуются одной и той же строкой, и без явного `full` в неё легко ткнуть.
 * 4. **Порядок домов стабилен** — по первому появлению в списке мест, а не по обходу
 *    ключей: иначе дома перетасовываются между открытиями окна на ровном месте.
 * 5. **Дом отвязан от стартовой точки (BF-30).** В запрос уходят ОБА поля — `slot`
 *    (где начинаешь) и `faction` (кем играешь); сводить их в одно нельзя.
 */

import { houseDisplayName } from './setupSeats';

/** Кресло в матче в том виде, в каком его отдаёт сервер. */
export interface MatchSeat {
  playerId: string;
  faction: string;
  taken: boolean;
}

/** Строка выбора: дом, сколько в нём мест и какое кресло достанется. */
export interface HouseRow {
  faction: string;
  /** Свободных кресел. */
  free: number;
  /** Всего кресел дома. */
  total: number;
  /** Ни одного свободного — строка не выбирается (правило 3). */
  full: boolean;
  /** Первое СВОБОДНОЕ кресло (правило 2) — оно и уедет в `?slot=`. */
  slot: string | null;
}

/** Свести кресла в строки домов. Порядок — по первому появлению (правило 4). */
export function houseRows(seats: readonly MatchSeat[]): HouseRow[] {
  const rows: HouseRow[] = [];
  const byFaction = new Map<string, HouseRow>();
  for (const seat of seats) {
    let row = byFaction.get(seat.faction);
    if (!row) {
      row = { faction: seat.faction, free: 0, total: 0, full: true, slot: null };
      byFaction.set(seat.faction, row);
      rows.push(row);
    }
    row.total += 1;
    if (!seat.taken) {
      row.free += 1;
      row.full = false;
      row.slot ??= seat.playerId; // именно первое свободное, а не первое вообще
    }
  }
  return rows;
}

/** Что уходит в запрос при выборе строки — или `null`, если выбирать нечего. */
export function houseChoice(row: HouseRow): { slot: string; faction: string } | null {
  // Оба поля вместе — правило 5. `full` и отсутствие кресла проверяются оба:
  // расходиться они не должны, но решает здесь именно наличие кресла.
  return row.full || !row.slot ? null : { slot: row.slot, faction: row.faction };
}

/** Ключ подписи с пассивом дома. Незнакомый дом — без подписи, а не с ключом на экране. */
export function houseBonusKey(faction: string): string | null {
  return HOUSE_BONUS_KEY[faction] ?? null;
}

/** Цвет метки дома; незнакомый дом получает цвет интерфейса по умолчанию. */
export function houseColor(faction: string): string {
  return HOUSE_COLOR[faction] ?? 'var(--cyan)';
}

/** Имя дома для показа; незнакомый дом называется собственным идентификатором. Имена в
 *  `HOUSE_NAME` — английские имена ДАННЫХ, перевод берётся из локали (AUD-14). */
export function houseName(faction: string): string {
  return houseDisplayName(HOUSE_NAME[faction] ?? faction);
}

const HOUSE_BONUS_KEY: Record<string, string> = {
  azure: 'seatpick.bonus.azure',
  crimson: 'seatpick.bonus.crimson',
  amber: 'seatpick.bonus.amber',
  violet: 'seatpick.bonus.violet',
};

const HOUSE_COLOR: Record<string, string> = {
  azure: '#35d6e6',
  crimson: '#ff5a4d',
  amber: '#ffb43a',
  violet: '#b366ff',
};

// Имена ДАННЫХ, а не текст интерфейса: те же строки, что в `data/factions.json`.
const HOUSE_NAME: Record<string, string> = {
  azure: 'Azure Compact',
  crimson: 'Crimson Hegemony',
  amber: 'Amber Concord',
  violet: 'Violet Ascendancy',
};
