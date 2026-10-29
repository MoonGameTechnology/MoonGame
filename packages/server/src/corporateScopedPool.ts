import type { Pool, PoolClient } from 'pg';

/** Existing stores sometimes open their own transaction. Inside a service operation
 * those boundaries become savepoints; they must never commit the outer operation. */
export function scopedPool(client: PoolClient): Pool {
  const connection = {
    query: async (sql: string, values?: unknown[]) => {
      const command = sql.trim().toUpperCase();
      if (command === 'BEGIN') return client.query('SAVEPOINT corporate_operation');
      if (command === 'COMMIT') return client.query('RELEASE SAVEPOINT corporate_operation');
      if (command === 'ROLLBACK') {
        // PostgreSQL resolves the most recent savepoint with this fixed name.
        await client.query('ROLLBACK TO SAVEPOINT corporate_operation');
        return client.query('RELEASE SAVEPOINT corporate_operation');
      }
      return client.query(sql, values);
    },
    release: () => undefined,
  };
  return { query: client.query.bind(client), connect: async () => connection } as unknown as Pool;
}
