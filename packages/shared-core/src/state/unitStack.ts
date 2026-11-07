import type { UnitId, ModuleId } from './gameState';

export interface UnitStack {
  /** Server-owned identity of a hero using an ordinary hull; never merges into regular ships. */
  heroId?: string;
  unit: UnitId;
  count: number;
  /** Stable server-owned ground formation identity for explicit troop transfers. */
  armyGroup?: string;
  /** Effective built hull levels of a fortress body. Fractional while assembling;
   *  absent on ordinary units. Damage remains a separate, persistent HP pool. */
  stationScale?: number;
  /** Remaining HP pool of this stack during a battle (≤ count × def.hp).
   *  Undefined outside combat = full health. */
  hp?: number;
  /** Remaining ablative shield pool of this stack (≤ count × def.shield). Absorbs
   *  damage before `hp`; a ship still dies only when its HULL (`hp`) hits 0.
   *  Undefined = full shield (shields-roadmap SH-0.1). */
  shieldHp?: number;
  /** Installed ship modules (the loadout). For a BUILT stack it is chosen at build
   *  time and locked after — there is no refit of a built ship. The one stack minted
   *  another way is the hero's: `deployHero` stamps it from {@link Hero.modules}, which
   *  the player refits between deployments (HPR-1.5.2). Ids → `data.modules`; ×count.
   *  Part of the stack's merge identity: stacks with different loadouts never
   *  merge (ship-modules-roadmap.md SM-0.3). Absent = no modules. */
  modules?: ModuleId[];
  /** Звёздность УСТАНОВЛЕННЫХ модулей этого стека (SZE-1.1), `id → ★`. Снимок меты
   *  Sector Zero, снятый в момент, когда стек родился: `prepareSectorZeroRun` на старте
   *  забега, верфь — из {@link PlayerArsenal.stars} при постройке. Ядро во время матча
   *  мету НЕ перечитывает, поэтому заточка на ходу уже летающий корабль не меняет —
   *  та же доктрина «нет рефита», что и у самого {@link UnitStack.modules}.
   *
   *  Входит в идентичность слияния вместе с редкостью (`moduleValueKey`): живой
   *  арсенал даёт новым заказам другие значения, а старые стеки сохраняют свои.
   *
   *  Отсутствует / пусто = ★0 у всех, то есть прежние числа байт-в-байт. Записываются
   *  только НЕнулевые звёзды НАДЕТЫХ модулей. */
  moduleStars?: Record<ModuleId, number>;
  /** Поднятая РЕДКОСТЬ установленных модулей (SZE-5.1), `id → ступень` из `RARITIES`.
   *  Тот же род поля, что {@link UnitStack.moduleStars}: снимок меты, снятый при рождении
   *  стека, за матч не меняется и потому в идентичность слияния не входит. Пишутся только
   *  модули, поднятые ВЫШЕ своей базовой ступени; отсутствует = базовая редкость у всех,
   *  прежние числа байт-в-байт. Неизвестная ступень читается как базовая. */
  moduleRarity?: Record<ModuleId, string>;
  /** Заслуга ветерана: сколько урона нанёс ОДИН юнит этого стека за матч, и сколько
   *  сражений он пережил (VET-2). Из этих двух чисел VET-3 считает грейд медали; сам
   *  грейд в состоянии НЕ лежит — значит пороги можно перебалансировать на живом матче,
   *  ничего не мигрируя. Отсутствуют = стек не воевал (это не то же самое, что ноль:
   *  «медали нет» и «медаль низшей степени» — разные вещи и для карточки, и для выплаты).
   *
   *  ⚠️ **Оба числа — НА ЮНИТ, а не итог на стек**, и это не стилистический выбор.
   *  Итог ломается на убыли: 5 корпусов с итогом 300 — это 60 на корпус; погиб один —
   *  итог всё ещё 300, а корпусов четыре, то есть 75 на корпус. Гибель товарища
   *  повышала бы награду выжившим. Поэтому арифметика носителя такая:
   *    · СПЛИТ копирует (величина на юнит от размера отделённой части не зависит);
   *    · СЛИЯНИЕ усредняет по весу — долив свежих кораблей разбавляет честь
   *      подразделения по новым, и это содержательное правило, а не побочный ущерб;
   *    · УБЫЛЬ не трогает — выжившие сохраняют запись подразделения. */
  damageDealt?: number;
  /** Пережитых сражений на юнит — см. {@link UnitStack.damageDealt} про арифметику. */
  battles?: number;
  /** ДОЛЯ отмеченных юнитов в стеке, 0..1 (PERK-3.2, «промоушен»). Бросок делается один
   *  раз на выполненный заказ постройки; отмеченный корабль бьёт с ПОСЛЕДОВАТЕЛЬНЫМ
   *  множителем, то есть его прибавка не тонет в общей сумме массовых процентов.
   *
   *  Хранится долей, а не флагом, ровно чтобы работать по арифметике заслуги
   *  {@link UnitStack.damageDealt}: сплит копирует, слияние усредняет по весу, убыль не
   *  трогает. Флаг на слиянии пришлось бы округлять, и «отмеченность» либо размножалась
   *  бы даром, либо пропадала. */
  promoted?: number;
}
