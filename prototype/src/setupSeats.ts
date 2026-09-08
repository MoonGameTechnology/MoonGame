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

import { tData } from '../../localization/runtime';

/**
 * Роль места: ты, ИИ той или иной силы, или выключено (AIDIFF-1).
 *
 * Сложность — часть РОЛИ, а не отдельное поле рядом: место либо пустое, либо его ведёт
 * КОНКРЕТНЫЙ бот, и две правды («бот есть» + «бот такой») разъезжались бы ровно там, где
 * их читают порознь — в раздаче стартов, в счётчике соперников и в кнопке строки.
 *
 * `ai` — прежний простой соперник (слабый). Имя оставлено как было: это ДЕФОЛТ, и всё,
 * что раньше означало «на месте бот», продолжает означать ровно это.
 */
export type SeatRole = 'human' | 'ai' | 'ai-strong' | 'off';

/** Ведёт ли место бот — любой силы. */
export function isAiSeat(role: SeatRole | undefined): boolean {
  return role === 'ai' || role === 'ai-strong';
}

/** Сложность бота на месте в терминах `aiOrders` (`AiProfile`). Не-ботовское место
 *  сложности не имеет, поэтому спрашивать её у него бессмысленно — `null`. */
export function seatAiProfile(role: SeatRole | undefined): 'weak' | 'strong' | null {
  if (role === 'ai') return 'weak';
  if (role === 'ai-strong') return 'strong';
  return null;
}

/**
 * Следующее состояние кнопки строки бота (заказ владельца 2026-09-07): один тап гоняет
 * место по кругу «выкл → слабый → сильный → выкл». Круг, а не отдельный переключатель
 * сложности: на телефоне строка узкая, и вторая кнопка рядом с первой — это два промаха
 * вместо одного тапа.
 *
 * Место 0 (ты) сюда не попадает: экран не даёт сменить свою роль, и `human` возвращается
 * как есть — циклом её не сломать даже случайным вызовом.
 */
export function nextSeatRole(role: SeatRole): SeatRole {
  if (role === 'human') return 'human';
  if (role === 'off') return 'ai';
  return role === 'ai' ? 'ai-strong' : 'off';
}

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

/**
 * Имя дома в том виде, в каком его читает ИГРОК (AUD-14).
 *
 * Хранится и передаётся имя ДАННЫХ (`data/factions.json`, английское) — состояние одно
 * на всех, а локаль у каждого своя, поэтому перевод делается на месте показа. Две
 * тонкости, ради которых это отдельная функция, а не голый `tData()`:
 *
 * 1. **Номер круга отделяется ДО поиска ключа.** `houseNameFor` даёт «Azure Compact 2»,
 *    а слаг `dataKey()` вырезал бы пробелы в `data.azurecompact2` — ключа нет, и игрок
 *    получил бы английское имя целиком. Переводится база, номер остаётся цифрой рядом.
 * 2. **Позывной живого игрока проходит насквозь.** В сетевом матче в имени места стоит
 *    ник, а не дом; `tData()` по нему промахивается и отдаёт строку как есть — это и есть
 *    нужное поведение, переводить ник нельзя.
 */
export function houseDisplayName(name: string): string {
  const numbered = /^(.+) (\d+)$/.exec(name);
  return numbered ? `${tData(numbered[1]!)} ${numbered[2]!}` : tData(name);
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

/** Сколько мест занято ИИ — любой силы. Место 1 — всегда ты, оно в счёт соперников
 *  не идёт. */
export function rivalCount(slots: readonly SeatRole[]): number {
  return slots.slice(1).filter(isAiSeat).length;
}

/** Одно место, реально идущее в матч, и мир, с которого оно стартует. */
export interface SeatAssignment {
  index: number;
  start: string;
}

/**
 * Кто из мест реально играет и с какого мира стартует (REFM-160).
 *
 * 1. **Место 0 — всегда ты**, своим миром, независимо от того, что записано в
 *    `slots[0]`: экран не даёт эту роль сменить, а раздача не обязана её перепроверять.
 * 2. **AI-места забирают кандидатов ПО ПОРЯДКУ индекса**, минуя выключенные — стабильный
 *    порядок нужен затем же, зачем и в `seatFactionIds`: одинаковый выбор игрока даёт
 *    одинаковую расстановку. Сила бота на раздачу не влияет: она про то, КАК он играет,
 *    а не про то, где садится.
 * 3. **Свой мир из кандидатов исключён заранее** — иначе AI сел бы на уже занятый старт.
 * 4. **Кандидаты кончились — раздача останавливается, а не зацикливается на пропуске.**
 *    Дальние AI-места остаются без места (их не будет в матче): лучше меньше соперников,
 *    чем два на одном старте.
 */
export function assignSeats(
  seatCount: number,
  slots: readonly SeatRole[],
  playerStart: string,
  startCandidates: readonly string[],
): SeatAssignment[] {
  const out: SeatAssignment[] = [{ index: 0, start: playerStart }];
  const free = startCandidates.filter((c) => c !== playerStart);
  let fi = 0;
  for (let i = 1; i < seatCount; i++) {
    if (!isAiSeat(slots[i])) continue;
    const start = free[fi++];
    if (!start) break;
    out.push({ index: i, start });
  }
  return out;
}
