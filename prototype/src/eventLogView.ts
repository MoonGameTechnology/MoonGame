/**
 * Разметка журнала окна «События» (UIX-10.9): свежие записи сверху, день назван один раз — у
 * первой записи своего дня, у остальных только время суток (`decisions/logDays.ts`). У записи
 * с местом — кнопка ⌖, ведущая камеру туда.
 */
import { t } from '../../localization/runtime';
import { logByDay } from '../../decisions/logDays';
import { clockHM, esc, gameDay, gameStamp } from './format';

/** Запись журнала: игровое время, текст и узел карты, к которому её кнопка ⌖ ведёт камеру.
 *  Узла нет — нет и кнопки. */
export interface LogEntry {
  time: number;
  msg: string;
  at?: string;
}

export function eventLogHtml(entries: readonly LogEntry[]): string {
  const pingTitle = esc(t('win.log.ping'));
  const row = (l: LogEntry, i: number): string =>
    `<div class="lg-row"><span><time class="lg-hm">${esc(i === 0 ? gameStamp(l.time) : clockHM(l.time))}</time> ${esc(l.msg)}</span>` +
    (l.at
      ? `<button type="button" class="lg-ping" data-ping="${esc(l.at)}" title="${pingTitle}" aria-label="${pingTitle}">⌖</button>`
      : '') +
    `</div>`;
  return logByDay(entries, (l) => gameDay(l.time))
    .map((g) => g.rows.map(row).join(''))
    .join('');
}
