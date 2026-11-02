/** В памяти: подписки на push (SLIM-5). */
import type { PushStore, PushSubscriptionRecord } from '../types';

export class MemoryPushStore implements PushStore {
  private readonly subs = new Map<string, PushSubscriptionRecord>();

  save(accountId: string, sub: PushSubscriptionRecord): Promise<void> {
    this.subs.set(accountId, sub);
    return Promise.resolve();
  }

  remove(accountId: string): Promise<void> {
    this.subs.delete(accountId);
    return Promise.resolve();
  }

  of(accountId: string): Promise<PushSubscriptionRecord | undefined> {
    return Promise.resolve(this.subs.get(accountId));
  }
}
