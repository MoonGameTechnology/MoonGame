/**
 * Перебежчик — что показать игроку, чья контрразведка перевербовала чужого агента (решение
 * владельца 2026-11-11). Само правило — кто перебегает, сколько ждёт и что значит ответ — в
 * ядре (`packages/shared-core/src/modules/espionage/defector.ts`); здесь только карточка окна.
 *
 * 1. **Ждущий ответа виден, пока ждёт.** Предложение лежит в состоянии мира, а не в ленте:
 *    пропущенное уведомление не теряет перебежчика, значок висит до ответа или побега.
 * 2. **Первым — тот, кто сбежит раньше.** Порядок по сроку ответа, при равенстве — по номеру.
 * 3. **Карточка называет числа, а не прозу:** чей агент, где пойман, его опыт и сколько
 *    осталось до побега; опыт — с уровнем. Опыта нет — строки опыта нет.
 * 4. **Новость о перебежчике — только поймавшему,** одной строкой журнала на событие: просьба,
 *    принят, сбежал (отказ) или не дождался. Просьба идёт без тоста — к ответу и так зовёт
 *    значок; остальное — с тостом.
 */
import { spyLevel, type GameState } from '../packages/shared-core/src/index';

/** Одна карточка перебежчика. */
export interface DefectorCard {
  offerId: number;
  /** Чьим агентом он был. */
  from: string;
  /** Где его поймали. */
  planetId: string;
  /** Опыт, который он приносит; 0 — без строки опыта (правило 3). */
  xp: number;
  /** Уровень по этому опыту (модуль `spy-levels`). */
  level: number;
  /** Сколько осталось до побега, мс мирового времени (не меньше 0). */
  leftMs: number;
}

/** Перебежчики, ждущие ответа игрока `me` в миг `now` (правила 1–2). */
export function defectorCards(state: GameState, me: string, now: number): DefectorCard[] {
  return [...(state.spyOffers?.[me] ?? [])]
    .sort((a, b) => a.until - b.until || a.id - b.id)
    .map((o) => ({
      offerId: o.id,
      from: o.from,
      planetId: o.planetId,
      xp: o.xp ?? 0,
      level: spyLevel(o.xp),
      leftMs: Math.max(0, o.until - now),
    }));
}

/** Строка журнала о перебежчике: ключ локали, чьим агентом он был и нужен ли тост. */
export interface DefectorNews {
  key: string;
  from: string;
  quiet: boolean;
}

/** Правило 4. `null` — событие не о перебежчике игрока `me`. */
export function defectorNews(
  type: string,
  payload: Record<string, unknown>,
  me: string,
): DefectorNews | null {
  if (payload.owner !== me || typeof payload.from !== 'string') return null;
  const from = payload.from;
  if (type === 'espionage.defector') return { key: 'log.spy.defector', from, quiet: true };
  if (type === 'espionage.defector.joined')
    return { key: 'log.spy.defector.joined', from, quiet: false };
  if (type !== 'espionage.defector.fled') return null;
  const key = payload.expired === true ? 'log.spy.defector.expired' : 'log.spy.defector.fled';
  return { key, from, quiet: false };
}
