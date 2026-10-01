/**
 * Шапка мест на экране «Настройка схватки» (UIX-15.1 + первая половина UIX-8.2).
 *
 * Над строками мест — сколько соперников и одна строка правила кнопки; подробности о
 * слабом и сильном боте раскрываются под «?». Раньше это была инструкция в восемь строк
 * над картой, и она повторяла подсказки карты и самих строк.
 */
import { t } from '../../localization/runtime';

export function setupRivalsHtml(rivals: number, helpOpen: boolean): string {
  return (
    `<div class="srivals"><div><b>${t('setup.rivals', { n: rivals })}</b>` +
    `<span>${t('setup.rivals.hint')}</span></div>` +
    `<button type="button" data-setuphelp="1" aria-expanded="${helpOpen}" aria-label="${t('setup.rivals.help.aria')}">?</button></div>` +
    (helpOpen ? `<p class="shelp">${t('setup.rivals.help')}</p>` : '')
  );
}
