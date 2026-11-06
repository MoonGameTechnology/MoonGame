import { expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate, PostgresAccountStore } from './postgres';

// testDatabase.setup.ts supplies a separate disposable database for this file.
it.skipIf(!process.env.DATABASE_URL)(
  'migrates legacy seats and retains the personal archive through fresh connections and repeated migration',
  async () => {
    const options = { connectionString: process.env.DATABASE_URL, max: 1 };
    let pool = new Pool(options);
    try {
      await pool.query(`CREATE TABLE seats (
      room text NOT NULL, nick text NOT NULL, player_id text NOT NULL,
      joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(room,nick)
    )`);
      await pool.query('INSERT INTO seats(room,nick,player_id) VALUES($1,$2,$3)', [
        'legacy',
        'alice',
        'p1',
      ]);
      await migrate(pool);
      const first = new PostgresAccountStore(pool);
      expect(await first.seatOf('legacy', 'alice')).toBe('p1');
      expect(await first.archivedMatches('alice', ['legacy'])).toEqual([]);
      expect(await first.setMatchArchived('legacy', 'alice', true)).toBe(true);
      await pool.end();
      pool = new Pool(options);
      await migrate(pool); // A deployment must not reset an already stored choice.
      const afterRestart = new PostgresAccountStore(pool);
      expect(await afterRestart.archivedMatches('alice', ['legacy'])).toEqual(['legacy']);
      expect(await afterRestart.resolveSeat('legacy', 'alice', ['p1', 'p2'])).toEqual({
        playerId: 'p1',
        isNew: false,
      });
      expect(await afterRestart.archivedMatches('alice', ['legacy'])).toEqual(['legacy']);
      expect(await afterRestart.archivedMatches('bob', ['legacy'])).toEqual([]);
      await afterRestart.setMatchArchived('legacy', 'alice', false);
      expect(await afterRestart.archivedMatches('alice', ['legacy'])).toEqual([]);
    } finally {
      await pool.end();
    }
  },
);
