import { RARITIES, type GameData, type Rarity } from '../packages/shared-core/src/index';
import { hashUnit, type ForgeLadder } from './sectorZeroForge';

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

/* ── Откуда дубли и чертежи (SZE-5.3) ─────────────────────────────────────────────── */

/**
 * Добыча итогов забега. Числа — **v0** для плейтеста.
 *
 * 4. **Дубли — за сам забег и за задачи.** 1 дубль за любой засчитанный забег, ещё 1 за
 *    победу и по 1 за каждую задачу главы, закрытую ВПЕРВЫЕ. Какой модуль продублирован —
 *    бросок из открытых игроком: дубль того, чего у игрока нет, поднимать было бы нечем.
 * 5. **Чертёж — редкий.** Шанс 25% за победу и 8% за поражение; ступень чаще уникальная,
 *    реже мифическая, совсем редко легендарная. Первая победа в главе даёт чертёж
 *    ГАРАНТИРОВАННО — ступень растёт к эпицентру.
 * 6. **Бросок детерминирован**: ключ — сид профиля и номер попытки, тот же хеш, что у
 *    заточки. Перезагрузка страницы итог не перекатывает.
 */
export const RUN_COPIES = { run: 1, win: 1, perTask: 1 } as const;
export const BLUEPRINT_CHANCE = { won: 0.25, lost: 0.08 } as const;
export const BLUEPRINT_TIERS: readonly (readonly [Rarity, number])[] = [
  ['unique', 0.7],
  ['mythic', 0.25],
  ['legendary', 0.05],
];

/** Добыча одного забега: дубли по модулям и чертежи по ступеням. */
export interface RunLoot {
  copies: Record<string, number>;
  blueprints: Record<string, number>;
}

/** Гарантированный чертёж за первую победу в главе `index`: к эпицентру — ступень выше. */
export function chapterBlueprint(index: number): Rarity | null {
  if (!Number.isInteger(index) || index < 0) return null;
  return index === 0 ? 'unique' : index === 1 ? 'mythic' : 'legendary';
}

export function runLoot(input: {
  seed: string;
  attempt: number;
  modules: readonly string[];
  won: boolean;
  newTasks: number;
  firstWinBlueprint: Rarity | null;
}): RunLoot {
  const key = `${input.seed}\u0000${input.attempt}\u0000`;
  const copies: Record<string, number> = {};
  const count =
    RUN_COPIES.run +
    (input.won ? RUN_COPIES.win : 0) +
    Math.max(0, input.newTasks) * RUN_COPIES.perTask;
  if (input.modules.length > 0)
    for (let i = 0; i < count; i++) {
      const id =
        input.modules[Math.floor(hashUnit(`${key}copy\u0000${i}`) * input.modules.length)]!;
      copies[id] = (copies[id] ?? 0) + 1;
    }
  const blueprints: Record<string, number> = {};
  const add = (r: Rarity): void => {
    blueprints[r] = (blueprints[r] ?? 0) + 1;
  };
  if (input.firstWinBlueprint) add(input.firstWinBlueprint);
  if (hashUnit(`${key}blueprint`) < (input.won ? BLUEPRINT_CHANCE.won : BLUEPRINT_CHANCE.lost)) {
    let roll = hashUnit(`${key}tier`);
    const tier = BLUEPRINT_TIERS.find(([, w]) => (roll -= w) < 0)?.[0] ?? 'unique';
    add(tier);
  }
  return { copies, blueprints };
}

/** Сложить добычу в счётчики профиля (новые объекты, входы не трогаются). */
export function addLoot<
  T extends { moduleCopies: Record<string, number>; blueprints: Record<string, number> },
>(p: T, loot: RunLoot): Pick<T, 'moduleCopies' | 'blueprints'> {
  const moduleCopies = { ...p.moduleCopies };
  for (const [id, n] of Object.entries(loot.copies)) moduleCopies[id] = (moduleCopies[id] ?? 0) + n;
  const blueprints = { ...p.blueprints };
  for (const [r, n] of Object.entries(loot.blueprints)) blueprints[r] = (blueprints[r] ?? 0) + n;
  return { moduleCopies, blueprints };
}
