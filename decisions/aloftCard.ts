import {
  squadronPatrol,
  type GameData,
  type ShuttleStrike,
  type StrikeBase,
  type UnitStack,
} from '../packages/shared-core/src/index';
import { squadronHullPercent } from './squadronHull';

/**
 * ЭСКАДРА В ВОЗДУХЕ ГЛАЗАМИ ИГРОКА (SHU-6.14) — что показывает её карточка и какие
 * приказы предлагает.
 *
 * Заказ владельца 2026-10-11: «их почему-то выделить нельзя, хотя они такие же
 * космические юниты: выделив, их можно разделить и изменить приказ». Ядро научилось этим
 * приказам в SHU-6.13 (`shuttle.redirect`, «Домой», перелёт и делёж по id вылета); здесь —
 * какие из них карточка предлагает прямо сейчас.
 *
 * 1. **Только свой вылет.** Чужие `strikes` проекция снимает целиком, а соло обязано
 *    повторить это само (как трасса, `strikeTrail.ts`, правило 1): карточки чужой
 *    эскадры не бывает.
 * 2. **Кнопка есть, только когда приказ ПРОЙДЁТ** — то же правило, что у карточки в
 *    ангаре (`squadronPanel.ts`, правило 2). Серая кнопка обещала бы приказ, которого тут
 *    не бывает.
 * 3. **Повернувшая домой эскадра бить снова не может**: удар позади, новый — после
 *    перезарядки. «Удар», «Патруль» и «Домой» у обратной ноги ядро отбивает
 *    (`E_RETURNING`), поэтому их нет; сменить базу посадки и разделиться можно.
 * 4. **«Патруль» — только у эскадры, которая умеет висеть**: часы и круг по слабому звену
 *    (`squadronPatrol`) и пустой трюм, как в ангаре (правило 6 там). Десантный челнок
 *    кнопки не получает.
 * 5. **«Держать патруль» — у патруля**: на пути к точке и над ней; у обратной ноги
 *    держать уже нечего (`shuttle.hold` отбивает `E_NOT_PATROLLING`).
 * 6. **«Перебазировать» и «Разделить» спрашиваются у вызывающего.** Куда долетит
 *    эскадра, считает `relocateTargets.ts` по живым позициям, а что отделит один тап —
 *    правило ангара (`splitOne`): своей копии этих правил у карточки нет.
 * 7. **Приказ называется словами игрока**, а не полями ядра: удар по флоту или по миру,
 *    десант, путь к точке патруля, патруль, перелёт, возврат. Срок — когда кончится
 *    нынешняя нога (`arrivesAt`): прибытие, конец патруля, посадка.
 */

/** Чем эскадра занята сейчас (правило 7). */
export type AloftOrder =
  | { kind: 'fleet'; id: string }
  | { kind: 'planet'; id: string }
  | { kind: 'land'; id: string }
  | { kind: 'patrol-out' }
  | { kind: 'patrol' }
  | { kind: 'relocate'; base: StrikeBase }
  | { kind: 'home'; base: StrikeBase };

/** Карточка эскадры в воздухе. */
export interface AloftCard {
  /** id вылета — адрес всех её приказов в воздухе. */
  strikeId: string;
  /** id эскадры: позывной строится из него, как у карточки в ангаре. */
  squadronId: string;
  stacks: UnitStack[];
  machines: number;
  /** Корпус подбитого борта в процентах; `null` — эскадра цела. */
  hull: number | null;
  /** Десант на борту. */
  cargo: UnitStack[];
  order: AloftOrder;
  /** Когда кончится нынешняя нога — мировое время (правило 7). */
  until: number;
  /** Повернула домой: удар позади (правило 3). */
  returning: boolean;
  canStrike: boolean;
  canPatrol: boolean;
  canRecall: boolean;
  canRelocate: boolean;
  canSplit: boolean;
  /** Удержание патруля: `null` — патруля нет, держать нечего (правило 5). */
  hold: boolean | null;
}

/** Что эскадра делает — словами игрока (правило 7). */
function orderOf(st: ShuttleStrike): AloftOrder {
  if (st.leg === 'back') {
    return st.target.kind === 'base'
      ? { kind: 'relocate', base: st.base }
      : { kind: 'home', base: st.base };
  }
  if (st.leg === 'patrol') return { kind: 'patrol' };
  const target = st.target;
  if (target.kind === 'fleet') return { kind: 'fleet', id: target.id };
  if (target.kind === 'planet') {
    const landing = (st.cargo ?? []).some((c) => c.count > 0);
    return landing ? { kind: 'land', id: target.id } : { kind: 'planet', id: target.id };
  }
  if (target.kind === 'point') return { kind: 'patrol-out' };
  return { kind: 'relocate', base: st.base };
}

/**
 * Карточка своего вылета `strike` (правила 1–7); чужой — `null`. `relocate` и `split` —
 * ответы вызывающего (правило 6): есть ли куда сесть и есть ли что отделить.
 */
export function aloftCard(
  strike: ShuttleStrike,
  opts: { me: string; data: GameData; relocate: boolean; split: boolean },
): AloftCard | null {
  if (strike.owner !== opts.me) return null; // правило 1
  const stacks = strike.units.filter((st) => st.count > 0);
  const cargo = (strike.cargo ?? []).filter((st) => st.count > 0);
  const returning = strike.leg === 'back';
  const plan = squadronPatrol(strike, opts.data);
  const patrolling = strike.target.kind === 'point' && !returning && !!strike.patrol;
  return {
    strikeId: strike.id,
    squadronId: strike.squadronId,
    stacks,
    machines: stacks.reduce((n, st) => n + st.count, 0),
    hull: squadronHullPercent(strike, opts.data),
    cargo,
    order: orderOf(strike),
    until: strike.arrivesAt,
    returning,
    canStrike: !returning, // правило 3
    canPatrol: !returning && plan.hours > 0 && plan.radius > 0 && cargo.length === 0, // правило 4
    canRecall: !returning,
    canRelocate: opts.relocate, // правило 6
    canSplit: opts.split,
    hold: patrolling ? strike.patrol?.hold === true : null, // правило 5
  };
}
