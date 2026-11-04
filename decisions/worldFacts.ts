/**
 * Сводка мира в шапке его окна (переработка окна мира, заказ владельца 2026-09-29:
 * «капец оно запутанное и баги имеет местами»).
 *
 * Прежнее окно говорило о мире трижды: ряд фишек со счётчиками (⚔ гарнизон, ◆ земля,
 * ▲ корабли, ▣ постройки), счётчики на вкладках — причём одни считали юниты, а другие
 * стеки, и «◆ 4» стояло над «Земля 2», — и отдельная «Сводка» по тапу на имя, которая
 * повторяла владельца, тип, гарнизон и постройки ещё раз. Теперь числа состава живут
 * только на вкладках, а в шапке — то, чего во вкладках нет: состояние мира (столица,
 * блэкаут) и его свойства (бонусы типа, защита построек, базовый выход). Очки победы
 * стоят в самой строке имени (владелец 2026-09-29: «эти 50 можно в шапку»). «Сводка»
 * ушла: всё её уникальное здесь.
 *
 * Чистая функция: что показать и в каком порядке. Слова и значки рисует хост.
 */

export type WorldFact =
  /** Мир — столица игрока: здесь возрождаются герои. */
  | { kind: 'capital' }
  /** Неоплаченная энергия глушит радары и ПКО владельца (ECON-2). */
  | { kind: 'blackout' }
  /** Своя планета вне лимита управления: половина дохода, юниты не строятся (BAL-19). */
  | { kind: 'uncontrolled' }
  /** Своя взятая у другой стороны планета осваивается: доля выхода сейчас, 0..1 (BAL-19). */
  | { kind: 'integrating'; share: number }
  /** Планету взяли у смотрящего, и она ещё осваивается: отбитая до `until` (мс мира), она
   *  сразу его целиком (BAL-19). */
  | { kind: 'reclaim'; until: number }
  /** Мир под обстрелом: когда ударит следующий залп, срок в мс мира (`bombardTimer.ts`).
   *  Срок, а не остаток: шапка пишет его в разметку, а цифры ставит живой узел. Видят
   *  только стороны обстрела — это решает хост. */
  | { kind: 'bombard'; at: number }
  /** Бонусы типа планеты долями (0.15 = +15%); нулевой бонус сюда не попадает. */
  | { kind: 'type'; production?: number; defense?: number }
  /** Постройки срезают урон по миру (FORT-5.15), доля 0..0.9. */
  | { kind: 'cover'; share: number }
  /** Пассивный выход мира в час — только ненулевые ресурсы. */
  | { kind: 'output'; perHour: Readonly<Record<string, number>> };

export interface WorldFactsInput {
  /** Мир принадлежит смотрящему. Столица, блэкаут и лимит управления — только о своём мире. */
  mine: boolean;
  capital: boolean;
  blackout: boolean;
  /** Мир вне лимита управления смотрящего (`uncontrolledPlanets`). */
  uncontrolled?: boolean;
  /** Освоение мира (`Planet.integration`): доля выхода сейчас (`integrationShare`), срок
   *  конца и взят ли мир у смотрящего. `null` — мир не осваивается. */
  integration?: { share: number; until: number; claimMine: boolean } | null;
  /** Срок следующего залпа обстрела (`nextVolleyAt`) или `null`, если таймера нет. */
  bombardAt?: number | null;
  bonuses: { production?: number; defense?: number };
  mitigation: number;
  baseOutput: Readonly<Record<string, number>>;
}

/**
 * Факты шапки по порядку: сначала СОСТОЯНИЕ (о нём надо узнать первым — столица, блэкаут,
 * обстрел), потом СВОЙСТВА мира (что даёт захват или оборона), в конце — выход.
 * Пустое не показывается: фишка «0» — такой же шум, каким были старые счётчики.
 */
export function worldFacts(i: WorldFactsInput): WorldFact[] {
  const out: WorldFact[] = [];
  if (i.mine && i.capital) out.push({ kind: 'capital' });
  if (i.mine && i.blackout) out.push({ kind: 'blackout' });
  if (i.mine && i.uncontrolled) out.push({ kind: 'uncontrolled' });
  // Взятый у смотрящего мир — право отбить, даже если туман ещё помнит мир его собственным.
  if (i.integration?.claimMine) out.push({ kind: 'reclaim', until: i.integration.until });
  else if (i.mine && i.integration) out.push({ kind: 'integrating', share: i.integration.share });
  if (i.bombardAt != null) out.push({ kind: 'bombard', at: i.bombardAt });
  const { production, defense } = i.bonuses;
  if ((production ?? 0) !== 0 || (defense ?? 0) !== 0) {
    out.push({
      kind: 'type',
      ...((production ?? 0) !== 0 ? { production } : {}),
      ...((defense ?? 0) !== 0 ? { defense } : {}),
    });
  }
  if (i.mitigation > 0) out.push({ kind: 'cover', share: i.mitigation });
  const produced = Object.entries(i.baseOutput).filter(([, n]) => n > 0);
  if (produced.length > 0) out.push({ kind: 'output', perHour: Object.fromEntries(produced) });
  return out;
}
