/** Страницы задания и победы могут стать готовы в одном кадре. Проигрыватель занятую
 *  страницу не открывает, поэтому ждём закрытия предыдущей и гасим повторные заявки.
 *  Отметку просмотра пишет вызывающий только после завершения своего show(). */
export function createComicQueue() {
  let tail = Promise.resolve();
  const pending = new Map<string, Promise<void>>();
  return {
    isBusy: (): boolean => pending.size > 0,
    enqueue(id: string, show: () => Promise<void>): Promise<void> {
      const existing = pending.get(id);
      if (existing) return existing;
      const job = tail.then(show).finally(() => pending.delete(id));
      pending.set(id, job);
      // Ошибка одной страницы не запирает все последующие; сам job остаётся rejected
      // для штатного журнала ошибок вызывающего.
      tail = job.catch(() => {});
      return job;
    },
  };
}
