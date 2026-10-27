/**
 * Транзакция рынка мета-экономики повторяет попытку, которую Postgres снял как deadlock (40P01)
 * или ошибку сериализации (40001): так он просит клиента повторить её. Работа трогает только
 * базу, а откат возвращает базу как было, поэтому повтор безопасен. Фальшивый пул стоит на
 * месте Postgres, поэтому тест идёт без базы. Сама покупка под конкурентами — в
 * `metaMarket.test.ts` на настоящем Postgres.
 */
import { describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { PostgresMetaMarket } from './metaMarket';

/** Пул, где n-я попытка работы падает с `errors[n]`. */
function fakePool() {
  const log: string[] = [];
  const client = {
    query: async (sql: string) => {
      log.push(sql);
      return { rows: [] };
    },
    release: () => void log.push('release'),
  };
  return { pool: { connect: async () => client } as unknown as Pool, log };
}

type Tx = <T>(ids: string[], work: (c: PoolClient) => Promise<T>) => Promise<T>;

function transaction(pool: Pool): Tx {
  const market = new PostgresMetaMarket(pool, () => 1, 0);
  const tx = (market as unknown as { transaction: Tx }).transaction;
  return tx.bind(market);
}

const failing = (errors: Array<{ code?: string; message: string }>) => {
  let attempt = 0;
  return async (): Promise<string> => {
    const error = errors[attempt++];
    if (error) throw Object.assign(new Error(error.message), error);
    return 'done';
  };
};

const deadlock = { code: '40P01', message: 'deadlock detected' };

describe('PostgresMetaMarket · повтор транзакции', () => {
  it('попытку, снятую как deadlock, повторяет с нового BEGIN и фиксирует следующую', async () => {
    const { pool, log } = fakePool();
    await expect(transaction(pool)(['a'], failing([deadlock]))).resolves.toBe('done');
    expect(log).toEqual(['BEGIN', 'ROLLBACK', 'release', 'BEGIN', 'COMMIT', 'release']);
  });

  it('ошибку сериализации повторяет так же', async () => {
    const { pool } = fakePool();
    const work = failing([{ code: '40001', message: 'could not serialize access' }]);
    await expect(transaction(pool)(['a'], work)).resolves.toBe('done');
  });

  it('после третьего deadlock сдаётся и отдаёт ошибку наверх', async () => {
    const { pool, log } = fakePool();
    const work = failing([deadlock, deadlock, deadlock]);
    await expect(transaction(pool)(['a'], work)).rejects.toMatchObject({ code: '40P01' });
    expect(log.filter((sql) => sql === 'BEGIN')).toHaveLength(3);
  });

  it('любую другую ошибку не повторяет', async () => {
    const { pool, log } = fakePool();
    const work = failing([{ code: '23514', message: 'check violation' }]);
    await expect(transaction(pool)(['a'], work)).rejects.toMatchObject({ code: '23514' });
    expect(log.filter((sql) => sql === 'BEGIN')).toHaveLength(1);
  });
});
