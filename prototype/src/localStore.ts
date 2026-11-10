/**
 * Browser storage that never throws.
 *
 * `localStorage` can refuse outright: a browser set to block site data, some private
 * windows, a sandboxed frame. The bare call then throws, and a throw in `connect()` or
 * on the welcome screen leaves the player with a dead button. Through these helpers a
 * refusal reads as "nothing stored" and a write is dropped: the game goes on, it just
 * does not remember the value across a reload.
 */
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage refused: the value lives only for this tab */
  }
}
