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
  const plain = '.toast:not(.defector-pending)';
  for (let extra = toastOverflow(host.querySelectorAll(plain).length); extra > 0; extra--)
    host.querySelector(plain)?.remove();
  window.setTimeout(() => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), TOAST_FADE_MS);
  }, TOAST_LIFE_MS);
}
