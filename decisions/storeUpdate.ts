/**
 * Обновление приложения через МАГАЗИН (RUS-3) — шаги по нажатиям игрока и ответам моста.
 *
 * Сторовая сборка обновляется не из GitHub-релиза, а через SDK магазина: тот сам знает,
 * есть ли новая версия, сам её скачивает и сам ставит. Нативный мост (`mobile/patch-
 * rustore.mjs`) переводит SDK в три вызова и поток событий, а здесь решается, ЧТО из
 * этого видит игрок и КОГДА уходит следующий вызов. Имени магазина в модуле нет нарочно:
 * у «проверить → скачать по согласию → перезапустить» одна форма у любого магазина с
 * отложенным обновлением, и второй магазин встанет сюда без правки решения.
 *
 * 1. **Скачивание — только по нажатию «Обновить».** Проверка молчаливая; диалог магазина
 *    открывается после нажатия, а не сам. Иначе проверка при возврате в игру открыла бы
 *    его посреди боя (RUS-3: «не во время критического игрового действия»).
 * 2. **Перезапуск — отдельное нажатие после скачивания.** Установка закрывает приложение,
 *    поэтому хост сохраняет всё ДО вызова `completeUpdate`, и этот момент выбирает игрок.
 * 3. **Сбой — это покой, а не поломка.** Нет магазина на телефоне, игрок не вошёл в него,
 *    приложение поставлено не из магазина — мост отвечает ошибкой, и решение молча
 *    возвращается в покой: баннера нет, игра идёт. Ошибка ПЕРЕЗАПУСКА скачанное не
 *    теряет: оно остаётся готовым, но без навязчивого баннера до следующей проверки.
 * 4. **Один вызов в полёте.** Пока диалог магазина открыт или идёт установка, повторное
 *    нажатие не шлёт второй вызов: двойной тап не открывает два диалога.
 * 5. **«Позже» прячет баннер, но не обновление.** Следующий результат проверки покажет
 *    его снова; скачанное обновление не проверяется заново — его предлагают поставить.
 * 6. **Событие вне своего шага ничего не двигает**, а разбор строгий: незнакомая форма —
 *    `null`, а не догадка. Мост наш, но граница с нативным кодом — всё равно граница.
 */

/** Что мост магазина сообщил веб-слою. */
export type StoreUpdateEvent =
  | { type: 'check'; available: boolean }
  /** Диалог магазина закрылся: игрок согласился скачать или отказался. */
  | { type: 'flow'; accepted: boolean }
  | { type: 'install'; status: StoreInstallStatus }
  /** Вызов не удался. Подробности остаются в логе устройства (fail-secure). */
  | { type: 'error'; op: StoreUpdateOp };

export type StoreInstallStatus = 'downloading' | 'downloaded' | 'failed' | 'other';
export type StoreUpdateOp = 'check' | 'start' | 'complete';

/** Что попросил игрок (`start`, `later`, `restart`) или хост (`check`). */
export type StoreUpdateIntent = 'check' | 'start' | 'later' | 'restart';

export type StoreUpdatePhase =
  | 'idle'
  | 'checking'
  /** Обновление есть, предлагаем скачать. */
  | 'offer'
  /** Открыт диалог магазина. */
  | 'starting'
  | 'downloading'
  /** Скачано, предлагаем перезапустить. */
  | 'ready'
  | 'installing';

export interface StoreUpdateState {
  phase: StoreUpdatePhase;
  /** Игрок нажал «Позже» (или отказался в диалоге магазина) — баннер спрятан. */
  dismissed: boolean;
}

export const initialStoreUpdate: StoreUpdateState = { phase: 'idle', dismissed: false };

/** Вызов моста, который хост делает после шага. */
export type StoreUpdateCall = 'checkUpdate' | 'startUpdate' | 'completeUpdate';

export interface StoreUpdateStep {
  state: StoreUpdateState;
  call: StoreUpdateCall | null;
}

const stay = (state: StoreUpdateState): StoreUpdateStep => ({ state, call: null });

/** Шаг по нажатию игрока или по графику проверок хоста. */
export function storeUpdateIntent(s: StoreUpdateState, intent: StoreUpdateIntent): StoreUpdateStep {
  switch (intent) {
    case 'check':
      // Скачанное заново не проверяют — снова предлагают поставить (правило 5).
      if (s.phase === 'ready') return stay({ ...s, dismissed: false });
      // Повторная проверка поверх незавершённой безопасна, а без неё один потерянный
      // ответ моста запер бы обновления до конца сессии. Диалог, скачивание и установку
      // она не перебивает (правило 4).
      if (s.phase === 'idle' || s.phase === 'offer' || s.phase === 'checking')
        return { state: { phase: 'checking', dismissed: s.dismissed }, call: 'checkUpdate' };
      return stay(s);
    case 'start':
      return s.phase === 'offer' && !s.dismissed
        ? { state: { phase: 'starting', dismissed: false }, call: 'startUpdate' }
        : stay(s);
    case 'restart':
      return s.phase === 'ready' && !s.dismissed
        ? { state: { phase: 'installing', dismissed: false }, call: 'completeUpdate' }
        : stay(s);
    case 'later':
      return stay({ ...s, dismissed: true });
  }
}

/** Шаг по событию моста. */
export function storeUpdateEvent(s: StoreUpdateState, e: StoreUpdateEvent): StoreUpdateState {
  switch (e.type) {
    case 'check':
      if (s.phase === 'checking')
        return e.available ? { phase: 'offer', dismissed: false } : initialStoreUpdate;
      // Мост, открывая диалог, проверяет ещё раз: обновление могли уже поставить.
      if (s.phase === 'starting' && !e.available) return initialStoreUpdate;
      return s;
    case 'flow':
      if (s.phase !== 'starting') return s;
      // Отказ в диалоге магазина — то же «Позже»: обновление никуда не делось.
      return e.accepted
        ? { phase: 'downloading', dismissed: false }
        : { phase: 'offer', dismissed: true };
    case 'install':
      if (e.status === 'downloaded')
        return s.phase === 'ready' || s.phase === 'installing'
          ? s
          : { phase: 'ready', dismissed: false };
      if (e.status === 'downloading' && s.phase === 'starting')
        return { phase: 'downloading', dismissed: false };
      if (e.status === 'failed' && (s.phase === 'starting' || s.phase === 'downloading'))
        return initialStoreUpdate;
      return s;
    case 'error':
      if (e.op === 'check' && s.phase === 'checking') return initialStoreUpdate;
      if (e.op === 'start' && (s.phase === 'starting' || s.phase === 'downloading'))
        return initialStoreUpdate;
      // Скачанное не теряется, но и не навязывается снова сразу же (правило 3).
      if (e.op === 'complete' && s.phase === 'installing')
        return { phase: 'ready', dismissed: true };
      return s;
  }
}

/** Какой баннер показать: предложение скачать, предложение перезапустить или никакого. */
export function storeUpdateBanner(s: StoreUpdateState): 'offer' | 'ready' | null {
  if (s.dismissed) return null;
  if (s.phase === 'offer') return 'offer';
  if (s.phase === 'ready') return 'ready';
  return null;
}

const INSTALL_STATUSES: readonly StoreInstallStatus[] = [
  'downloading',
  'downloaded',
  'failed',
  'other',
];
const OPS: readonly StoreUpdateOp[] = ['check', 'start', 'complete'];

/** Строгий разбор события моста (правило 6). */
export function parseStoreUpdateEvent(raw: unknown): StoreUpdateEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case 'check':
      return typeof r.available === 'boolean' ? { type: 'check', available: r.available } : null;
    case 'flow':
      return typeof r.accepted === 'boolean' ? { type: 'flow', accepted: r.accepted } : null;
    case 'install': {
      const status = INSTALL_STATUSES.find((x) => x === r.status);
      return status ? { type: 'install', status } : null;
    }
    case 'error': {
      const op = OPS.find((x) => x === r.op);
      return op ? { type: 'error', op } : null;
    }
    default:
      return null;
  }
}
