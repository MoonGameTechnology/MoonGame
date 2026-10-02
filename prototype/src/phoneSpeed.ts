/**
 * Скорость на телефоне — одна кнопка над нижней панелью (UIX-3.2): разметка и нажатия.
 *
 * Что написано на кнопке, решает `decisions/phoneSpeed.ts`. Ряд, который она раскрывает, —
 * та же полоса скорости `#speedbar`: её кнопки, обработчики и правила (пауза забега,
 * множители, дев-темп) прежние, телефон лишь прячет её за кнопкой — класс
 * `phone-speed-open` на `body`, стили в `mobile-console.css`.
 */
import { t } from '../../localization/runtime';
import { speedFace, type Tempo } from '../../decisions/phoneSpeed';

export function initPhoneSpeed() {
  const body = document.body;
  const bar = document.getElementById('speedbar');
  const button = document.createElement('button');
  button.id = 'phone-speed';
  button.type = 'button';
  button.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'speedbar');
  body.appendChild(button);
  let shownText = '';

  const isOpen = (): boolean => body.classList.contains('phone-speed-open');
  const setOpen = (open: boolean): void => {
    if (open === isOpen()) return;
    body.classList.toggle('phone-speed-open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => setOpen(!isOpen()));
  // Выбор скорости сворачивает ряд обратно в кнопку.
  bar?.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest('button')) setOpen(false);
  });
  // Нажатие мимо ряда — тоже: ряд всплывает на время выбора, а не стоит панелью. Само
  // нажатие идёт дальше, к своей цели.
  document.addEventListener(
    'pointerdown',
    (ev) => {
      const target = ev.target as Node;
      if (isOpen() && !button.contains(target) && !bar?.contains(target)) setOpen(false);
    },
    true,
  );

  return {
    /** Кадр: есть ли кнопка (телефон, партия, управление временем) и что на ней. */
    sync(on: boolean, tempo: Tempo | null, mult: number | null): void {
      if (button.hidden === on) button.hidden = !on;
      if (!on) {
        setOpen(false);
        return;
      }
      const face = speedFace(tempo, mult);
      const text = `${face.glyph} ${face.paused ? t('hud.run.pause') : face.mult}`.trim();
      if (text === shownText) return;
      shownText = text;
      button.textContent = text;
      button.setAttribute('aria-label', `${t('speed.toggle')}: ${text}`);
    },
    /** Раскрыт ли ряд — ступень лестницы «Назад». */
    isOpen,
    close: (): void => setOpen(false),
  };
}
