/**
 * Раздел «Ждёт решения» над журналом окна «События» (UIX-4.2). Какие пункты и в каком
 * порядке — `decisions/pendingDecisions.ts`; здесь только разметка: строка пункта и кнопка
 * «Показать» с адресом перехода в `data-*`. Нажатие разбирает `main.ts`: бой открывает
 * окно боя и ведёт камеру к его миру, письма — вкладку сообщений.
 */
import { t } from '../../localization/runtime';
import type { PendingItem } from '../../decisions/pendingDecisions';
import { esc } from './format';

/** Разметка раздела; пунктов нет — пустая строка (правило 4 решения). */
export function pendingHtml(
  items: readonly PendingItem[],
  placeName: (id: string) => string,
): string {
  if (items.length === 0) return '';
  const rows = items.map((it) => {
    const text =
      it.kind === 'battle'
        ? t(it.mine ? 'win.log.pending.battle-mine' : 'win.log.pending.battle-seen', {
            place: placeName(it.location),
          })
        : t('win.log.pending.letters', { n: it.count });
    const addr =
      it.kind === 'battle'
        ? `data-pending="battle" data-id="${esc(it.id)}" data-loc="${esc(it.location)}"`
        : 'data-pending="letters"';
    return (
      `<div class="lw-pend-row"><span>${esc(text)}</span>` +
      `<button type="button" class="btn-second lw-pend-show" ${addr}>${esc(t('win.log.pending.show'))}</button></div>`
    );
  });
  return `<div class="lw-pend-title">${esc(t('win.log.pending.title'))}</div>${rows.join('')}`;
}
