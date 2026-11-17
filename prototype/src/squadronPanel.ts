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
 * 6. **«Патруль» есть только у эскадры, которая умеет висеть** (SHU-6.3): часы и круг
 *    патруля по слабому звену (`squadronPatrol`) и пустой трюм — те же условия, по
 *    которым ядро отобьёт `E_CANNOT_PATROL` и `E_HAS_CARGO`. Десантный челнок кнопки не
 *    получает вовсе. Готовность у патруля та же, что у удара (`canStrike`): база не в
 *    бою, эскадра заправлена.
 * 7. **«Перебазировать» есть, только когда есть КУДА** (SHU-6.5): своя база в дальности
 *    перелёта, где эскадра поместится целиком. Список баз считает
 *    `decisions/relocateTargets.ts` — по состоянию и живым позициям, которых у карточки
 *    нет, поэтому сюда он приходит вопросом `relocate`. Груз кнопку не гасит: десантный
 *    челнок перелетает вместе с бойцом. Готовность базы та же, что у удара.
 * 8. **Удержание патруля видно на карточке дома** (SHU-6.6): эскадра с `hold` вернулась
 *    из удерживаемого патруля и встанет снова сама, как только база будет готова.
 *    Карточка помечает её и даёт снять удержание — снять стоячий приказ можно в любую
 *    минуту, в том числе пока эскадра заправляется, поэтому эта кнопка не ждёт
 *    `canStrike`. Остальные приказы ядро такой эскадре не запрещает: удар, перелёт,
 *    погрузка и делёж снимают удержание сами.
 */
import type { GameData, Squadron, UnitStack } from '../../packages/shared-core/src/index';
import {
  hasMissiles,
  squadronPatrol,
  squadronRefueling,
  stacksSize,
} from '../../packages/shared-core/src/index';
import { squadronHullPercent } from '../../decisions/squadronHull';
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
  /** Сколько мест трюма занимает звено (SHU-5.1): машины по своему `cargoSize`. */
  places: number;
  /** Корпус подбитого борта в процентах (SHU-5.3); `null` — звено цело. */
  hull: number | null;
  /** Наземный груз в трюме (пусто — идёт налегке). */
  cargo: UnitStack[];
  canStrike: boolean;
  /** Эскадра УМЕЕТ патрулировать (правило 6). Кнопка доступна, когда готова база —
   *  `canStrike`. */
  canPatrol: boolean;
  /** Есть своя база, куда звено перелетит (правило 7). Кнопка доступна, когда готова
   *  база, — `canStrike`. */
  canRelocate: boolean;
  canSplit: boolean;
  canMerge: boolean;
  /** Ракетная эскадра (missiles-roadmap): не вылетает, а пускается — свои кнопки. */
  missiles: boolean;
  /** Держит патруль: встанет снова сама, снять можно всегда (правило 8). */
  hold: boolean;
  /** До какого момента мира эскадра заправляется; `null` — заправлена (или `now` не дан). */
  refuelAt: number | null;
}

const size = (sq: Squadron): number => sq.units.reduce((n, st) => n + Math.max(0, st.count), 0);

/**
 * Карточки ангара: по одной на ЖИВОЕ звено (правило 2 — пустых в списке не бывает).
 * «Можно ли лететь» складывается из `blocked` места (пусто, носитель в бою — одно на все
 * звенья) и заправки самой эскадры (`readyAt` против `now`, решение владельца 2026-11-17).
 * Без `now` заправка не видна: так зовут вызывающие, которым важен только состав.
 */
export function squadronCards(
  view: HangarView,
  opts: {
    mine: boolean;
    data: GameData;
    /** Есть ли куда перебазировать это звено (правило 7). Без вопроса — некуда. */
    relocate?: (sq: Squadron) => boolean;
    /** Время мира: эскадра с `readyAt` позже него ещё заправляется. */
    now?: number;
  },
): SquadronCard[] {
  const live = view.squadrons.filter((sq) => size(sq) > 0);
  return live.map((sq) => {
    const cargo = (sq.cargo ?? []).filter((st) => st.count > 0);
    const plan = squadronPatrol(sq, opts.data);
    const missiles = hasMissiles(sq, opts.data);
    const fueling = opts.now !== undefined && squadronRefueling(sq, opts.now);
    // Ракетам мешает только бой базы, челнокам — ещё и своя заправка.
    const free = missiles ? view.blocked !== 'busy' : view.blocked === null && !fueling;
    return {
      id: sq.id,
      name: squadronCallsignOf(sq.id),
      stacks: sq.units.filter((st) => st.count > 0),
      machines: size(sq),
      places: stacksSize(sq.units, opts.data),
      hull: squadronHullPercent(sq, opts.data),
      cargo,
      canStrike: opts.mine && !missiles && free,
      canPatrol: opts.mine && !missiles && plan.hours > 0 && plan.radius > 0 && cargo.length === 0,
      canRelocate: opts.mine && !missiles && (opts.relocate?.(sq) ?? false),
      canSplit: opts.mine && splitOne(sq) !== null,
      // Сводятся только готовые: пока эта эскадра или все её пары заправляются, плитки нет
      // (решение владельца 2026-11-17) — ядро отбило бы `E_REFUELING`.
      canMerge: opts.mine && free && mergeTargets(view, sq.id, opts.data, opts.now).length > 0,
      missiles,
      hold: opts.mine && sq.hold !== undefined,
      refuelAt: fueling ? sq.readyAt! : null,
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

/** Куда можно слить это звено — остальные ЖИВЫЕ звенья той же базы того же рода (ракеты
 *  с челноками ядро не сводит) и, при данном `now`, уже заправленные. Само себя в
 *  приёмниках нет: ядро отбивает такую заявку как опечатку (`E_BAD_PAYLOAD`). */
export function mergeTargets(
  view: HangarView,
  fromId: string,
  data: GameData,
  now?: number,
): string[] {
  const from = view.squadrons.find((sq) => sq.id === fromId);
  const kind = from ? hasMissiles(from, data) : false;
  return view.squadrons
    .filter(
      (sq) =>
        size(sq) > 0 &&
        sq.id !== fromId &&
        hasMissiles(sq, data) === kind &&
        !(now !== undefined && squadronRefueling(sq, now)),
    )
    .map((sq) => sq.id);
}
