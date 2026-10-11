import type { Pool, PoolClient } from 'pg';
import { CorpService } from './corpService';
import { AvaService } from './avaService';
import { MedalService } from './medalService';
import { loadMedalCatalog } from './medalCatalog';
import {
  PostgresCorpStore,
  PostgresAvaChallengeStore,
  PostgresAvaRosterStore,
  PostgresAvaResultStore,
  PostgresAvaFeedStore,
  PostgresMedalStore,
} from './store';

/** Existing stores sometimes open their own transaction. Inside a service operation
 * those boundaries become savepoints; they must never commit the outer operation. */
function scopedPool(client: PoolClient): Pool {
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

/** Rights checks, mutations and audit share one serializable transaction. Only
 * aborted serialization/deadlock attempts retry; network/commit errors never do. */
function transactional<T extends object>(pool: Pool, factory: (connection: Pool) => T): T {
  const base = factory(pool);
  return new Proxy(base, {
    get(target, property) {
      const method = Reflect.get(target, property) as unknown;
      if (typeof method !== 'function') return method;
      return async (...args: unknown[]) => {
        for (let attempt = 0; ; attempt++) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
            const service = factory(scopedPool(client));
            const result: unknown = await Reflect.apply(
              Reflect.get(service, property) as (...args: unknown[]) => unknown,
              service,
              args,
            );
            const committed = await client.query('COMMIT');
            if (committed.command !== 'COMMIT') throw Error('E_CORPORATE_TRANSACTION_ABORTED');
            return result;
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            const code = (error as { code?: unknown }).code;
            if (attempt < 2 && (code === '40001' || code === '40P01')) continue;
            throw error;
          } finally {
            client.release();
          }
        }
      };
    },
  });
}

export function createCorporateServices(pool: Pool): {
  corp: CorpService;
  ava: AvaService;
  medals: MedalService;
} {
  return {
    corp: transactional(pool, (db) => new CorpService({ store: new PostgresCorpStore(db) })),
    ava: transactional(
      pool,
      (db) =>
        new AvaService({
          corpStore: new PostgresCorpStore(db),
          challengeStore: new PostgresAvaChallengeStore(db),
          rosterStore: new PostgresAvaRosterStore(db),
          resultStore: new PostgresAvaResultStore(db),
          feedStore: new PostgresAvaFeedStore(db),
        }),
    ),
    medals: transactional(
      pool,
      (db) =>
        new MedalService({
          corpStore: new PostgresCorpStore(db),
          resultStore: new PostgresAvaResultStore(db),
          medalStore: new PostgresMedalStore(db),
          catalog: loadMedalCatalog(),
        }),
    ),
  };
}
