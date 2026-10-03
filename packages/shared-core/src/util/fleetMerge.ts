import type { HandlerContext } from '../kernel/module';
import type { Fleet } from '../state/gameState';
import { defHasTrait } from '../data/traits';
import { mergeStacks } from './stacks';

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
