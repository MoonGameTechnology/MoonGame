/**
 * Строка обозревателя матчей: правила партии и окно входа (REFM-50).
 *
 * Список матчей приходит с сервера тремя вкладками — «доступные», «мои активные» и
 * «архив», — и одна и та же строка на них значит разное. Отсюда правила.
 *
 * 1. **Окно входа показывается ТОЛЬКО на «доступных».** Оно про то, успеет ли НОВИЧОК
 *    занять свободное кресло (SES-2.3/2.4). В своих активных матчах и в архиве кресло
 *    уже твоё, реконнект окном не гейтится — подпись «осталось 3ч» там врала бы, что
 *    тебя вот-вот перестанут пускать в собственный матч.
 * 2. **«Окна нет» и «окно на десять лет» — разные вещи.** Когда окна нет вовсе, сервер
 *    шлёт часовой размером с `Number.MAX_SAFE_INTEGER`; напечатать его буквально значит
 *    показать «осталось 3650д» — шум, который вытесняет полезное. Всё, что дальше
 *    десятилетия реального времени, считается бесконечностью и строки не занимает.
 * 3. **Старый сервер не присылает поле вовсе** — это «окно открыто», а не «закрыто».
 *    Спутать значит спрятать живые матчи от игрока на ровном месте.
 * 4. **Меньше суток — это «скоро».** Отдельный признак, потому что «осталось 3ч» и
 *    «осталось 3д» набраны одинаково, а решают для игрока разное.
 *
 * 5. **Режим (BRW-4) знает ДВА разных «не знаю».** Нет `modeId` — сервер про режим не
 *    сказал ничего (или он старый), строка молчит целиком. Есть `modeId`, но нет `kind`
 *    — режим назван, а вид (PvP/PvE) сервер не посчитал: имя показывается, значок нет.
 *    Достроить значок самим нельзя: `kind` пуст и когда режим НЕИЗВЕСТЕН серверу, так
 *    что «раз не PvE, значит PvP» — это ровно та ложь, от которой BRW-1 и уводил.
 *
 * Счётчик времени НИКОГДА не печатает отрицательное: просроченное окно — это «вот-вот»,
 * а не «осталось −3ч».
 */

import { t } from '../../localization/runtime';

/** Вкладки обозревателя. */
export type MatchTab = 'available' | 'active' | 'archived';

/** Правила партии в том виде, в каком их отдаёт сервер. */
export interface MatchRules {
  timeScale?: number;
  victory?: { dominationPercent?: number; scoreLimit?: number };
}

/** Часовой «окна нет»: всё, что дальше десятилетия, — бесконечность (правило 2). */
export const ENTRY_UNBOUNDED_MS = 3650 * 24 * 60 * 60 * 1000;

/** Меньше суток реального времени — окно закрывается «скоро» (правило 4). */
export const ENTRY_SOON_MS = 24 * 60 * 60 * 1000;

/** Сводка правил партии: скорость и условия победы, только заданные. */
export function ruleSummary(r: MatchRules): string {
  const parts = [`×${r.timeScale ?? 1}`];
  if (r.victory?.scoreLimit) parts.push(t('browser.goal.score', { n: r.victory.scoreLimit }));
  if (r.victory?.dominationPercent)
    parts.push(t('browser.goal.map', { p: Math.round(r.victory.dominationPercent * 100) }));
  return parts.join(' · ');
}

/** Остаток времени → «Nд Mч» / «Mч» / «вот-вот». Отрицательное не печатается. */
export function fmtJoinWindow(ms: number): string {
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  if (d > 0) return t('browser.left.days', { d, h });
  if (hours > 0) return t('browser.left.hours', { h: hours });
  return t('browser.left.soon');
}

/** Что показать про окно входа: ничего, «вход закрыт» или обратный отсчёт. */
export type JoinWindow =
  | { kind: 'none' }
  | { kind: 'closed' }
  | { kind: 'open'; left: number; soon: boolean };

/** Поля строки, от которых зависит окно входа. */
export interface EntryFields {
  entryOpen?: boolean;
  entryClosesInMs?: number;
}

/** Решить, что строка говорит про окно входа. Разметку строит хозяин. */
export function joinWindow(row: EntryFields, tab: MatchTab): JoinWindow {
  // Правила 1 и 3: не та вкладка либо сервер поля не прислал — строки нет.
  if (tab !== 'available' || row.entryClosesInMs === undefined) return { kind: 'none' };
  if (row.entryOpen === false) return { kind: 'closed' };
  if (row.entryClosesInMs >= ENTRY_UNBOUNDED_MS) return { kind: 'none' };
  return { kind: 'open', left: row.entryClosesInMs, soon: row.entryClosesInMs < ENTRY_SOON_MS };
}

/** Действие второй кнопки строки: убрать в архив, вернуть из него или ничего. */
export type RowAction = 'archive' | 'restore' | null;

/** «Доступные» — чужие матчи, их не архивируют; свои активные прячут, архивные возвращают. */
export function rowAction(tab: MatchTab): RowAction {
  if (tab === 'archived') return 'restore';
  return tab === 'active' ? 'archive' : null;
}

/** Поля строки, от которых зависит подпись режима. Оба необязательны: сервер до BRW-1
 *  их не слал вовсе, а `kind` не считается и на новом сервере без каталога данных. */
export interface ModeFields {
  modeId?: string;
  kind?: 'pvp' | 'pve';
}

/** Что строка говорит про режим. `modeId` отдаётся сырым: имя из него делает `tData()`
 *  у хозяина разметки — здесь решение, а не текст (как у {@link joinWindow}). */
export type ModeLabel = { kind: 'none' } | { kind: 'shown'; modeId: string; badge?: 'pvp' | 'pve' };

/** Решить, что строка говорит про режим партии (правило 5). */
export function modeLabel(row: ModeFields): ModeLabel {
  if (row.modeId === undefined) return { kind: 'none' };
  return row.kind === undefined
    ? { kind: 'shown', modeId: row.modeId }
    : { kind: 'shown', modeId: row.modeId, badge: row.kind };
}
