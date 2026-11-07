/**
 * Меню «Шпионаж» в ряду действий мира (UIX-10.11, вопрос владельца 2026-11-07: «Приказы шпионов
 * не упакованы в отдельную менюшку?»). Приказы рисует карточка мира (`worldCard.ts`), здесь
 * только упаковка и память о раскрытии.
 */
import { t } from '../../localization/runtime';
import { esc } from './format';

/** Мир, у которого раскрыто меню «Шпионаж» (UIX-10.11); раскрытие помнится, пока его не свернут. */
let spyMenuOpen: string | null = null;

/** Раскрыть или свернуть меню «Шпионаж» у мира. */
export function toggleSpyMenu(planetId: string): void {
  spyMenuOpen = spyMenuOpen === planetId ? null : planetId;
}

/** Приказы шпионов в ряду действий: один — как есть (свой мир: «Контрразведка»), больше —
 *  под кнопкой «Шпионаж», а раскрытые идут блоком на всю ширину ряда (UIX-10.11). */
export function spyMenuHtml(planetId: string, ops: string[]): string[] {
  if (ops.length < 2) return ops;
  const open = spyMenuOpen === planetId;
  const toggle =
    `<button class="b btn-second${open ? ' on' : ''}" data-act="spymenu" data-arg="${esc(planetId)}" ` +
    `aria-expanded="${open}">${t('side.world.spy-menu')} ${open ? '▾' : '▸'}</button>`;
  return open ? [toggle, `<div class="spy-menu">${ops.join('')}</div>`] : [toggle];
}
