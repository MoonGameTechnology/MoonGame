/**
 * Подпись флота под его именем: сколько кораблей и сколько десанта (UIX-10.5, заказ
 * владельца 2026-11-06 пересобрать интерфейс партии «в том же стиле»: без слов, которые
 * ничего не сообщают). Десант пишется, только пока он есть: «1 корабль · 0 десанта» стояло
 * почти в каждой подписи. Короткая форма «Корабли: N» — у узкой шапки ПК.
 *
 * Возвращает ключ локали и числа к нему: `t(...fleetCounts(ships, troops, pc))`.
 */
export function fleetCounts(
  ships: number,
  troops: number,
  pc: boolean,
): [key: string, args: { s: number; tr: number }] {
  const key = pc
    ? troops > 0
      ? 'side.fleet.sub.pc'
      : 'side.fleet.sub.pc.ships'
    : troops > 0
      ? 'side.fleet.sub'
      : 'side.fleet.sub.ships';
  return [key, { s: ships, tr: troops }];
}
