/**
 * Стопка тостов над картой — сама вставка в DOM (вынесено из `eventFeed.ts`). Пределы,
 * время жизни и вид — `toastView.ts` (REFM-105).
 */
import { jumpToPing } from './mapCamera';
import { TOAST_FADE_MS, TOAST_LIFE_MS, toastClass, toastOverflow, toastText } from './toastView';

/** Transient event toast over the map — feedback must not live only in a hidden
 *  log window. Tap dismisses; with a map anchor the tap also flies the camera
 *  there (the jumpToPing path). At most 3 stacked, ~5s life each. */
export function toast(msg: string, at?: string): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  // Вид, предел стопки и время жизни — `toastView.ts` (REFM-105).
  const el = document.createElement('div');
  el.className = toastClass(!!at);
  el.textContent = toastText(msg, !!at);
  el.addEventListener('click', () => {
    if (at) jumpToPing(at);
    el.remove();
  });
  host.appendChild(el);
  // Считаются и вытесняются только тосты: предупреждение о сохранении стоит над ними.
  // Значок перебежчика (`defectorDialog.ts`) стоит в стопке, но не тост: его не вытесняют.
  const plain = '.toast:not(.defector-pending):not(.aim-hint)';
  for (let extra = toastOverflow(host.querySelectorAll(plain).length); extra > 0; extra--)
    host.querySelector(plain)?.remove();
  window.setTimeout(() => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), TOAST_FADE_MS);
  }, TOAST_LIFE_MS);
}

/** Подсказка взведённого прицела («выберите точку патруля…»). Она нужна, пока игрок
 *  целится, и ни секундой дольше, поэтому живёт не по часам, а до `dropAimHint`; в журнал
 *  событий не пишется: это не событие матча. Новая подсказка сменяет прежнюю. */
export function aimHint(msg: string): void {
  dropAimHint();
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast aim-hint';
  el.textContent = msg;
  host.appendChild(el);
}

/** Прицел исполнен или снят — подсказка уходит сразу. */
export function dropAimHint(): void {
  document.querySelector('#toasts .toast.aim-hint')?.remove();
}
