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
 *    Универсальный отсек (усиленный крейсер) держит модуль, которому не хватило отсека
 *    своего типа.
 * 2. **Модуль сверх ёмкости не пропадает.** Стек родился с лоадаутом, который правило
 *    приняло; если данные с тех пор сузили слоты, модуль всё равно на корабле и работает —
 *    карточка покажет его лишним отсеком (`extra`), а не спрячет.
 * 3. **Числа — те же, что в бою.** Звёзды и редкость модуля стек несёт сам
 *    (`moduleStars`/`moduleRarity`), и `effectiveStats` их считает: карточка не показывает
 *    голый модуль, когда в бою он сильнее. Вклад отсека — разница «корпус с одним этим
 *    модулем» минус «голый корпус».
 * 4. **Строка характеристики — только живая.** Атака, защита, корпус и скорость — всегда;
 *    прочие — если они есть у корпуса или оснащение их меняет.
 * 5. **Урон по целям — с оснащением.** Модуль, добавивший осадный урон или ПРО, виден и
 *    в ряду «корабли · здания · авиация · техника · пехота».
 */
import {
  effectiveStats,
  loadoutBays,
  type GameData,
  type ShipBayType,
  type UnitStack,
} from '../packages/shared-core/src/index';
import { unitDamageProfile, type UnitDamageRow } from './unitDamage';

/** Один отсек корпуса и то, что в нём стоит. */
export interface ShipCardBay {
  /** Тип отсека; `universal` — универсальный, в нём модуль любого типа. */
  type: ShipBayType;
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
  /** Урон одного корабля по целям — с оснащением (`decisions/unitDamage.ts`). */
  damage: UnitDamageRow[];
}

/** Характеристики карточки в порядке экрана (правило 4). */
export const SHIP_CARD_STATS = [
  'attack',
  'defense',
  'hp',
  'shield',
  'shieldRegen',
  'hullRepair',
  'speed',
  'radarRange',
  'cargoCapacity',
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
  // Раскладка — та же, что считает гейт верфи (`loadoutBays`): модуль в отсеке своего
  // типа, лишний — в универсальном, сверх всех отсеков — лишним отсеком (правило 2).
  const bays: ShipCardBay[] = loadoutBays(def.slots, stack.modules ?? [], data).map(({ type, module: id, extra }) => ({
    type,
    module: id,
    stars: id ? (stack.moduleStars?.[id] ?? 0) : 0,
    rarity: id ? (stack.moduleRarity?.[id] ?? null) : null,
    effect: id ? effectOf(id) : {},
    ...(extra ? { extra } : {}),
  }));
  const eff = effectiveStats(def, stack, data);
  const stats: ShipCardStat[] = [];
  for (const stat of SHIP_CARD_STATS) {
    const b = base[stat] ?? 0;
    const e = eff[stat] ?? 0;
    if (ALWAYS.has(stat) || b !== 0 || Math.abs(e - b) > EPS) {
      stats.push({ stat, base: b, effective: e, delta: e - b });
    }
  }
  return { unit: stack.unit, count: stack.count, bays, stats, damage: unitDamageProfile(def, eff) };
}
