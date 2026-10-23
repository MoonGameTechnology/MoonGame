/** One debounced snapshot writer per hosted room. A flush always writes a fresh
 * snapshot AFTER an active write (including its settlement) has completed. */
export function createSnapshotWriter(options: {
  save(): Promise<void>;
  onError(error: unknown): void;
}): {
  schedule(delay?: number): void;
  stop(): void;
  flush(): Promise<void>;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active: Promise<void> | null = null;
  let stopped = false;

  function write(): Promise<void> {
    const work = Promise.resolve().then(() => options.save());
    active = work;
    // Register cleanup before callers await work, on both success and failure.
    const clear = (): void => { active = null; };
    void work.then(clear, clear);
    return work;
  }

  function schedule(delay = 500): void {
    if (stopped || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (active) {
        schedule(); // Coalesce without accumulating writes behind a slow store.
        return;
      }
      void write().catch(options.onError);
    }, delay);
  }

  return {
    schedule,
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    async flush() {
      // A failed background write must not skip the final fresh attempt. Its
      // ordinary error handler owns reporting/retry; final failures reject here.
      while (active) await active.catch(() => {});
      await write();
    },
  };
}
