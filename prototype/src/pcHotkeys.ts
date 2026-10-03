/**
 * Горячие клавиши ПК (UIX-9.1): проводка. Какая клавиша что делает и когда молчит —
 * `decisions/hotkeys.ts`; здесь кнопки, подсказки и памятка.
 *
 * 1. **Клавиша нажимает ту же кнопку, что и мышь.** Окна открывают обработчики кнопок, а не
 *    копия их логики здесь. Нет кнопки в этом режиме (почты и «Производства» в забеге, скорости
 *    без дев-управления временем) — нет и клавиши.
 * 2. **Клавиша видна на кнопке:** значком на вкладках над картой и в раскрытой колонке
 *    инструментов (UIX-9.4), а у «‖» и кнопок скорости, где значку нет места, — в подсказке:
 *    «Пауза (Пробел)», у кнопок скорости — цифра. Раскладка не ПК — значков нет и подсказки
 *    прежние: клавиши там молчат.
 * 3. **Нажатая клавиша подсвечивает свою кнопку** коротким кольцом: видно, что сработало.
 * 4. **Памятка** встаёт при входе в партию на ПК, когда над картой нет слоя выше окон, и гаснет
 *    сама через {@link MEMO_MS}. Встаёт, пока игрок не нажал ни одной клавиши и не закрыл её ✕.
 *    Мышь она не ловит — кроме ✕.
 * 5. **Чей пробел, решает то, как получен фокус** (правило 6 решения). Фокус после нажатия
 *    мышью случайный: клавиша его снимает, иначе браузер обвёл бы кнопку рамкой. Фокус после
 *    Tab'а с клавиатуры клавиша оставляет.
 * 6. **Фокус с клавиатуры виден странице** классом `focus-kbd` у `body`: по нему колонка
 *    инструментов раскрывается подписями, когда до неё дошли Tab'ом (UIX-9.4). Не по
 *    `:focus-visible` — его Chromium ставит кнопке после мыши на первом же нажатии любой
 *    клавиши, и Escape, закрывший окно, раскрывал бы колонку под щёлкнутой кнопкой.
 */
import { t } from '../../localization/runtime';
import { HOTKEYS, SPEED_SLOTS, capOf, hotkeyStep, type HotkeyAction } from '../../decisions/hotkeys';
import { typingTarget } from './backGesture';
import { readBool, writeBool } from './prefs';

/** Сколько памятка стоит на экране. */
export const MEMO_MS = 14_000;
/** Подсветка нажатой кнопки — малый тир отклика. */
const FLASH_MS = 350;
const LEARNED = 'void.keys.learned';

/** Кнопки окон: нажимается первая видимая, подсвечиваются все видимые. Все они — на вкладках
 *  над картой или в колонке инструментов, и клавиша на них — значком (правило 2). */
const BUTTONS: Partial<Record<HotkeyAction, readonly string[]>> = {
  tech: ['rail-tech', 'holo-tech'],
  production: ['rail-constructor', 'holo-constructor'],
  events: ['rail-log'],
  messages: ['rail-msgs'],
  help: ['rail-help'],
};

/** Строки памятки: клавиша и ключ подписи. */
const MEMO: readonly { action: HotkeyAction; label: string }[] = [
  { action: 'tech', label: 'rail.tech.title' },
  { action: 'production', label: 'rail.constructor.label' },
  { action: 'events', label: 'rail.log.label' },
  { action: 'home', label: 'keys.memo.home' },
  { action: 'next-fleet', label: 'keys.memo.next-fleet' },
];

export interface PcHotkeysHost {
  /** ПК-раскладка (`pcUi`). */
  pc(): boolean;
  inMatch(): boolean;
  /** Открыт слой выше окон (`HOTKEY_SILENT_LAYERS`). */
  silentLayer(): boolean;
  /** «‖» сам продолжает с прежним темпом — пауза забега. */
  pauseToggles(): boolean;
  home(): void;
  nextFleet(): void;
}

const byId = (id: string): HTMLElement | null => document.getElementById(id);
/** Кнопка на экране: её не убрали в этом режиме ни она сама, ни её ряд (правило 1). */
const shown = (el: HTMLElement | null | undefined): el is HTMLElement => !!el && el.getClientRects().length > 0;
const capFor = (action: HotkeyAction): string =>
  capOf(HOTKEYS.find((k) => k.action === action)!.codes[0]!, t('key.space'));
const speedChips = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('#speedbar .spd-mult-pc .spdmini')].slice(0, SPEED_SLOTS);

export function initPcHotkeys(host: PcHotkeysHost) {
  // --- подсказки кнопок (правило 2) ---------------------------------------------------------
  const baseTitle = new Map<HTMLElement, string>();
  const titled = (el: HTMLElement | null, cap: string | null): void => {
    if (!el) return;
    if (!baseTitle.has(el)) baseTitle.set(el, el.title);
    const base = baseTitle.get(el)!;
    const next = cap && base ? t('key.hint', { label: base, key: cap }) : base;
    if (el.title !== next) el.title = next;
  };
  const syncHints = (): void => {
    const pc = host.pc();
    for (const [action, ids] of Object.entries(BUTTONS) as [HotkeyAction, readonly string[]][])
      for (const id of ids) {
        const el = byId(id);
        if (!el) continue;
        if (pc) el.dataset.kbd = capFor(action);
        else delete el.dataset.kbd;
      }
    titled(byId('spd-pause'), pc ? capFor('pause') : null);
    speedChips().forEach((chip, i) => titled(chip, pc ? String(i + 1) : null));
  };
  syncHints();
  window.addEventListener('resize', syncHints);

  // --- памятка (правило 4) ------------------------------------------------------------------
  let learned = readBool(LEARNED, false);
  const memo = document.createElement('aside');
  memo.id = 'key-memo';
  memo.hidden = true;
  document.body.appendChild(memo);
  let memoTimer = 0;
  /** Партия, которой памятка ещё не показана: ждёт, пока над картой не останется слоя. */
  let memoDue = false;
  let wasInMatch = false;
  const hideMemo = (): void => {
    window.clearTimeout(memoTimer);
    memo.hidden = true;
  };
  const learn = (): void => {
    memoDue = false;
    hideMemo();
    if (learned) return;
    learned = true;
    writeBool(LEARNED, true);
  };
  const showMemo = (): void => {
    const items = MEMO.filter((m) => !BUTTONS[m.action] || BUTTONS[m.action]!.some((id) => shown(byId(id))))
      .map((m) => `<span><kbd>${capFor(m.action)}</kbd>${t(m.label)}</span>`)
      .join('');
    memo.innerHTML =
      `<b>${t('keys.memo.title')}</b>${items}` +
      `<button type="button" aria-label="${t('keys.memo.close')}">✕</button>`;
    memo.querySelector('button')!.addEventListener('click', learn);
    memo.hidden = false;
    window.clearTimeout(memoTimer);
    memoTimer = window.setTimeout(hideMemo, MEMO_MS);
  };

  // --- нажатия ------------------------------------------------------------------------------
  /** Откуда пришёл последний ввод и чем получен текущий фокус (правила 5 и 6). */
  let lastInput: 'pointer' | 'keyboard' = 'pointer';
  let focusFromKeyboard = false;
  document.addEventListener('pointerdown', () => (lastInput = 'pointer'), true);
  document.addEventListener(
    'focusin',
    () => {
      focusFromKeyboard = lastInput === 'keyboard';
      document.body.classList.toggle('focus-kbd', focusFromKeyboard);
    },
    true,
  );
  /** Элемент в фокусе, кроме страницы и самой карты. */
  const focused = (): HTMLElement | null => {
    const el = document.activeElement;
    return el instanceof HTMLElement && el !== document.body && el.id !== 'map' ? el : null;
  };

  const flash = (el: HTMLElement): void => {
    el.animate?.(
      [{ boxShadow: '0 0 0 2px var(--cyan,#8ce9f2), 0 0 16px rgba(140,233,242,.55)' }, { boxShadow: 'none' }],
      { duration: FLASH_MS, easing: 'ease-out' },
    );
  };
  const press = (el: HTMLElement | null | undefined): void => {
    if (!shown(el)) return;
    el.click();
    flash(el);
  };

  const act = (action: HotkeyAction, slot: number): void => {
    switch (action) {
      case 'home':
        return host.home();
      case 'next-fleet':
        return host.nextFleet();
      case 'pause': {
        // «‖» на паузе ставит паузу ещё раз, поэтому продолжает «▶»; у забега «‖» продолжает
        // сам — и с тем темпом, каким шёл забег.
        const pause = byId('spd-pause');
        const paused = pause?.classList.contains('on') === true;
        return press(!paused || host.pauseToggles() ? pause : byId('spd-play'));
      }
      case 'speed':
        return press(speedChips()[slot]);
      default: {
        // Вкладка над картой и кнопка рельсы открывают одно окно: жмём одну, светим обе.
        const buttons = (BUTTONS[action] ?? []).map(byId).filter(shown);
        buttons[0]?.click();
        buttons.forEach(flash);
      }
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const el = focused();
    const typing =
      !!el && (typingTarget(el.tagName, el.isContentEditable) || el.tagName === 'SELECT' || !!el.closest('#chatwin'));
    const time = byId('spd-ctl');
    const step = hotkeyStep(
      { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey, repeat: e.repeat },
      {
        pc: host.pc(),
        inMatch: host.inMatch(),
        typing,
        silentLayer: host.silentLayer(),
        keyboardFocus: !!el && focusFromKeyboard,
        timeShown: shown(time),
      },
    );
    if (step.do === 'pass') {
      lastInput = 'keyboard';
      return;
    }
    e.preventDefault();
    if (step.do === 'swallow') return;
    if (el && !focusFromKeyboard) el.blur();
    act(step.hotkey.action, step.slot);
    learn();
  });

  return {
    /** Кадр: вход в партию ставит памятку в очередь, выход убирает её. */
    sync(): void {
      const match = host.inMatch() && host.pc();
      if (match && !wasInMatch) memoDue = !learned;
      if (!match) {
        memoDue = false;
        if (!memo.hidden) hideMemo();
      } else if (memoDue && !host.silentLayer()) {
        memoDue = false;
        showMemo();
      }
      wasInMatch = match;
    },
  };
}
