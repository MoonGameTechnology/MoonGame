import { describe, expect, it, vi } from 'vitest';
import { detach } from './detach';

describe('detach · фоновая работа не роняет процесс', () => {
  it('отклонение проглатывается и называется в stderr', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      detach('сохранение снапшота', Promise.reject(new Error('база недоступна')));
      await new Promise((r) => setTimeout(r, 0)); // дать микрозадаче отработать
      expect(write).toHaveBeenCalledTimes(1);
      const line = String(write.mock.calls[0]?.[0]);
      expect(line).toContain('сохранение снапшота'); // что именно не доехало
      expect(line).toContain('база недоступна'); // и почему
    } finally {
      write.mockRestore();
    }
  });

  it('успешную работу не трогает и ничего не пишет', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      detach('сохранение снапшота', Promise.resolve('готово'));
      await new Promise((r) => setTimeout(r, 0));
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
});
