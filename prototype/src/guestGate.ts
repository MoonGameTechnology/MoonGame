/**
 * «Нужен аккаунт» на вкладках хаба, которые живут на аккаунте (друзья, рейтинг, снабжение).
 *
 * Одна разметка на все такие вкладки и кнопка «Войти», когда сервер с аккаунтами её
 * принимает — как у магазина, арсенала и корпорации. Раньше эти три вкладки называли
 * причину, но не давали выхода: игрок читал «войдите» и не находил куда (аудит интерфейса
 * 2026-11-20).
 */
import { t } from '../../localization/runtime';
import { esc } from './format';

/** Пустое состояние гостя: значок, заголовок, одна фраза и «Войти», если можно войти. */
export function guestGateHtml(icon: string, body: string, canSignIn: boolean): string {
  return (
    `<div class="hub-empty"><span class="he-ic">${icon}</span>${esc(t('hub.guest.title'))}<br>` +
    `<span class="he-sub">${esc(body)}</span>` +
    (canSignIn
      ? `<br><button type="button" class="btn-main he-signin" data-guest-signin>${esc(t('hub.guest.sign-in'))}</button>`
      : '') +
    '</div>'
  );
}

/** Нажатие «Войти» внутри `root` ведёт на страницу входа. Вешается один раз на корень. */
export function bindGuestSignIn(root: HTMLElement, signIn: () => void): void {
  root.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest?.('[data-guest-signin]')) signIn();
  });
}
