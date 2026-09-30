import { describe, expect, it } from 'vitest';
import { createComicQueue } from './comicQueue';

describe('очередь сюжетных страниц', () => {
  it('одновременная победа ждёт закрытия задания, повторы не теряют и не дублируют страницу', async () => {
    const queue = createComicQueue();
    const shown: string[] = [];
    let closeTask!: () => void;
    const closed = new Promise<void>((resolve) => {
      closeTask = resolve;
    });
    const task = queue.enqueue('task', async () => {
      shown.push('task');
      await closed;
      shown.push('task-seen');
    });
    const outro = queue.enqueue('outro', async () => {
      shown.push('outro');
    });
    expect(
      queue.enqueue('task', async () => {
        shown.push('duplicate');
      }),
    ).toBe(task);
    expect(queue.isBusy()).toBe(true);
    await Promise.resolve();
    expect(shown).toEqual(['task']);
    closeTask();
    await Promise.all([task, outro]);
    expect(shown).toEqual(['task', 'task-seen', 'outro']);
    expect(queue.isBusy()).toBe(false);
  });

  it('ошибка не помечает страницу просмотренной и не блокирует следующую', async () => {
    const queue = createComicQueue();
    const seen: string[] = [];
    const failed = queue.enqueue('task', async () => {
      throw new Error('image failure');
    });
    const next = queue.enqueue('outro', async () => {
      seen.push('outro');
    });
    await expect(failed).rejects.toThrow('image failure');
    await next;
    expect(seen).toEqual(['outro']);
    expect(queue.isBusy()).toBe(false);
  });
});
