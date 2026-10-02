/**
 * Горячие клавиши ПК (UIX-9.1): какая клавиша что делает и когда она молчит.
 *
 * Проводка — нажатие кнопок, подсказки и памятка — в `prototype/src/pcHotkeys.ts`; для игрока
 * клавиши описаны строками раздела «Управление» (`controls.ts`), и сторож `controls.test.ts`
 * требует каждой строке подтверждение в этой таблице.
 *
 * 1. **Клавиша — место на клавиатуре, а не буква.** Читается `KeyboardEvent.code`: в русской
 *    раскладке на месте T стоит «Е», и по `key` клавиши молчали бы у каждого, кто не
 *    переключил раскладку.
 * 2. **Только ПК и только в партии.** Клавиши нажимают кнопки ПК-раскладки (рельсу, скорости
 *    ×1…×7200), а вне партии нажимать нечего.
 * 3. **В поле ввода и в чате клавиш нет:** там буква — это буква.
 * 4. **С Ctrl, Alt или ⌘ клавиш нет:** это сочетания браузера и системы (Ctrl+T — новая
 *    вкладка).
 * 5. **Над слоем выше окон клавиши молчат** ({@link HOTKEY_SILENT_LAYERS}: комикс, вводная,
 *    настройки, карточка игрока, дипломатия, подтверждения): окно, открытое клавишей, встало
 *    бы под таким слоем, а пауза и выбор флота сработали бы вслепую.
 * 6. **Пробел и Tab уступают навигации с клавиатуры.** Кнопку, до которой игрок дошёл Tab'ом,
 *    пробел нажимает, а Tab ведёт дальше. У кнопки, нажатой мышью, фокус случайный: там
 *    пробел — пауза, а Tab — флот. Shift+Tab всегда остаётся браузеру: им с карты попадают в
 *    навигацию.
 * 7. **Пробел и 1–4 — только при видимом управлении временем.** Клавиша не делает того, чего
 *    нельзя сделать кнопкой: в сети временем распоряжается сервер.
 * 8. **Зажатая клавиша срабатывает один раз.** Автоповтор дёргал бы паузу и открывал окно
 *    снова и снова; повтор глотается, чтобы и браузер его не исполнил.
 * 9. **Tab перебирает флоты, которыми можно командовать:** свои, живые и способные двигаться.
 *    Орудия крепости, мины и гарнизон стоят на месте, а выбор вражеского флота Tab'ом увёл бы
 *    камеру к чужим. Порядок — по id с числами по значению (`fleet:2` раньше `fleet:10`), по
 *    кругу от выбранного.
 * 10. **«К столице» ведёт к столице, пока она твоя.** Потерянная — уже не дом: тогда камера
 *     идёт туда же, куда стартовый вид (`pickHome`), а без своих миров клавиша молчит.
 */

/** Что делает клавиша. */
export type HotkeyAction =
  | 'pause'
  | 'speed'
  | 'next-fleet'
  | 'home'
  | 'tech'
  | 'production'
  | 'events'
  | 'messages'
  | 'help';

export interface Hotkey {
  /** Строка раздела «Управление» (`controls.ts`), где клавиша описана для игрока. */
  readonly id: string;
  readonly action: HotkeyAction;
  /** Места клавиш (`KeyboardEvent.code`, правило 1). Первое печатается на подсказке. */
  readonly codes: readonly string[];
}

/** Порядок — как в разделе «Управление». */
export const HOTKEYS: readonly Hotkey[] = [
  { id: 'key-pause', action: 'pause', codes: ['Space'] },
  {
    id: 'key-speed',
    action: 'speed',
    codes: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'],
  },
  { id: 'key-next-fleet', action: 'next-fleet', codes: ['Tab'] },
  { id: 'key-home', action: 'home', codes: ['KeyH', 'Home'] },
  { id: 'key-tech', action: 'tech', codes: ['KeyT'] },
  { id: 'key-production', action: 'production', codes: ['KeyB'] },
  { id: 'key-events', action: 'events', codes: ['KeyL'] },
  { id: 'key-messages', action: 'messages', codes: ['KeyM'] },
  { id: 'key-help', action: 'help', codes: ['F1'] },
];

/** Сколько кнопок скорости у клавиш 1–4. */
export const SPEED_SLOTS = 4;

/**
 * Слои выше окон (правило 5) — ступени лестницы «Назад» (`BACK_LAYERS` в
 * `prototype/src/main.ts`) от комикса до подтверждений, в её порядке. Сторож
 * (`hotkeys.test.ts`) сверяет список с лестницей: новая ступень выше окон без решения о
 * клавишах уронит его.
 */
export const HOTKEY_SILENT_LAYERS: readonly string[] = [
  'comic',
  'maploading',
  'intro',
  'solo-replace',
  'corp',
  'scipick',
  'emblempick',
  'swarm-dossier',
  'settings',
  'sector-zero',
  'testmode',
  'sandbox',
  'seatpick',
  'recap',
  'profile',
  'rescard',
  'spotlight',
  'playercard',
  'diplo',
  'warprompt',
  'abandon',
];

/** Нажатие — те поля `KeyboardEvent`, которые что-то решают. */
export interface KeyPress {
  readonly code: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  /** Автоповтор зажатой клавиши (правило 8). */
  readonly repeat: boolean;
}

/** Обстановка в момент нажатия. */
export interface HotkeyScene {
  /** ПК-раскладка (правило 2). */
  readonly pc: boolean;
  /** Идёт партия (правило 2). */
  readonly inMatch: boolean;
  /** Фокус в поле ввода или в чате (правило 3). */
  readonly typing: boolean;
  /** Открыт слой выше окон (правило 5). */
  readonly silentLayer: boolean;
  /** Фокус у элемента, до которого дошли с клавиатуры (правило 6). */
  readonly keyboardFocus: boolean;
  /** Управление временем на экране (правило 7). */
  readonly timeShown: boolean;
}

/**
 * Судьба нажатия: `pass` — не наше, браузер делает своё; `swallow` — наше, но без действия
 * (правило 8); `act` — действие. `slot` — номер кнопки скорости у клавиш 1–4, у остальных 0.
 */
export type HotkeyStep =
  | { readonly do: 'pass' }
  | { readonly do: 'swallow' }
  | { readonly do: 'act'; readonly hotkey: Hotkey; readonly slot: number };

const PASS: HotkeyStep = { do: 'pass' };

/** Клавиша этого места или `undefined`. */
export function hotkeyOf(code: string): Hotkey | undefined {
  return HOTKEYS.find((k) => k.codes.includes(code));
}

/** Что сделать с нажатием (правила 2–8). */
export function hotkeyStep(press: KeyPress, scene: HotkeyScene): HotkeyStep {
  if (!scene.pc || !scene.inMatch || scene.typing) return PASS;
  if (press.ctrl || press.alt || press.meta) return PASS;
  const hotkey = hotkeyOf(press.code);
  if (!hotkey || scene.silentLayer) return PASS;
  if (hotkey.action === 'next-fleet' && press.shift) return PASS;
  if ((hotkey.action === 'pause' || hotkey.action === 'next-fleet') && scene.keyboardFocus) return PASS;
  if ((hotkey.action === 'pause' || hotkey.action === 'speed') && !scene.timeShown) return PASS;
  if (press.repeat) return { do: 'swallow' };
  const slot = hotkey.action === 'speed' ? hotkey.codes.indexOf(press.code) % SPEED_SLOTS : 0;
  return { do: 'act', hotkey, slot };
}

/** Надпись клавиши для подсказки: «T», «F1», «Home», «1»; пробел — словом `space` из локали. */
export function capOf(code: string, space: string): string {
  return code === 'Space' ? space : code.replace(/^(Key|Digit|Numpad)/, '');
}

/** Флот так, как его различает перебор Tab'ом. */
export interface CycledFleet {
  readonly id: string;
  readonly owner: string;
  readonly units: readonly { readonly unit: string; readonly count: number }[];
}

const byId = new Intl.Collator('en', { numeric: true }).compare;

/** Флоты, которые перебирает Tab (правило 9), — в порядке перебора. */
export function cycledFleets(
  fleets: readonly CycledFleet[],
  me: string,
  immobile: (unit: string) => boolean,
): string[] {
  return fleets
    .filter((f) => {
      const live = f.units.filter((u) => u.count > 0);
      return f.owner === me && live.length > 0 && !live.some((u) => immobile(u.unit));
    })
    .map((f) => f.id)
    .sort(byId);
}

/** Следующий флот по кругу после выбранного; выбран чужой или никакой — первый (правило 9). */
export function nextFleet(order: readonly string[], current: string | null): string | null {
  if (!order.length) return null;
  const at = current === null ? -1 : order.indexOf(current);
  return order[(at + 1) % order.length]!;
}

/** Куда ведёт «к столице» (правило 10): `fallback` — дом стартового вида или `null`. */
export function homeTarget(
  capital: string | undefined,
  ownerOf: (world: string) => string | null | undefined,
  me: string,
  fallback: string | null,
): string | null {
  return capital !== undefined && ownerOf(capital) === me ? capital : fallback;
}
