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
  /** Бонусы типа планеты долями (0.15 = +15%); нулевой бонус сюда не попадает. */
  | { kind: 'type'; production?: number; defense?: number }
  /** Постройки срезают урон по миру (FORT-5.15), доля 0..0.9. */
  | { kind: 'cover'; share: number }
  /** Пассивный выход мира в час — только ненулевые ресурсы. */
  | { kind: 'output'; perHour: Readonly<Record<string, number>> };

export interface WorldFactsInput {
  /** Мир принадлежит смотрящему. Столица и блэкаут — только о своём мире. */
  mine: boolean;
  capital: boolean;
  blackout: boolean;
  bonuses: { production?: number; defense?: number };
  mitigation: number;
  baseOutput: Readonly<Record<string, number>>;
}

/**
 * Факты шапки по порядку: сначала СОСТОЯНИЕ (о нём надо узнать первым — столица, блэкаут),
 * потом СВОЙСТВА мира (что даёт захват или оборона), в конце — выход.
 * Пустое не показывается: фишка «0» — такой же шум, каким были старые счётчики.
 */
export function worldFacts(i: WorldFactsInput): WorldFact[] {
  const out: WorldFact[] = [];
  if (i.mine && i.capital) out.push({ kind: 'capital' });
  if (i.mine && i.blackout) out.push({ kind: 'blackout' });
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
