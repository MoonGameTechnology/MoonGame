/**
 * REFM-16 — клиентские настройки: ОДНО правило чтения и записи.
 *
 * Настройка клиента — это `localStorage` плюс два правила, которые до сих пор
 * переписывались от руки в каждой точке (в `main.ts` — восемь раз, в `sound.ts` — ещё
 * дважды):
 *
 *  · **отсутствие ключа ≠ выключено.** Ключа нет → берётся значение по умолчанию, и оно
 *    у разных настроек РАЗНОЕ. Ручная форма прятала это в самом сравнении: `!== '0'`
 *    значило «по умолчанию вкл», `=== '1'` — «по умолчанию выкл». Прочитать умысел можно
 *    было только по знаку сравнения, а перепутать — молча.
 *  · **запись не имеет права уронить UI.** В приватном режиме / при полном хранилище
 *    `setItem` бросает. Восемь копий одного `try/catch` — это восемь мест, где его можно
 *    забыть, и один такой пропуск здесь уже был: `setSideColors` писал три ключа без
 *    защиты, то есть смена цвета стороны в приватном окне падала исключением.
 *
 * Хранилище приходит параметром (по умолчанию — окружающее), потому что модуль обязан
 * работать и там, где его нет: Node в тестах, WebView с отключёнными cookies (там сам
 * ДОСТУП к `localStorage` бросает, не только запись). Нет хранилища — настройка живёт в
 * памяти вызывающего и просто не переживает перезагрузку.
 */

/** То, что нужно от хранилища. Ровно два метода — так его подменяет тест. */
export type PrefStore = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Окружающее хранилище или `null`, если его нет. Доступ обёрнут: в браузере с
 * запрещёнными cookies обращение к `localStorage` само по себе бросает.
 */
export function prefStore(): PrefStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Сырое значение ключа, или `null` — ключа нет / хранилище недоступно. */
export function readRaw(key: string, store: PrefStore | null = prefStore()): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Записать значение. Провал записи — не ошибка приложения: настройка остаётся в памяти
 * вызывающего, просто не переживёт перезагрузку.
 */
export function writeRaw(key: string, value: string, store: PrefStore | null = prefStore()): void {
  try {
    store?.setItem(key, value);
  } catch {
    /* приватный режим / хранилище полно — значение уже применено в памяти */
  }
}

/**
 * Переключатель. `'1'` и `'0'` — единственные значимые значения; всё остальное (ключа
 * нет, хранилища нет, кто-то положил мусор) читается как `fallback`. Значение по
 * умолчанию стоит АРГУМЕНТОМ, а не прячется в знаке сравнения.
 */
export function readBool(
  key: string,
  fallback: boolean,
  store: PrefStore | null = prefStore(),
): boolean {
  const raw = readRaw(key, store);
  return raw === '1' ? true : raw === '0' ? false : fallback;
}

/** Записать переключатель в той же форме, в какой его читает {@link readBool}. */
export function writeBool(
  key: string,
  value: boolean,
  store: PrefStore | null = prefStore(),
): void {
  writeRaw(key, value ? '1' : '0', store);
}

/**
 * Число в диапазоне `[min, max]`. За диапазоном и на нечисле — `fallback`.
 *
 * ЛОВУШКА, ради которой тут явная проверка на `null`: `Number(null) === 0`, а не `NaN`.
 * Без неё отсутствующий ключ давал бы честный ноль — то есть громкость 0 или полностью
 * погашенный радар на каждом чистом профиле.
 */
export function readNum(
  key: string,
  fallback: number,
  min: number,
  max: number,
  store: PrefStore | null = prefStore(),
): number {
  const raw = readRaw(key, store);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
