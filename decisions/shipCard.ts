/**
 * Карточка корабля — что на нём надето (заказ владельца 2026-09-24: «когда выбираешь
 * карточку корабля, там должно быть видно, какие модули надеты. Как в Stellaris примерно»).
 *
 * Модель одного СТЕКА флота: отсеки корпуса по типам (оружие → защита → системы) с тем,
 * что в них стоит, и характеристики одного корабля — голого корпуса и с оснащением.
 * Чистая функция: нарисовать её может любой клиент.
 *
 * 1. **Отсек — это слот корпуса.** Отсеков столько, сколько даёт корпус (`def.slots`), и
 *    пустые показываются пустыми: игрок видит и что надето, и что можно было надеть.
 * 2. **Модуль сверх ёмкости не пропадает.** Стек родился с лоадаутом, который правило
 *    приняло; если данные с тех пор сузили слоты, модуль всё равно на корабле и работает —
 *    карточка покажет его лишним отсеком (`extra`), а не спрячет.
 * 3. **Числа — те же, что в бою.** Звёзды и редкость модуля стек несёт сам
 *    (`moduleStars`/`moduleRarity`), и `effectiveStats` их считает: карточка не показывает
 *    голый модуль, когда в бою он сильнее. Вклад отсека — разница «корпус с одним этим
 *    модулем» минус «голый корпус».
 * 4. **Строка характеристики — только живая.** Атака, защита, корпус и скорость — всегда;
 *    прочие — если они есть у корпуса или оснащение их меняет.
 */
import {
  effectiveStats,
  type GameData,
  type ShipSlotType,
  type UnitStack,
} from '../packages/shared-core/src/index';

/** Один отсек корпуса и то, что в нём стоит. */
export interface ShipCardBay {
  type: ShipSlotType;
  /** Надетый модуль; `null` — отсек пуст. */
  module: string | null;
  /** Звёзды модуля (0 — без звёзд). */
  stars: number;
  /** Редкость модуля, если стек её несёт. */
  rarity: string | null;
  /** Что модуль добавляет одному кораблю (правило 3). У пустого отсека — пусто. */
  effect: Record<string, number>;
  /** Модуль сверх ёмкости корпуса (правило 2). */
  extra?: true;
}

/** Характеристика одного корабля: голый корпус → с оснащением. */
export interface ShipCardStat {
  stat: string;
  base: number;
  effective: number;
  delta: number;
}

export interface ShipCardModel {
  unit: string;
  count: number;
  bays: ShipCardBay[];
  stats: ShipCardStat[];
}

/** Порядок отсеков — как в конструкторе: оружие, защита, системы. */
export const SHIP_SLOT_ORDER: readonly ShipSlotType[] = ['weapon', 'defense', 'utility'];

/** Характеристики карточки в порядке экрана (правило 4). */
export const SHIP_CARD_STATS = [
  'attack',
  'defense',
  'hp',
  'shield',
  'shieldRegen',
  'speed',
  'radarRange',
  'cargoCapacity',
  'shuttleBay',
  'pointDefense',
  'siegeDamage',
] as const;

const ALWAYS = new Set<string>(['attack', 'defense', 'hp', 'speed']);

/** Меньше этого — погрешность плавающей точки, а не вклад модуля. */
const EPS = 1e-9;

type CardStack = Pick<UnitStack, 'unit' | 'count' | 'modules' | 'moduleStars' | 'moduleRarity'>;

/** Модель карточки стека; `null` — корпуса нет в данных. */
export function shipCardModel(stack: CardStack, data: GameData): ShipCardModel | null {
  const def = data.units[stack.unit];
  if (!def) return null;
  const base = effectiveStats(def, {}, data);
  const byType = new Map<ShipSlotType, string[]>(SHIP_SLOT_ORDER.map((type) => [type, []]));
  for (const id of stack.modules ?? []) {
    const m = data.modules[id];
    if (m) byType.get(m.slot)?.push(id);
  }
  const effectOf = (id: string): Record<string, number> => {
    const star = stack.moduleStars?.[id];
    const rarity = stack.moduleRarity?.[id];
    const alone = effectiveStats(
      def,
      {
        modules: [id],
        ...(star !== undefined ? { moduleStars: { [id]: star } } : {}),
        ...(rarity !== undefined ? { moduleRarity: { [id]: rarity } } : {}),
      },
      data,
    );
    const out: Record<string, number> = {};
    for (const stat of SHIP_CARD_STATS) {
      const diff = (alone[stat] ?? 0) - (base[stat] ?? 0);
      if (Math.abs(diff) > EPS) out[stat] = diff;
    }
    return out;
  };
  const bays: ShipCardBay[] = [];
  for (const type of SHIP_SLOT_ORDER) {
    const cap = def.slots?.[type] ?? 0;
    const fitted = byType.get(type) ?? [];
    for (let i = 0; i < Math.max(cap, fitted.length); i++) {
      const id = fitted[i] ?? null;
      bays.push({
        type,
        module: id,
        stars: id ? (stack.moduleStars?.[id] ?? 0) : 0,
        rarity: id ? (stack.moduleRarity?.[id] ?? null) : null,
        effect: id ? effectOf(id) : {},
        ...(i >= cap ? { extra: true as const } : {}),
      });
    }
  }
  const eff = effectiveStats(def, stack, data);
  const stats: ShipCardStat[] = [];
  for (const stat of SHIP_CARD_STATS) {
    const b = base[stat] ?? 0;
    const e = eff[stat] ?? 0;
    if (ALWAYS.has(stat) || b !== 0 || Math.abs(e - b) > EPS) {
      stats.push({ stat, base: b, effective: e, delta: e - b });
    }
  }
  return { unit: stack.unit, count: stack.count, bays, stats };
}
