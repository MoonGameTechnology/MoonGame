import { AsyncLocalStorage } from 'node:async_hooks';

/** One gate for memory inventory, crafting and trading, including nested store calls. */
export class MemoryEconomyLock {
  private tail = Promise.resolve();
  private readonly scope = new AsyncLocalStorage<{ active: boolean }>();

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.scope.getStore()?.active) return work();
    const next = this.tail.then(async () => {
      const token = { active: true };
      try {
        return await this.scope.run(token, work);
      } finally {
        token.active = false;
      }
    });
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

const locks = new WeakMap<object, MemoryEconomyLock>();
export function memoryEconomyLock(owner: object): MemoryEconomyLock {
  let lock = locks.get(owner);
  if (!lock) {
    lock = new MemoryEconomyLock();
    locks.set(owner, lock);
  }
  return lock;
}
