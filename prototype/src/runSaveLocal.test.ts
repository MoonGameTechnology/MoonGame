import { describe, it, expect, afterEach } from 'vitest';

import { parseRunSave, serializeRunSave, RUN_SAVE_VERSION } from '../../decisions/runSave';
import { localRunSaveStore, RUN_SAVE_KEY } from './runSaveLocal';

/** Подставное `localStorage`: в Node его нет, а поведение проверять надо. */
function withStorage(impl: Partial<Storage>): void {
  (globalThis as { localStorage?: unknown }).localStorage = impl as Storage;
}
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const blob = serializeRunSave({
  v: RUN_SAVE_VERSION,
  mode: 'pve_waves',
  difficulty: 'weak',
  state: { time: 1 },
});

describe('локальный бэкенд сохранения забега (PVR-0.3)', () => {
  it('пишет и читает под своим ключом', async () => {
    const cell = new Map<string, string>();
    withStorage({
      getItem: (k) => cell.get(k) ?? null,
      setItem: (k, v) => void cell.set(k, v),
      removeItem: (k) => void cell.delete(k),
    });
    const s = localRunSaveStore();
    await s.save(blob);
    expect(cell.get(RUN_SAVE_KEY)).toBe(blob);
    expect(parseRunSave(await s.load())?.mode).toBe('pve_waves');
    await s.clear();
    expect(await s.load()).toBeNull();
  });

  it('ХРАНИЛИЩА НЕТ — забег не падает, он просто не сохраняется', async () => {
    // Node в тестах, WebView с запрещёнными cookies: там `localStorage` не объявлен.
    const s = localRunSaveStore();
    await expect(s.save(blob)).resolves.toBeUndefined();
    expect(await s.load()).toBeNull();
    await expect(s.clear()).resolves.toBeUndefined();
  });

  it('запись БРОСАЕТ (приватный режим, хранилище полно) — забег продолжается', async () => {
    withStorage({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    const s = localRunSaveStore();
    await expect(s.save(blob)).resolves.toBeUndefined();
    expect(await s.load()).toBeNull(); // провал чтения — это «сохранения нет»
    await expect(s.clear()).resolves.toBeUndefined();
  });
});
