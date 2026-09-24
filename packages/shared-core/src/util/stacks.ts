import type { UnitStack } from '../state/gameState';
import type { GameData, UnitDef } from '../data/schemas';
import { effectiveStats } from './loadout';

/** Canonical, order-independent signature of a loadout (one instance per module
 *  id, so it's a set): sorted ids joined. Empty/absent loadout → `''`. Two stacks
 *  merge only when this matches — a fitted stack never silently absorbs a bare one. */
export function loadoutKey(modules?: readonly string[]): string {
  if (!modules || modules.length === 0) return '';
  return [...modules].sort().join(',');
}

/** A healthy (non-combat) stack of `unit` with the SAME loadout in `stacks`, if
 *  any — full hull AND full shield (both pools undefined), so a battle-damaged or
 *  differently-fitted stack never silently merges. */
export function findHealthyStack(
  stacks: UnitStack[],
  unit: string,
  modules?: readonly string[],
): UnitStack | undefined {
  const key = loadoutKey(modules);
  return stacks.find(
    (s) =>
      s.unit === unit &&
      s.hp === undefined &&
      s.shieldHp === undefined &&
      loadoutKey(s.modules) === key,
  );
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
 *  Звёзды в идентичность слияния НЕ входят: они замороженное свойство владельца,
 *  снятое один раз на матч, так что два стека одного игрока с одним лоадаутом всегда
 *  несут одинаковые звёзды (см. {@link UnitStack.moduleStars}). */
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
  const stack = findHealthyStack(stacks, unit, modules);
  if (stack) {
    // Свежая постройка, влитая в заслуженный стек, РАЗБАВЛЯЕТ его заслугу (VET-2) —
    // тем же правилом, что и слияние флотов. Без этого сюда открывалась дыра: долить
    // сотню корпусов в стек с медалью и получить медаль на всю сотню даром.
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
      total += s.count * (effectiveStats(def, s, data)[stat] ?? 0);
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
    if (st.unit !== unit || remaining <= 0) continue;
    if (wantKey !== null && loadoutKey(st.modules) !== wantKey) continue;
    const move = Math.min(st.count, remaining);
    remaining -= move;
    const frac = move / st.count; // share of the pools that leaves with the taken ships
    const t: UnitStack = { unit, count: move };
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
    st.count -= move;
    taken.push(t);
  }
  return taken;
}

/** Fold one stack list into another. Two stacks coalesce only when they share unit,
 *  loadout AND are both full-health (no `hp`/`shieldHp` pool) — the same rule
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
            o.unit === st.unit &&
            o.hp === undefined &&
            o.shieldHp === undefined &&
            loadoutKey(o.modules) === loadoutKey(st.modules),
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

/** Combat line cap (Bytro-style): only this many units per combatant side fire in
 *  a volley — everyone beyond the cap only adds hull/shield to soak damage. Binds
 *  melee attack/defense and bombardment; NOT AA, cargo or the
 *  receiving hull pools. A balance constant (like BROWNOUT) — data after shakeout. */
export const COMBAT_UNIT_CAP = 10;

/** `sumUnitStat` bounded by the combat line cap: only the `cap` strongest units
 *  (per-unit EFFECTIVE `stat`, strongest first, ties by unit id) contribute.
 *  Stacks the optional `eligible` filter rejects neither fire nor consume budget
 *  (a filtered call spends the cap on the matching units only). Deterministic:
 *  the sort key is (stat desc, unit id asc); stacks tied on both have identical
 *  per-unit contributions, so their relative order can't change the sum.
 *
 *  `stat` may be a FORMULA over the unit's effective stats instead of one stat
 *  name (ROS-1.3): bombardment reads `siegeDamage` from the hulls that carry it
 *  and `attack × fraction` from those that don't, and both kinds share ONE firing
 *  line. Two calls could not express that — each would spend the full cap, and a
 *  mixed fleet would fire twice over. */
export function cappedUnitStat(
  stacks: readonly UnitStack[],
  data: GameData,
  stat: string | ((stats: Record<string, number>) => number),
  eligible?: (def: UnitDef) => boolean,
  cap: number = COMBAT_UNIT_CAP,
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
  /** Сколько юнитов этого стека попало в линию огня (кап мог срезать часть). */
  firing: number;
  /** Вклад одного юнита — эффективный `stat` или значение формулы. */
  per: number;
  /** `firing × per` — что стек положил в залп. */
  damage: number;
}

/**
 * Разбивка {@link cappedUnitStat} по стекам: то же правило, тот же порядок, но вклад
 * каждого стека виден отдельно, а не только в сумме.
 *
 * Порядок строк — порядок линии огня (сильные первыми, ties по имени юнита), и он
 * ЗНАЧИМ: сумма считается сложением `damage` в этом порядке, поэтому переставить строки
 * значит изменить последние биты суммы. Стек, до которого бюджет не дошёл, строки не
 * получает вовсе — «не стрелял» и «стрелял на ноль» для медали разные вещи (транспорт
 * без пушек бюджет ЗАНИМАЕТ, и его строка есть, просто с нулевым `damage`).
 */
export function cappedUnitBreakdown(
  stacks: readonly UnitStack[],
  data: GameData,
  stat: string | ((stats: Record<string, number>) => number),
  eligible?: (def: UnitDef) => boolean,
  cap: number = COMBAT_UNIT_CAP,
): StackContribution[] {
  const rows: Array<{ per: number; unit: string; count: number; index: number }> = [];
  for (const [index, s] of stacks.entries()) {
    if (s.count <= 0) continue;
    const def = data.units[s.unit];
    if (!def || (eligible && !eligible(def))) continue;
    const stats = effectiveStats(def, s, data);
    rows.push({
      per: typeof stat === 'function' ? stat(stats) : (stats[stat] ?? 0),
      unit: s.unit,
      count: s.count,
      index,
    });
  }
  rows.sort((a, b) => b.per - a.per || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
  let budget = cap;
  const out: StackContribution[] = [];
  for (const r of rows) {
    if (budget <= 0) break;
    const n = Math.min(r.count, budget);
    out.push({ index: r.index, unit: r.unit, firing: n, per: r.per, damage: n * r.per });
    budget -= n;
  }
  return out;
}
