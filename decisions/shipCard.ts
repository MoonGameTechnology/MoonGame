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
 *    карточка покажет его лишним отсеком (`extra`), а не спрячет. Слоты сверх каталога,
 *    которые корпусу дали честно, — купленные звёздами корабля Сектора Зеро и отсеки корабля
 *    героя за его ступень, — приходят прибавкой `bonus`: это отсеки (`bonus: true`), а не
 *    лишние модули. Раньше карточка их не знала и называла такой модуль лишним.
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
  heroModuleSlots,
  loadoutBays,
  withBonusSlots,
  type GameData,
  type GameState,
  type ShipBayType,
  type SlotCounts,
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
  /** Отсек сверх каталога, который корпусу дали (правило 2): последний в своём типе. */
  bonus?: true;
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
  'fleetHullRepair',
  'speed',
  'radarRange',
  'cargoCapacity',
  'pointDefense',
  'siegeDamage',
  'retreatPull',
  'salvageBonus',
  'mineCharge',
  'mineHit',
] as const;

const ALWAYS = new Set<string>(['attack', 'defense', 'hp', 'speed']);

/** Меньше этого — погрешность плавающей точки, а не вклад модуля. */
const EPS = 1e-9;

type CardStack = Pick<UnitStack, 'unit' | 'count' | 'modules' | 'moduleStars' | 'moduleRarity'>;

/**
 * Слоты стека сверх каталога, которые ядро ему засчитало (правило 2): у корабля героя —
 * отсеки ступени и звёзд героя (`heroModuleSlots`), у остальных — купленные звёздами корабля
 * Сектора Зеро (`Player.arsenal.slots`). Нет прибавки — `undefined`.
 */
export function stackBonusSlots(
  state: GameState,
  fleetId: string,
  stack: Pick<UnitStack, 'unit'>,
  data: GameData,
): Partial<SlotCounts> | undefined {
  const fleet = state.fleets[fleetId];
  if (!fleet) return undefined;
  const hero = Object.values(state.heroes ?? {}).find((h) => h.fleetId === fleetId);
  // Корпус корабля героя — как у ядра (`heroShipUnit`): из каталога героя, иначе `hero`.
  const heroUnit = hero && ((hero.archetype !== undefined ? data.heroes[hero.archetype]?.ship.unit : undefined) ?? 'hero');
  if (hero && heroUnit === stack.unit) {
    const all = heroModuleSlots(hero, stack.unit, data);
    const hull = data.units[stack.unit]?.slots;
    const extra = {
      weapon: all.weapon - (hull?.weapon ?? 0),
      defense: all.defense - (hull?.defense ?? 0),
      utility: all.utility - (hull?.utility ?? 0),
    };
    return extra.weapon + extra.defense + extra.utility > 0 ? extra : undefined;
  }
  return state.players[fleet.owner]?.arsenal?.slots?.[stack.unit];
}

/** Модель карточки стека; `null` — корпуса нет в данных. `bonus` — слоты этого корпуса
 *  сверх каталога у его владельца (правило 2). */
export function shipCardModel(
  stack: CardStack,
  data: GameData,
  bonus?: Partial<SlotCounts>,
): ShipCardModel | null {
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
  // Прибавка стоит последней в своём типе, как её раскладывает ядро.
  const seen: Partial<Record<ShipBayType, number>> = {};
  const slots = withBonusSlots(def, bonus).slots;
  const bays: ShipCardBay[] = loadoutBays(slots, stack.modules ?? [], data).map(({ type, module: id, extra }) => {
    const nth = (seen[type] = (seen[type] ?? -1) + 1);
    const given = !extra && type !== 'universal' && nth >= (def.slots[type] ?? 0);
    return {
      type,
      module: id,
      stars: id ? (stack.moduleStars?.[id] ?? 0) : 0,
      rarity: id ? (stack.moduleRarity?.[id] ?? null) : null,
      effect: id ? effectOf(id) : {},
      ...(extra ? { extra } : {}),
      ...(given ? { bonus: true as const } : {}),
    };
  });
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
