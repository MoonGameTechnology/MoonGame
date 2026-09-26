import type { GameData, UnitDef } from '../packages/shared-core/src/index';

/**
 * Боец десантного челнока (SHU-5.2, резолюция владельца 2026-09-26): челнок с трейтом
 * `lander` строится СРАЗУ с одним наземным юнитом внутри, и в заказе (`unit.build`)
 * этот юнит называется полем `troop`. Ядро требует его у такого челнока и отбивает у
 * любого другого корпуса.
 *
 * Здесь — общие обоим клиентам и боту ответы на «кого можно посадить» и «сколько это
 * стоит». «Можно ли ИМЕННО ЗДЕСЬ» (технология, казармы или завод на этом мире) здесь
 * не решается: это правило ядра, и спрашивается оно у ядра пробой приказа — своя копия
 * разъехалась бы с ним на первой правке.
 */
export const LANDER_TRAIT = 'lander';

export function isLander(def: Pick<UnitDef, 'traits'> | undefined): boolean {
  return def?.traits.includes(LANDER_TRAIT) ?? false;
}

/** Кандидаты в бойцы: наземные юниты, которых вообще можно заказать (без `issued` и
 *  `immobile` — то же, что отбивает ядро), от самого УДАРНОГО. Тай-брейк по id: выбор
 *  по умолчанию и выбор бота не должны зависеть от порядка ключей в данных. */
export function landerTroopCandidates(data: GameData): string[] {
  return Object.entries(data.units)
    .filter(
      ([, u]) =>
        u.domain === 'ground' && !u.traits.includes('issued') && !u.traits.includes('immobile'),
    )
    .sort(
      ([a, ua], [b, ub]) =>
        (ub.stats.attack ?? 0) - (ua.stats.attack ?? 0) || (a < b ? -1 : a > b ? 1 : 0),
    )
    .map(([id]) => id);
}

/** Кого из кандидатов ядро примет в заказ. `probe(troop)` — ответ ядра на заказ челнока
 *  с этим бойцом (код отказа или `null`). Нехватка денег (`E_INSUFFICIENT`) бойца НЕ
 *  исключает: это «подкопи», а не «нельзя», и цену игрок должен видеть. Порядок
 *  кандидатов сохраняется. */
export function orderableTroops(
  candidates: readonly string[],
  probe: (troop: string) => string | null,
): string[] {
  return candidates.filter((g) => {
    const code = probe(g);
    return code === null || code === 'E_INSUFFICIENT';
  });
}

/** Цена ОДНОГО челнока с бойцом — челнок плюс боец, как считает ядро (`orderSpec`). */
export function landerCost(data: GameData, unit: string, troop: string): Record<string, number> {
  const out: Record<string, number> = { ...(data.units[unit]?.cost ?? {}) };
  for (const [r, n] of Object.entries(data.units[troop]?.cost ?? {})) out[r] = (out[r] ?? 0) + n;
  return out;
}
