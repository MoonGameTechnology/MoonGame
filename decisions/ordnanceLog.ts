/**
 * Строка журнала о ракетной мине и ракете из ангара (missiles-roadmap).
 *
 * Ракета из ангара летит тем же путём, что ракета мины (события `rocketMine.*`), но журнал
 * зовёт её ракетой: событие несёт `mine: false`. Строку видит только хозяин.
 */

const MINE_KEYS: Record<string, string> = {
  'rocketMine.ready': 'mine.ready',
  'rocketMine.cancelled': 'mine.cancelled',
  'rocketMine.launched': 'mine.launched',
  'rocketMine.intercepted': 'mine.intercepted',
  'rocketMine.hit': 'mine.hit',
  'rocketMine.disarmed': 'mine.disarmed',
};

const MISSILE_KEYS: Record<string, string> = {
  'rocketMine.intercepted': 'missile.intercepted',
  'rocketMine.hit': 'missile.hit',
  'missile.launched': 'missile.launched',
  'missile.missed': 'missile.missed',
};

/** Ключ локали для события или `null`, если строки нет (чужое или не про ракеты). */
export function ordnanceLogKey(
  type: string,
  payload: Record<string, unknown> | undefined,
  me: string,
): string | null {
  const missile = type.startsWith('missile.');
  if (!missile && !type.startsWith('rocketMine.')) return null;
  if (!payload || (payload.owner !== me && payload.playerId !== me)) return null;
  if (missile) return MISSILE_KEYS[type] ?? null;
  return (payload.mine === false ? MISSILE_KEYS[type] : undefined) ?? MINE_KEYS[type] ?? null;
}
