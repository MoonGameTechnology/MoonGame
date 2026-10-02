/**
 * «+N» у плашек ресурсов (UIX-4.1): разметка. Какое число и когда — `decisions/purseDelta.ts`.
 *
 * Число всплывает под плашкой и гаснет за {@link PURSE_FLOAT_MS}, плашка коротко вспыхивает
 * цветом знака — малый тир скилла `mobile-game-feel`: вспышка 200 мс, без звука.
 *
 * Число живёт в `body`, а не в плашке: плашку перерисовывает `patchPurse`, и её
 * `overflow:hidden` обрезал бы число. Вспышка — анимация самого узла (`animate`), а не класс:
 * класс `patchPurse` снял бы при первом же обновлении цифр. При выключенном движении
 * (`motionOn`) число не уплывает вниз, а гаснет на месте — класс `still`, стили в `build.mjs`.
 */
import { PURSE_FLOAT_MS, purseStep, type PurseReading, type PurseTrack } from '../../decisions/purseDelta';
import { kfmt } from './format';
import { motionOn } from './graphicsPrefs';

/** Вспышка плашки — малый тир: не дольше 200 мс. */
const CHIP_FLASH_MS = 200;
/** Цвета знака — те же, что у строки скорости (`--grn`, `--red`). */
const CHIP_FLASH = { up: 'rgba(95,240,168,.3)', dn: 'rgba(255,90,77,.3)' } as const;

export function initPurseFloats(purse: HTMLElement) {
  let memory: Record<string, PurseTrack> = {};

  const show = (key: string, delta: number): void => {
    const chip = purse.querySelector<HTMLElement>(`.res[data-res="${key}"]`);
    const box = chip?.getBoundingClientRect();
    if (!chip || !box?.width) return;
    const sign = delta > 0 ? 'up' : 'dn';
    const el = document.createElement('span');
    el.className = `purse-float ${sign}${motionOn() ? '' : ' still'}`;
    el.setAttribute('aria-hidden', 'true');
    el.textContent = `${delta > 0 ? '+' : ''}${kfmt(delta)}`;
    el.style.left = `${Math.round(box.left + box.width / 2)}px`;
    el.style.top = `${Math.round(box.bottom - 4)}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), PURSE_FLOAT_MS);
    chip.animate?.([{ backgroundColor: CHIP_FLASH[sign] }, { backgroundColor: 'transparent' }], {
      duration: CHIP_FLASH_MS,
      easing: 'ease-out',
    });
  };

  return {
    /**
     * Кадр. `active` — идёт партия: вне её память сбрасывается, и следующий вход снова
     * начинается с отсчёта. `readings` — показанные плашки, `worldTime` и `now` — время мира
     * и экрана, мс.
     */
    watch(active: boolean, readings: Record<string, PurseReading>, worldTime: number, now: number): void {
      if (!active) {
        memory = {};
        return;
      }
      const step = purseStep(memory, readings, worldTime, now);
      memory = step.memory;
      for (const f of step.floats) show(f.key, f.delta);
    },
  };
}
