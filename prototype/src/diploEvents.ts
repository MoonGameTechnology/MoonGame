/**
 * Дипломатические события из снимков сервера (REFM-30).
 *
 * Почему клиент вообще сравнивает снимки, а не слушает события. Дипломатические события
 * НЕ проходят фог-фильтр сервера: их полезная нагрузка не называет ни одного места,
 * которым игрок владеет, поэтому проекция вырезает их целиком. Без этого сравнения
 * сетевой клиент никогда бы не услышал ни объявления войны себе, ни предложения мира —
 * отношение молча менялось бы в ростере.
 *
 * Правила, которые стоит проверять тестом, а не глазами:
 *
 *  · **чужие пары не наши** — в карте стоек лежат ВСЕ пары матча, а объявлять игроку
 *    надо только то, что касается его;
 *  · **отсутствие стойки — это война** (умолчание ядра), поэтому «ключа не было → стал
 *    мир» обязано читаться как потепление, а не как первое знакомство;
 *  · **отзыв предложения не событие** — он приезжает вместе со сдвигом стойки, и
 *    объявлять его отдельно значило бы говорить дважды об одном;
 *  · **своё исходящее предложение — отдельный вид**: его показывают как «отправлено»,
 *    а не как «вам предложили».
 */
import type { DiplomaticStance, GameState } from '../../packages/shared-core/src/index';

/** Ранг дружелюбия: война (хуже всего) → мир → пакт → союз (ближе всего). Потепление
 *  на ранг требует согласия второй стороны, охлаждение — одностороннее. */
export const STANCES: readonly DiplomaticStance[] = ['war', 'peace', 'pact', 'alliance'];

/** Место стойки в порядке дружелюбия. Незнакомая стойка встаёт в начало (как война). */
export function stanceRank(st: DiplomaticStance): number {
  return Math.max(0, STANCES.indexOf(st));
}

/** Что случилось между двумя снимками. */
export type DiploEvent =
  | { kind: 'stance'; other: string; stance: DiplomaticStance }
  | { kind: 'offer-in'; other: string; stance: DiplomaticStance }
  | { kind: 'offer-out'; other: string; stance: DiplomaticStance };

/** Умолчание ядра: пары нет в карте — значит война. */
const stanceAt = (map: Record<string, DiplomaticStance> | undefined, key: string) =>
  map?.[key] ?? 'war';

/** Второй в паре `a|b`, если я один из них; иначе `null` — пара не моя. */
export function otherInPair(key: string, me: string): string | null {
  const [a, b] = key.split('|');
  if (a === me) return b ?? null;
  if (b === me) return a ?? null;
  return null;
}

/** Стороны предложения `from>to`. */
function offerSides(key: string): { from: string; to: string } | null {
  const [from, to] = key.split('>');
  return from && to ? { from, to } : null;
}

/**
 * Что изменилось для игрока `me` между снимками. Порядок: сперва сдвиги отношений,
 * затем предложения — так игрок читает «что стало» раньше, чем «что предлагают».
 */
export function diffDiplomacy(prev: GameState, next: GameState, me: string): DiploEvent[] {
  const out: DiploEvent[] = [];
  const pairKeys = new Set([
    ...Object.keys(prev.diplomacy ?? {}),
    ...Object.keys(next.diplomacy ?? {}),
  ]);
  for (const key of pairKeys) {
    const other = otherInPair(key, me);
    if (!other) continue; // чужая пара — игроку до неё дела нет
    const before = stanceAt(prev.diplomacy, key);
    const after = stanceAt(next.diplomacy, key);
    if (before !== after) out.push({ kind: 'stance', other, stance: after });
  }
  const offerKeys = new Set([
    ...Object.keys(prev.diplomacyOffers ?? {}),
    ...Object.keys(next.diplomacyOffers ?? {}),
  ]);
  for (const key of offerKeys) {
    const before = prev.diplomacyOffers?.[key];
    const after = next.diplomacyOffers?.[key];
    if (before === after || !after) continue; // отзыв едет вместе со сдвигом стойки
    const sides = offerSides(key);
    if (!sides) continue;
    if (sides.to === me) out.push({ kind: 'offer-in', other: sides.from, stance: after });
    else if (sides.from === me) out.push({ kind: 'offer-out', other: sides.to, stance: after });
  }
  return out;
}
