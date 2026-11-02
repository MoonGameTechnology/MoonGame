import type { FireRole } from './groundTargets';

/** Ordered attacks; each volley is committed once, then surviving defenders reply.
 * Replies never recursively trigger another reply. Equal-time order is the caller's
 * stable battle-entry order, shared by live combat and its pure forecast. */
export function combatSequence<T>(
  sides: readonly T[],
  due: readonly T[],
  alive: (side: T) => boolean,
  hostile: (a: T, b: T) => boolean,
  defends: (side: T) => boolean,
  fire: (source: T, targets: readonly T[], role: FireRole) => void,
): boolean {
  let fired = false;
  for (const source of due) {
    if (!alive(source)) continue;
    const targets = sides.filter(
      (target) => target !== source && alive(target) && hostile(source, target),
    );
    if (!targets.length) continue;
    fired = true;
    fire(source, targets, 'attack');
    for (const target of targets) {
      if (alive(source) && alive(target) && defends(target)) fire(target, [source], 'defense');
    }
  }
  return fired;
}
