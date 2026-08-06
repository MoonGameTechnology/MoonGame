/**
 * Сводка армии: что именно показывает карточка флота по тапу на имя (REFM-37).
 *
 * Здесь только арифметика — разметку и подписи собирает хозяин. Считать это заново
 * в шаблоне нельзя: три числа в сводке НЕ такие, какими их считает глаз игрока, и
 * каждое из них уже вызывало вопрос «почему цифра другая».
 *
 * 1. **Огонь ограничен линией боя.** В залпе участвуют только `COMBAT_UNIT_CAP`
 *    сильнейших кораблей, остальные лишь принимают урон корпусом. Поэтому сводка
 *    показывает ДВА числа — сколько стреляет и сколько стволов всего: игрок должен
 *    видеть, что двадцать первый крейсер прибавил живучести, но не залпа.
 * 2. **Радар — МАКСИМУМ, а не сумма.** Два разведчика не видят вдвое дальше.
 * 3. **Трюм считается объёмом груза, а не головами.** Танк занимает больше места,
 *    чем пехотинец, — суммировать `count` было бы враньём про вместимость.
 *
 * Пулы корпуса и щита ЗАЖИМАЮТСЯ по максимуму: `hp` в стеке — это остаток, и после
 * смены данных или модулей он может оказаться больше нового максимума. Без зажима
 * панель показала бы «110/100».
 */
import {
  cappedUnitStat,
  effectiveStats,
  fleetBaseSpeed,
  sumUnitStat,
  type Fleet,
  type GameData,
  type UnitStack,
} from '../../packages/shared-core/src/index';
import { unitArchetype, type ShipArchetype } from './unitGlyphs';

/** Пул корпуса или щита одного стека: остаток и максимум. */
export interface Pool {
  cur: number;
  max: number;
}

/** Всё, что показывает сводка армии. Числа — уже готовые, подписи не наши. */
export interface FleetSummary {
  /** Состав по архетипам в порядке появления в составе флота. */
  composition: Array<{ archetype: ShipArchetype; count: number }>;
  /** Десант в трюме, голов. */
  troops: number;
  /** Залп: `capped` стреляет, `total` — сколько было бы без линии боя. */
  attack: { capped: number; total: number };
  defense: number;
  hull: Pool;
  shield: Pool;
  /** Базовая скорость флота (по самому медленному корпусу), без множителей. */
  speed: number;
  /** Спешный отход ещё действует на момент `now`. */
  retreatHaste: boolean;
  /** Трюм: занято по ОБЪЁМУ груза и вместимость. `null` — возить нечем. */
  cargo: { used: number; cap: number } | null;
  /** Дальность радара — максимум по кораблям, 0 если слепы. */
  radar: number;
  /** Содержание в сутки по ресурсам; пустой объект — бесплатный флот. */
  upkeep: Record<string, number>;
}

/** Живые стеки: пустой стек остаётся в массиве после боя и в счёт не идёт. */
const alive = (stacks: readonly UnitStack[]): UnitStack[] => stacks.filter((st) => st.count > 0);

/**
 * Корпус и щит одного стека с зажимом остатка по максимуму. Отдаётся отдельно,
 * потому что тем же числом живёт полоска здоровья на тайле состава.
 */
export function stackPools(st: UnitStack, data: GameData): { hull: Pool; shield: Pool } {
  const def = data.units[st.unit];
  if (!def || st.count <= 0) return { hull: { cur: 0, max: 0 }, shield: { cur: 0, max: 0 } };
  const eff = effectiveStats(def, st, data);
  const maxHull = st.count * (eff.hp ?? 0);
  const maxShield = st.count * (eff.shield ?? 0);
  return {
    hull: { cur: Math.min(st.hp ?? maxHull, maxHull), max: maxHull },
    shield: { cur: Math.min(st.shieldHp ?? maxShield, maxShield), max: maxShield },
  };
}

/** Доля целого корпуса стека, 0..100 — для полоски на тайле. Пустой стек = 100. */
export function stackHullPct(st: UnitStack, data: GameData): number {
  const { hull } = stackPools(st, data);
  return hull.max > 0 ? Math.round((hull.cur / hull.max) * 100) : 100;
}

/** Вся арифметика карточки за один проход. Чистая: ни DOM, ни состояния, ни текста. */
export function fleetSummary(f: Fleet, data: GameData, now: number): FleetSummary {
  const ships = alive(f.units);
  const landing = alive(f.landing ?? []);

  const byArch = new Map<ShipArchetype, number>();
  for (const st of ships) {
    const def = data.units[st.unit];
    if (!def) continue;
    const a = unitArchetype(def);
    byArch.set(a, (byArch.get(a) ?? 0) + st.count);
  }

  const hull: Pool = { cur: 0, max: 0 };
  const shield: Pool = { cur: 0, max: 0 };
  // Корпус и щит считаются ВМЕСТЕ с десантом: бомбардировка бьёт по трюму тоже.
  for (const st of [...ships, ...landing]) {
    const p = stackPools(st, data);
    hull.cur += p.hull.cur;
    hull.max += p.hull.max;
    shield.cur += p.shield.cur;
    shield.max += p.shield.max;
  }

  const cargoCap = sumUnitStat(ships, data, 'cargoCapacity');
  const cargoUsed = landing.reduce((n, st) => {
    const def = data.units[st.unit];
    return n + (def ? st.count * (effectiveStats(def, st, data).cargoSize ?? 1) : 0);
  }, 0);

  const upkeep: Record<string, number> = {};
  for (const st of ships) {
    const def = data.units[st.unit];
    if (!def) continue;
    for (const [res, n] of Object.entries(def.upkeep ?? {}))
      upkeep[res] = (upkeep[res] ?? 0) + st.count * (n ?? 0);
  }

  const hasteUntil = (f as { retreatHasteUntil?: number }).retreatHasteUntil;

  return {
    composition: [...byArch.entries()].map(([archetype, count]) => ({ archetype, count })),
    troops: landing.reduce((n, st) => n + st.count, 0),
    attack: {
      capped: Math.round(cappedUnitStat(ships, data, 'attack')),
      total: Math.round(sumUnitStat(ships, data, 'attack')),
    },
    defense: Math.round(cappedUnitStat(ships, data, 'defense')),
    hull: { cur: Math.round(hull.cur), max: Math.round(hull.max) },
    shield: { cur: Math.round(shield.cur), max: Math.round(shield.max) },
    speed: fleetBaseSpeed(f, data),
    retreatHaste: hasteUntil != null && now < hasteUntil,
    cargo: cargoCap > 0 ? { used: cargoUsed, cap: Math.round(cargoCap) } : null,
    radar: Math.max(0, ...ships.map((st) => data.units[st.unit]?.radarRange ?? 0)),
    upkeep,
  };
}
