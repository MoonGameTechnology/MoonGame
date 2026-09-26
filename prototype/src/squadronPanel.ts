/**
 * ЭСКАДРА ГЛАЗАМИ ИГРОКА (SHU-4.3) — что показывает карточка соединения и что она
 * предлагает.
 *
 * SHU-4.2 дал эскадре личность В ЯДРЕ: свой id, свой состав, свой трюм, делёж и
 * слияние приказами. В панели этого не было ничего: ангар рисовался ОДНИМ списком
 * машин, а кнопки «Удар» и «На борт» брали ПЕРВОЕ живое звено. То есть выбирать было
 * не из чего, собрать состав нельзя, а десант грузился «как-нибудь» в момент удара.
 *
 * Правила, которые здесь закреплены:
 *
 * 1. **Позывной ВЫВОДИТСЯ из id, а не хранится.** Ровно как имя флота (`fleetName.ts`):
 *    один id даёт одно имя на всех клиентах, имя не едет по сети и не может разъехаться
 *    с состоянием. Поэтому в ядре его нет и не должно появиться.
 * 2. **Кнопка есть, только когда приказ ПРОЙДЁТ** — то же правило, что у ангара
 *    (`hangarPanel.ts`, правило 4) и у командного ряда (`cmdPresence.ts`). Нечего
 *    делить, не с чем сливать, нечем грузить — кнопки нет, а не серая: серая обещает
 *    действие, которого в этом месте не бывает.
 * 3. **Делёж идёт ПО ОДНОЙ машине.** Тап отделяет один борт в новое звено, повторный —
 *    ещё один. Степпер здесь был бы третьим счётчиком в панели (после десанта и
 *    конвейера) ради состава из двух-трёх машин: в порту их шесть, а в трюме носителя
 *    четыре. Выбор первого типа в смешанном звене ДЕТЕРМИНИРОВАН порядком стеков —
 *    «какой-нибудь» разошёлся бы у двух клиентов.
 * 4. **Эскадру со СМЕШАННЫМ десантом делить нельзя** — то же правило, что в ядре
 *    (`E_HAS_CARGO`), и здесь оно выражено отсутствием кнопки, а не отказом после тапа.
 *    Однородную можно: отделённый борт уносит своего бойца (SHU-5.2).
 * 5. **Десант не грузится, а строится.** С SHU-5.2 десантный челнок выходит с верфи с
 *    бойцом внутри, поэтому трюм карточка только ПОКАЗЫВАЕТ (`cargo`), а кнопки
 *    погрузки у неё нет.
 */
import type { GameData, Squadron, UnitStack } from '../../packages/shared-core/src/index';
import { fleetCallsign } from './fleetName';
import type { HangarView } from './hangarPanel';

/** Ключ слова, которым зовут соединение ЧЕЛНОКОВ (SHU-4.1: группа кораблей — флот,
 *  группа челноков — эскадра). Переводится `t()` на месте вызова. */
export const SQUADRON_KIND_KEY = 'fleet.kind.shuttles';

/** Позывной эскадры — та же чистая функция от id, что и у флота (правило 1). Общая
 *  намеренно: два генератора имён для двух видов соединений разошлись бы стилем, и
 *  игрок читал бы «VORTEX 3» у флота и что-то иное у звена. */
export function squadronCallsignOf(id: string): string {
  return fleetCallsign(id);
}

/** Что показывает и что предлагает одна карточка. */
export interface SquadronCard {
  id: string;
  /** Позывной без слова-типа: слово приходит из локали на месте отрисовки. */
  name: string;
  /** Машины звена — состав строками. */
  stacks: UnitStack[];
  /** Сколько бортов всего. */
  machines: number;
  /** Наземный груз в трюме (пусто — идёт налегке). */
  cargo: UnitStack[];
  canStrike: boolean;
  canSplit: boolean;
  canMerge: boolean;
}

const size = (sq: Squadron): number => sq.units.reduce((n, st) => n + Math.max(0, st.count), 0);

/**
 * Карточки ангара: по одной на ЖИВОЕ звено (правило 2 — пустых в списке не бывает).
 * `blocked` у места общий (топливо и перезарядка принадлежат БАЗЕ, SHU-1.2), поэтому
 * «можно ли лететь» одинаково для всех звеньев — и приходит сюда из `HangarView`.
 */
export function squadronCards(
  view: HangarView,
  opts: { mine: boolean; data: GameData },
): SquadronCard[] {
  const live = view.squadrons.filter((sq) => size(sq) > 0);
  return live.map((sq) => {
    const cargo = (sq.cargo ?? []).filter((st) => st.count > 0);
    return {
      id: sq.id,
      name: squadronCallsignOf(sq.id),
      stacks: sq.units.filter((st) => st.count > 0),
      machines: size(sq),
      cargo,
      canStrike: opts.mine && view.blocked === null,
      canSplit: opts.mine && splitOne(sq) !== null,
      canMerge: opts.mine && live.length > 1,
    };
  });
}

/** Что отделит один тап «Разделить» (правило 3): один борт первого живого типа.
 *  `null` — делить нечего: одиночка (ядро отобьёт `E_BAD_PAYLOAD`, ведь уходит ВСЁ)
 *  или звено со смешанным десантом (правило 4). */
export function splitOne(sq: Squadron): { unit: string; count: number } | null {
  if ((sq.cargo ?? []).filter((st) => st.count > 0).length > 1) return null;
  if (size(sq) <= 1) return null;
  const first = sq.units.find((st) => st.count > 0);
  return first ? { unit: first.unit, count: 1 } : null;
}

/** Куда можно слить это звено — все остальные ЖИВЫЕ звенья той же базы. Само себя в
 *  приёмниках нет: ядро отбивает такую заявку как опечатку (`E_BAD_PAYLOAD`). */
export function mergeTargets(view: HangarView, fromId: string): string[] {
  return view.squadrons.filter((sq) => size(sq) > 0 && sq.id !== fromId).map((sq) => sq.id);
}
