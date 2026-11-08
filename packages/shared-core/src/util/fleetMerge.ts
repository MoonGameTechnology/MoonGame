import type { HandlerContext } from '../kernel/module';
import type { Fleet } from '../state/gameState';
import { defHasTrait } from '../data/traits';
import { mergeStacks } from './stacks';
import { fleetCloakRating } from '../state/cloak';

/**
 * Часы, которые история флота повесила на его корабли: задержка щитов после попадания,
 * перезарядка ПРО и срыв маскировочного поля. Они принадлежат КОРАБЛЯМ, а не id флота,
 * поэтому переходят с ними при расколе и слиянии, и остаётся более поздний срок. Иначе
 * раскол или слияние со свежим флотом сбрасывали бы их одним нажатием.
 */
export function inheritFleetClocks(h: HandlerContext, target: Fleet, source: Fleet): void {
  const later = (a: number | undefined, b: number | undefined) =>
    b === undefined ? a : a === undefined ? b : Math.max(a, b);
  const damaged = later(target.lastDamagedAt, source.lastDamagedAt);
  if (damaged !== undefined) target.lastDamagedAt = damaged;
  const pd = later(target.pdCooldownUntil, source.pdCooldownUntil);
  if (pd !== undefined) target.pdCooldownUntil = pd;
  // Срыв поля пишется только флоту, который его несёт (`cloakField`).
  const cloak = later(target.cloakBrokenUntil, source.cloakBrokenUntil);
  if (cloak !== undefined && fleetCloakRating(target, h.ctx.data) > 0) target.cloakBrokenUntil = cloak;
}

/**
 * Сплавить `from` в `into`. Общая ЧАСТЬ: одна и та же плавка нужна приказу игрока
 * (`fleet.merge`), созревшему намерению (MRG-1) и автослиянию на прибытии
 * (`autoMerge`), а два исполнения одного правила — это ровно тот баг, из-за которого
 * модуль флота и заводили. Гейты (свой, свободен, рядом) спрашивает вызывающий.
 */
export function fuseFleets(h: HandlerContext, fromId: string, intoId: string, owner: string): void {
  const from = h.state.fleets[fromId];
  const into = h.state.fleets[intoId];
  if (!from || !into) return;
  into.units = mergeStacks(into.units, from.units);
  into.landing = mergeStacks(into.landing ?? [], from.landing ?? []);
  inheritFleetClocks(h, into, from);
  // Both enabled modes survive, regardless of which fleet keeps its identity.
  // Keep one existing reload deadline: merging must neither restart the wait nor
  // create an immediate/second volley. Of two live clocks the LATER one stays: ships
  // that have just fired never fire again on the other fleet's earlier deadline.
  // A disabled fleet's stale clock is ignored.
  if (from.bombarding) {
    const nextAt = into.bombarding ? into.bombardNextAt : undefined;
    into.bombarding = true;
    if (from.bombardNextAt !== undefined && (nextAt === undefined || from.bombardNextAt > nextAt)) {
      into.bombardNextAt = from.bombardNextAt;
    } else if (nextAt === undefined) {
      delete into.bombardNextAt;
    }
  }
  const autoAssault = h.state.autoAssault;
  if (autoAssault) {
    if (autoAssault[fromId]) autoAssault[intoId] = true;
    delete autoAssault[fromId];
    if (Object.keys(autoAssault).length === 0) delete h.state.autoAssault;
  }
  // Шаттлы в трюме едут вместе с кораблями (SHU-5.1): без этой строки эскадры
  // сплавленного флота исчезали бы молча вместе с его записью.
  if (from.hangar?.length) into.hangar = [...(into.hangar ?? []), ...from.hangar];
  // Heroes are bound by fleetId: the hero UNIT rides into the merged fleet, so
  // the hero ENTITY must follow — a stale fleetId would orphan it (and
  // hero.spawn could then mint a duplicate free flagship).
  for (const hr of Object.values(h.state.heroes ?? {})) {
    if (hr.fleetId === fromId) hr.fleetId = intoId;
  }
  delete h.state.fleets[fromId];
  h.emit('fleet.merged', { from: fromId, into: intoId, owner, at: into.location });
}

/**
 * НЕПОДВИЖНЫЙ ОТРЯД НЕ СЛИВАЕТСЯ И НЕ ДЕЛИТСЯ. Отряд с `immobile`-юнитом — это
 * орудия крепости: они принадлежат узлу, а не флоту игрока (FORT-5.4). Находка Codex
 * на #1393: `fleet.merge` в орудия отдавал обычным кораблям прикрытие крепости —
 * станция узнаёт орудия по id флота, а не по составу. Слияние или раскол В ОБРАТНУЮ
 * сторону уводил орудия из отряда, и станция досчитывала их до уровня ядра заново —
 * бесплатные пушки. Правило по трейту, а не по id: модулю флота станция не известна.
 */
export function emplacedFleet(h: HandlerContext, f: Fleet): boolean {
  return f.units.some((s) => defHasTrait(h.ctx.data.units[s.unit], 'immobile'));
}
