/**
 * Краденая разведка: окна интела и журнал шпионажа (REFM-28).
 *
 * Модуль ядра выдаёт ОГРАНИЧЕННЫЕ ПО ВРЕМЕНИ окна (`state.intel[me]`), а клиентский туман
 * их чтит: окно `planet` опознаёт узел (с SPY-8 других видов нет). То же самое делает `visibleState` на сервере —
 * здесь это повторяется только потому, что соло-режим проекцию не гоняет и считает туман
 * сам, по полному состоянию.
 *
 * Два правила, которые стоит проверять тестом, а не глазами:
 *
 *  · **истёкшее окно не видно** — просроченные гранты отбрасываются ДО того, как ядро
 *    успеет их вычистить, иначе карта секунду-другую показывала бы то, за что уже не
 *    заплачено;
 *  · **опознание влечёт радар** — узел, опознанный краденым окном, обязан попасть и в
 *    радарное кольцо: иначе он рисовался бы «в деталях», но вне зоны обнаружения.
 *
 * Журнал шпионажа — сессионный и ОГРАНИЧЕННЫЙ: без потолка он рос бы весь матч, а окно
 * вкладки показывает последние строки.
 */
import {
  BASE_SPY_AGENTS,
  SPY_OP_COST,
  type GameState,
  type IntelGrant,
  type SpyOp,
  turnedAgents,
} from '../../packages/shared-core/src/index';
import { spyAgents, type SpyAgents } from '../../decisions/spyAgents';

/** Базовая цена операции (SPY-12) — та же таблица ядра `SPY_OP_COST`. Это ПОДПИСЬ на
 *  кнопке: авторитетно ядро, оно же отвергает попытку с `E_INSUFFICIENT`, когда денег мало. */
export const SPY_COST: Readonly<Record<SpyOp, number>> = SPY_OP_COST;

/** Разброс цен для сводки во вкладке «Шпионаж»: «50–400». */
export function spyCostRange(): string {
  const all = Object.values(SPY_COST);
  return `${Math.min(...all)}–${Math.max(...all)}`;
}

/** Сеть агентов игрока сейчас (SPY-6). Размер — база ядра `BASE_SPY_AGENTS` и
 *  перевербованные агенты (SPY-18): как и `SPY_COST`, это ПОДПИСЬ, авторитетно ядро (оно
 *  отвергает попытку с `E_NO_AGENT`). */
export function myAgents(s: GameState, me: string): SpyAgents {
  return spyAgents(s.spyAgents?.[me], BASE_SPY_AGENTS + turnedAgents(s, me, s.time), s.time);
}

/** Сколько строк держит сессионный журнал шпионажа. */
export const SPY_LOG_MAX = 30;

/** Строка журнала: игровое время и уже локализованный текст. */
export interface SpyEntry {
  at: number;
  text: string;
}

/** ЖИВЫЕ окна на момент `now`. Просроченное окно не показывает ничего — даже если ядро
 *  ещё не успело его вычистить. */
export function liveGrants(grants: readonly IntelGrant[] | undefined, now: number): IntelGrant[] {
  return (grants ?? []).filter((g) => g.until > now);
}

/** Цели живых окон одного вида: id миров (`planet`). */
export function targetsOf(grants: readonly IntelGrant[], kind: IntelGrant['kind']): Set<string> {
  const out = new Set<string>();
  for (const g of grants) if (g.kind === kind) out.add(g.target);
  return out;
}

/**
 * Досыпать в туман то, что куплено разведкой: каждый существующий мир из окон `planet`
 * становится опознанным И попадает в радарное кольцо (опознание влечёт обнаружение —
 * иначе узел рисовался бы в деталях, но «вне радара»). Несуществующие цели молча
 * пропускаются: окно могло пережить свой мир.
 */
export function grantVision(
  vision: { identify: Set<string>; radar: Set<string> },
  planetTargets: ReadonlySet<string>,
  exists: (id: string) => boolean,
): void {
  for (const id of planetTargets) {
    if (!exists(id)) continue;
    vision.identify.add(id);
    vision.radar.add(id);
  }
}

/** Дописать строку в журнал, срезав всё сверх потолка. Возвращает тот же массив —
 *  журнал живёт у хозяина, модуль только держит его в границах. */
export function pushSpyEntry(log: SpyEntry[], entry: SpyEntry, max = SPY_LOG_MAX): SpyEntry[] {
  log.push(entry);
  while (log.length > max) log.shift();
  return log;
}

/** Осталось ли жить окну (в игровых миллисекундах) — для подписи «ещё N ч». */
export function grantLeftMs(grant: IntelGrant, now: number): number {
  return Math.max(0, grant.until - now);
}
