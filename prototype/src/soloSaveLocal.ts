/** Synchronous so pagehide can complete the write before the browser tears down.
 * Storage failures are surfaced; setItem atomically preserves the previous slot
 * on quota errors. Never remove first, and never touch the Sector Zero keys. */
export const SOLO_SAVE_KEY = 'void.solo.v1';
export function soloSaveStore(
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = () => localStorage,
) {
  return {
    load(): { ok: true; raw: string | null } | { ok: false } {
      try {
        return { ok: true, raw: storage().getItem(SOLO_SAVE_KEY) };
      } catch {
        return { ok: false };
      }
    },
    save(raw: string): boolean {
      try {
        storage().setItem(SOLO_SAVE_KEY, raw);
        return true;
      } catch {
        return false;
      }
    },
    clear(): boolean {
      try {
        storage().removeItem(SOLO_SAVE_KEY);
        return true;
      } catch {
        return false;
      }
    },
  };
}
