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
 * 4. **Гружёную эскадру делить нельзя** — то же правило, что в ядре (`E_HAS_CARGO`), и
 *    здесь оно выражено отсутствием кнопки, а не отказом после тапа.
 * 5. **Десант грузится в КОНКРЕТНОЕ звено.** Вместимость и трюм берутся у эскадры, а
 *    арифметика «сколько влезет» — у общей модели `troopsMenu.ts`, той же, что у
 *    корабельного десанта: вторая копия этих правил разъехалась бы на первой правке.
 *    Очередей и резервов у эскадры нет — в ядре её погрузка мгновенна (SHU-4.2).
 */
import type { GameData, Squadron, UnitStack } from '../../packages/shared-core/src/index';
import { squadronCargoCapacity, squadronCargoUsed } from '../../packages/shared-core/src/index';
import { fleetCallsign } from './fleetName';
import type { HangarView } from './hangarPanel';
import { isGroundUnit } from './planetSummary';
import type { TroopsInput } from './troopsMenu';

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
  /** Есть ли куда грузить десант: у звена ненулевая вместимость трюма. */
  canLoad: boolean;
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
    const bay = squadronCargoCapacity(sq, opts.data);
    return {
      id: sq.id,
      name: squadronCallsignOf(sq.id),
      stacks: sq.units.filter((st) => st.count > 0),
      machines: size(sq),
      cargo,
      canStrike: opts.mine && view.blocked === null,
      canSplit: opts.mine && splitOne(sq) !== null,
      canMerge: opts.mine && live.length > 1,
      canLoad: opts.mine && bay > 0,
    };
  });
}

/** Что отделит один тап «Разделить» (правило 3): один борт первого живого типа.
 *  `null` — делить нечего: одиночка (ядро отобьёт `E_BAD_PAYLOAD`, ведь уходит ВСЁ)
 *  или гружёное звено (правило 4). */
export function splitOne(sq: Squadron): { unit: string; count: number } | null {
  if (squadronCargoUsed(sq) > 0) return null;
  if (size(sq) <= 1) return null;
  const first = sq.units.find((st) => st.count > 0);
  return first ? { unit: first.unit, count: 1 } : null;
}

/** Куда можно слить это звено — все остальные ЖИВЫЕ звенья той же базы. Само себя в
 *  приёмниках нет: ядро отбивает такую заявку как опечатку (`E_BAD_PAYLOAD`). */
export function mergeTargets(view: HangarView, fromId: string): string[] {
  return view.squadrons.filter((sq) => size(sq) > 0 && sq.id !== fromId).map((sq) => sq.id);
}

/**
 * Вход модели десанта для ОДНОГО звена (правило 5). Гарнизон базы против трюма
 * эскадры; арифметику «сколько влезет» считает `troopsModel` — та же, что у
 * корабельного десанта.
 */
export function troopsInputForSquadron(
  sq: Squadron,
  source: readonly UnitStack[],
  data: GameData,
): TroopsInput {
  const cargo = sq.cargo ?? [];
  const types = new Set<string>();
  for (const st of source) if (st.count > 0 && isGroundUnit(st.unit, data)) types.add(st.unit);
  for (const st of cargo) if (st.count > 0) types.add(st.unit);
  const count = (stacks: readonly UnitStack[], unit: string): number =>
    stacks.reduce((n, st) => n + (st.unit === unit ? st.count : 0), 0);
  return {
    units: [...types].sort().map((unit) => ({
      unit,
      garrison: count(source, unit),
      garrisonAll: count(source, unit),
      hold: count(cargo, unit),
      holdAll: count(cargo, unit),
      // Ни очереди, ни резерва: погрузка в трюм эскадры мгновенна (ядро, SHU-4.2), в
      // отличие от часовой погрузки на корабль (CARGO-1).
      queued: 0,
      reserved: 0,
      cargoSize: data.units[unit]?.stats.cargoSize ?? 1,
    })),
    capacity: squadronCargoCapacity(sq, data),
    used: squadronCargoUsed(sq),
    reservedCargo: 0,
    plan: {},
  };
}
