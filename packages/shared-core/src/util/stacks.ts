import type { UnitStack } from '../state/gameState';
import type { GameData, UnitDef } from '../data/schemas';
import { effectiveStat, effectiveStats } from './loadout';

/** Canonical, order-independent signature of a loadout (one instance per module
 *  id, so it's a set): sorted ids joined. Empty/absent loadout → `''`. Two stacks
 *  merge only when this matches — a fitted stack never silently absorbs a bare one. */
export function loadoutKey(modules?: readonly string[]): string {
  if (!modules || modules.length === 0) return '';
  return [...modules].sort().join(',');
}

/** Values are part of stack identity: live arsenal upgrades must never refit old ships by merging. */
export function moduleValueKey(stack: Pick<UnitStack, 'modules' | 'moduleStars' | 'moduleRarity'>): string {
  return JSON.stringify([...(stack.modules ?? [])].sort().map((id) => [id, stack.moduleStars?.[id] ?? 0, stack.moduleRarity?.[id] ?? '']));
}

/** A healthy (non-combat) stack of `unit` with the SAME loadout in `stacks`, if
 *  any — full hull AND full shield (both pools undefined), so a battle-damaged or
 *  differently-fitted stack never silently merges. */
export function findHealthyStack(
  stacks: UnitStack[],
  unit: string,
  modules?: readonly string[],
  /** Искать стек ТОЙ ЖЕ выслуги (см. {@link serviceKey}) — для слияния: ветераны и новички
   *  одного корпуса не сливаются. Не передано — любая выслуга (поиск источника). */
  battles?: number,
  values?: Pick<UnitStack, 'moduleStars' | 'moduleRarity'>,
): UnitStack | undefined {
  const key = loadoutKey(modules);
  const service = battles === undefined ? null : serviceKey(battles);
  return stacks.find(
    (s) =>
      !s.heroId && s.unit === unit &&
      s.hp === undefined &&
      s.shieldHp === undefined &&
      loadoutKey(s.modules) === key &&
      (values === undefined || moduleValueKey(s) === moduleValueKey({ modules: modules ? [...modules] : undefined, ...values })) &&
      (service === null || serviceKey(s.battles) === service),
  );
}

/** Сколько единиц `unit` во ВСЕХ стеках списка — раненых, оснащённых, любой выслуги.
 *  Столько и можно перевезти: погрузка и высадка берут стеки как есть. */
export function unitCount(stacks: readonly UnitStack[], unit: string): number {
  let n = 0;
  for (const s of stacks) if (s.unit === unit) n += s.count;
  return n;
}

/** Высшая степень «Выслуги», до которой выслуга делит стеки. Пороги линии в данных —
 *  1/2/3/4 пережитых боя (`data/medalGrades.json`), то есть степень и есть число полных
 *  боёв; тест `stacks.test.ts` сверяет это с данными, чтобы пороги не разъехались молча. */
export const SERVICE_MERGE_CAP = 4;

/**
 * Ключ выслуги для СЛИЯНИЯ стеков (решение владельца 2026-09-25): ветеран — отдельная
 * плитка в составе, а не растворённая в новичках доля. До этого слияние усредняло выслугу
 * по весу (VET-2), и два ветерана, влитые в двух новичков, становились «четырьмя по
 * полбоя» — кто был ветераном, узнать было уже нельзя. Теперь сливаются только стеки
 * одной степени: не больше `SERVICE_MERGE_CAP + 1` плиток на корпус.
 */
export function serviceKey(battles: number | undefined): number {
  return Math.min(SERVICE_MERGE_CAP, Math.floor(battles ?? 0));
}

/** Звёздность надетых модулей в виде поля стека (SZE-1.1): только НЕнулевые звёзды
 *  и только НАДЕТЫХ модулей. Пусто → поле не заводится вовсе, и состояние остаётся
 *  байт-в-байт прежним — иначе каждый обычный матч потолстел бы на пустую карту. */
export function starsOf(
  modules: readonly string[] | undefined,
  stars: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!modules || !stars) return undefined;
  const out: Record<string, number> = {};
  for (const id of modules) {
    const star = stars[id];
    if (star !== undefined && star > 0) out[id] = star;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Поднятая редкость надетых модулей в виде поля стека (SZE-5.1) — зеркало
 *  {@link starsOf}: только НАДЕТЫХ и только записанных. Пусто → поле не заводится. */
export function rarityOf(
  modules: readonly string[] | undefined,
  rarity: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!modules || !rarity) return undefined;
  const out: Record<string, string> = {};
  for (const id of modules) {
    const r = rarity[id];
    if (r !== undefined) out[id] = r;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Adds `count` units to a stack array, merging into an existing healthy stack of
 *  the same type AND loadout when one exists, else appending a fresh stack (which
 *  carries `modules` — and the звёздность `stars` of those modules — when given).
 *
 *  Stars and rarity are pinned per order and participate in merge identity. */
export function addUnits(
  stacks: UnitStack[],
  unit: string,
  count: number,
  modules?: readonly string[],
  stars?: Record<string, number>,
  rarity?: Record<string, string>,
  /** Заслуга НА ЮНИТ, которую приносят с собой доливаемые юниты (PERK-3.2). Нужна там,
   *  где `addUnits` выражает ПЕРЕЕЗД уже существующих юнитов, а не рождение новых:
   *  авто-сбор построенного уносит корабли из гарнизона во флот, и по правилу VET-2
   *  («сплит КОПИРУЕТ») их заслуга обязана ехать с ними. Без этого отмеченный корабль
   *  терял отметку в ту же секунду, как его поднимали с верфи. Не передано — юниты
   *  считаются новорождёнными, как и было. */
  merit?: Pick<UnitStack, 'damageDealt' | 'battles' | 'promoted'>,
): void {
  // ТОЛЬКО три величины заслуги, по одной поимённо. Спред `...merit` здесь стоял и был
  // багом: зовущий передаёт исходный СТЕК целиком, и спред утаскивал заодно `count`,
  // затирая размер доливаемой партии (TypeScript это пропускает — лишние поля,
  // пришедшие переменной, структурная типизация разрешает).
  const carried: Partial<UnitStack> = {};
  if (merit?.damageDealt !== undefined) carried.damageDealt = merit.damageDealt;
  if (merit?.battles !== undefined) carried.battles = merit.battles;
  if (merit?.promoted !== undefined) carried.promoted = merit.promoted;
  const stack = findHealthyStack(stacks, unit, modules, carried.battles ?? 0, { moduleStars: stars, moduleRarity: rarity });
  if (stack) {
    // Сливается только стек той же выслуги (`serviceKey`): свежая постройка к ветеранам
    // не доливается, а встаёт отдельно. Усреднение ниже осталось для урона и отметки
    // (PERK-3.2) внутри одной степени — медаль «Доблести» на всю сотню даром по-прежнему
    // не выйдет: долитые новички разбавляют её, как раньше.
    mergeMerit(stack, { unit, count, ...carried });
    stack.count += count;
  } else {
    const fresh: UnitStack = { unit, count, ...carried };
    if (modules && modules.length > 0) fresh.modules = [...modules];
    const own = starsOf(fresh.modules, stars);
    if (own) fresh.moduleStars = own;
    const raised = rarityOf(fresh.modules, rarity);
    if (raised) fresh.moduleRarity = raised;
    stacks.push(fresh);
  }
}

/** Sums `count * stat` across unit stacks, reading each stack's EFFECTIVE stat
 *  (base + its installed modules) so fitted ships count for what they carry.
 *  Stacks whose unit is missing from `data` are silently skipped. A stack with no
 *  modules yields exactly its base stat, so unfitted fleets are unchanged. */
export function sumUnitStat(stacks: readonly UnitStack[], data: GameData, stat: string): number {
  let total = 0;
  for (const s of stacks) {
    const def = data.units[s.unit];
    if (def) {
      total += s.count * (effectiveStat(def, s, data, stat) ?? 0);
    }
  }
  return total;
}

/** Move up to `count` of `unit` out of `src` (mutates src) and return the removed
 *  stacks. `hp`/`shieldHp` are POOLS for the whole stack, so a split must APPORTION
 *  them pro-rata — copying the whole pool onto both halves would duplicate hull
 *  that combat then mints into extra ships. The loadout rides onto the taken stack
 *  so a routine split never strips paid modules. Used by fleet-formation actions
 *  (`fleet.split`) to peel ships off a fleet or a planet's garrison.
 *
 *  `modules` narrows the take to ONE loadout (FSPLIT-1): a loadout is part of a
 *  stack's identity (SM-0.3), so "two cruisers" is ambiguous the moment the same
 *  hull flies both fitted and bare — this is how a caller says WHICH two. Omitted =
 *  any loadout, first stack first (the historical behaviour every existing caller
 *  relies on); `[]` is not "any", it addresses the BARE stacks. */
export function takeFromStacks(
  src: UnitStack[],
  unit: string,
  count: number,
  modules?: readonly string[],
): UnitStack[] {
  const wantKey = modules === undefined ? null : loadoutKey(modules);
  let remaining = count;
  const taken: UnitStack[] = [];
  for (const st of src) {
    // An earlier take in the same order can leave a stack at count 0 (`fleet.split` runs
    // one take per requested line before it filters): it has nothing to give, and its
    // pool share would be 0 / 0 = NaN on a ghost stack of zero ships.
    if (st.unit !== unit || remaining <= 0 || st.count <= 0) continue;
    if (wantKey !== null && loadoutKey(st.modules) !== wantKey) continue;
    const move = Math.min(st.count, remaining);
    remaining -= move;
    const frac = move / st.count; // share of the pools that leaves with the taken ships
    const t: UnitStack = { unit, count: move, ...(st.heroId ? { heroId: st.heroId } : {}) };
    if (st.hp !== undefined) {
      t.hp = st.hp * frac;
      st.hp -= t.hp; // source keeps the remainder — total pool conserved
    }
    if (st.shieldHp !== undefined) {
      t.shieldHp = st.shieldHp * frac;
      st.shieldHp -= t.shieldHp;
    }
    if (st.modules && st.modules.length > 0) t.modules = [...st.modules];
    // Звёздность (SZE-1.1) — свойство надетых модулей, а не пул: отделённая часть
    // несёт те же звёзды. Поля тут перечисляются поимённо, поэтому забытое теряется
    // МОЛЧА — ровно так растворилась бы половина заточки при любом делении флота.
    if (st.moduleStars) t.moduleStars = { ...st.moduleStars };
    if (st.moduleRarity) t.moduleRarity = { ...st.moduleRarity }; // SZE-5.1 — то же правило
    // Заслуга ветерана (VET-2) КОПИРУЕТСЯ, а не делится: она уже «на юнит», и от того,
    // сколько кораблей отделили, величина на юнит не зависит. Делить её здесь, как
    // делится пул `hp`, значило бы наказывать за разделение флота.
    if (st.damageDealt !== undefined) t.damageDealt = st.damageDealt;
    if (st.battles !== undefined) t.battles = st.battles;
    if (st.promoted !== undefined) t.promoted = st.promoted; // PERK-3.2: доля, сплит копирует
    st.count -= move;
    taken.push(t);
  }
  return taken;
}

/** Fold one stack list into another. Two stacks coalesce only when they share unit,
 *  loadout, service grade ({@link serviceKey}) AND are both full-health (no `hp`/`shieldHp` pool) — the same rule
 *  `findHealthyStack` uses. Merging on `hp` equality alone would fuse two damaged
 *  stacks into ONE pool (halving hull) and smear a fitted stack's modules over bare
 *  hulls; damaged/differently-fitted stacks stay separate (combat handles multiple
 *  stacks of one unit fine). Used by `fleet.merge`. */
export function mergeStacks(base: UnitStack[], add: UnitStack[]): UnitStack[] {
  const clone = (st: UnitStack): UnitStack => ({
    ...st,
    ...(st.modules ? { modules: [...st.modules] } : {}),
    ...(st.moduleStars ? { moduleStars: { ...st.moduleStars } } : {}),
    ...(st.moduleRarity ? { moduleRarity: { ...st.moduleRarity } } : {}),
  });
  const out = base.map(clone);
  for (const st of add) {
    const healthy = st.hp === undefined && st.shieldHp === undefined;
    const match = healthy
      ? out.find(
          (o) =>
            o.unit === st.unit && o.heroId === st.heroId &&
            o.hp === undefined &&
            o.shieldHp === undefined &&
            o.armyGroup === st.armyGroup &&
            moduleValueKey(o) === moduleValueKey(st) &&
            serviceKey(o.battles) === serviceKey(st.battles),
        )
      : undefined;
    if (match) {
      mergeMerit(match, st);
      match.count += st.count;
    } else out.push(clone(st));
  }
  return out;
}

/** Влить заслугу `add` в `base` СРЕДНИМ ПО ВЕСУ (VET-2). Зовётся ДО того, как
 *  `base.count` вырастет: веса — это исходные составы обеих половин.
 *
 *  Разбавление здесь не побочный ущерб, а само правило: долить в заслуженное
 *  подразделение свежих кораблей значит развести его честь по новым. Игрок выбирает
 *  между удобством одного большого стека и ветеранством маленького — тот же вопрос,
 *  что задаёт вся механика медалей.
 *
 *  Ни у той, ни у другой половины заслуги нет — поле не заводится вовсе: «медали нет»
 *  и «медаль нулевой степени» для карточки и выплаты разные вещи. */
function mergeMerit(base: UnitStack, add: UnitStack): void {
  const total = base.count + add.count;
  if (total <= 0) return;
  for (const field of ['damageDealt', 'battles', 'promoted'] as const) {
    const a = base[field];
    const b = add[field];
    if (a === undefined && b === undefined) continue;
    base[field] = ((a ?? 0) * base.count + (b ?? 0) * add.count) / total;
  }
}

/** Soft efficiency thresholds: every living unit fires, at min(1, limit / N). */
export const COMBAT_UNIT_CAP = 10;
export const GROUND_COMBAT_UNIT_CAP = 20;

export function combatEfficiency(count: number, limit = COMBAT_UNIT_CAP): number {
  return count > 0 ? Math.min(1, Math.max(0, limit) / count) : 0;
}

/** Combat power only; cargo, vision, upkeep and other noncombat sums stay unchanged. */
export function cappedUnitStat(
  stacks: readonly UnitStack[],
  data: GameData,
  stat: string | ((stats: Record<string, number>) => number),
  eligible?: (def: UnitDef) => boolean,
  cap?: number,
): number {
  // Сумма — это сложение разбивки, а не второй счёт того же (VET-1). Так исход боя
  // не может разойтись с тем, что записано ветерану в заслугу: расходиться нечему,
  // путь один. Тот же приём, что у `splitVolley` в MSB-2, и по той же причине —
  // расхождение двух копий одного правила ловится тестом только если о нём догадаться.
  let total = 0;
  for (const row of cappedUnitBreakdown(stacks, data, stat, eligible, cap)) {
    total += row.damage;
  }
  return total;
}

/** Вклад ОДНОГО стека в залп: кто, сколько стволов встало в линию и что они дали. */
export interface StackContribution {
  /** Индекс стека в исходном массиве — ключ носителя.
   *
   *  Именно индекс, а не имя юнита: два стека одного корпуса — обычное дело (побитый и
   *  целый не сливаются, `findHealthyStack`; с разной оснасткой — тоже). Разбивка «по
   *  имени» слила бы их в одну строку и приписала весь урон одному носителю, а носитель
   *  медали (VET-2) — именно стек. */
  index: number;
  unit: string;
  /** Число живых юнитов этого стека: в залпе участвуют все. */
  firing: number;
  /** Вклад одного юнита — эффективный `stat` или значение формулы. */
  per: number;
  /** Linear hull health times the force size coefficient. */
  powerScale: number;
  /** `firing × per` — что стек положил в залп. */
  damage: number;
}

/** All live stacks contribute; no strongest-first selection or HP from shields. */
export function cappedUnitBreakdown(
  stacks: readonly UnitStack[],
  data: GameData,
  stat: string | ((stats: Record<string, number>) => number),
  eligible?: (def: UnitDef) => boolean,
  cap?: number,
): StackContribution[] {
  const live = stacks.filter(s => s.count > 0 && data.units[s.unit]);
  const count = live.reduce((n, s) => n + s.count, 0);
  const limit = cap ?? (live.every(s => data.units[s.unit]!.domain === 'ground')
    ? GROUND_COMBAT_UNIT_CAP : COMBAT_UNIT_CAP);
  const efficiency = combatEfficiency(count, limit);
  const rows: StackContribution[] = [];
  for (const [index, s] of stacks.entries()) {
    const def = data.units[s.unit];
    if (s.count <= 0 || !def || (eligible && !eligible(def))) continue;
    const stats = effectiveStats(def, s, data);
    const fullHp = s.count * ((stats.hp ?? 0) > 0 ? stats.hp! : 1);
    const health = Math.max(0, Math.min(1, (s.hp ?? fullHp) / fullHp));
    const powerScale = health * efficiency;
    const per = (typeof stat === 'function' ? stat(stats) : (stats[stat] ?? 0)) * powerScale;
    rows.push({ index, unit: s.unit, firing: s.count, per, powerScale, damage: s.count * per });
  }
  rows.sort((a, b) => b.per - a.per || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
  return rows;
}
