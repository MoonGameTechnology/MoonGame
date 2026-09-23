/**
 * Локальный бэкенд сохранения забега (PVR-0.3) — `localStorage` за общим интерфейсом
 * `RunSaveStore` (`/decisions/runSave.ts`).
 *
 * Здесь ровно то, чего нет в решении: доступ к браузерному хранилищу и его капризы.
 * Правила те же, что у `prefs.ts` (REFM-16) и по той же причине — их уже приходилось
 * переписывать от руки в каждой точке:
 *
 *  · сам ДОСТУП к `localStorage` бросает в WebView с запрещёнными cookies, поэтому он
 *    обёрнут, а не только запись;
 *  · провал записи — НЕ ошибка забега: приватный режим и полное хранилище это норма
 *    жизни, игра продолжается в памяти и просто не переживёт перезагрузку.
 *
 * Промисы здесь всегда исполненные — асинхронность принадлежит ИНТЕРФЕЙСУ, а не этому
 * бэкенду: у площадки сохранение асинхронно по API, и синхронный интерфейс пришлось бы
 * ломать при её подстановке.
 */
import type { RunSaveStore } from '../../decisions/runSave';

/** Ключ снимка. Один на устройство: забег у игрока одновременно один. */
export const RUN_SAVE_KEY = 'void.run.v1';
/** Дескриптор забега (`YAG-2.1`) — рядом с полным снимком, под своим ключом. */
export const PORTABLE_RUN_KEY = 'void.run.portable.v1';

/** Хранилище или `null` — его нет либо доступ к нему запрещён. */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Бэкенд поверх `localStorage`. Хранилища нет — забег просто не сохраняется. */
export function localRunSaveStore(key: string = RUN_SAVE_KEY): RunSaveStore {
  return {
    load: () => {
      try {
        return Promise.resolve(store()?.getItem(key) ?? null);
      } catch {
        return Promise.resolve(null);
      }
    },
    save: (blob) => {
      try {
        store()?.setItem(key, blob);
      } catch {
        /* приватный режим / хранилище полно — забег живёт дальше в памяти */
      }
      return Promise.resolve();
    },
    clear: () => {
      try {
        store()?.removeItem(key);
      } catch {
        /* нечего забывать — и это не ошибка */
      }
      return Promise.resolve();
    },
  };
}
