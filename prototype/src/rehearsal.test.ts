import { describe, expect, it } from 'vitest';
import { CLIENT_ACTION_TYPES } from '../../packages/shared-core/src/actions/payloadSchemas';
import { runRehearsal } from './rehearsal';

describe('multiplayer rehearsal', () => {
  it('survives concurrency, duplicate delivery, reconnect and server restart', async () => {
    const report = await runRehearsal({
      players: 2,
      latencyMs: 0,
      persistDelayMs: 0,
      timeoutMs: 5_000,
    });

    expect(report).toMatchObject({
      players: 2,
      actionsAccepted: 2,
      duplicatesPrevented: 1,
      reconnects: 1,
      serverRestarts: 1,
      durableWrites: 2 + CLIENT_ACTION_TYPES.length,
      wireActionTypes: CLIENT_ACTION_TYPES.length,
      hashMismatches: 0,
      fogViolations: 0,
      finalSequence: 2 + CLIENT_ACTION_TYPES.length,
      persistenceBackend: 'memory',
    });
    expect(report.wireActionsApplied + report.wireActionsRejectedByRules).toBe(
      CLIENT_ACTION_TYPES.length,
    );
  });

  it.runIf(Boolean(process.env.DATABASE_URL))(
    'restores the WebSocket room through PostgreSQL snapshots and receipts',
    async () => {
      const report = await runRehearsal({
        players: 2,
        latencyMs: 0,
        persistDelayMs: 0,
        timeoutMs: 5_000,
        databaseUrl: process.env.DATABASE_URL,
      });

      expect(report).toMatchObject({
        persistenceBackend: 'postgres',
        serverRestarts: 1,
        duplicatesPrevented: 1,
        hashMismatches: 0,
        fogViolations: 0,
        finalSequence: 2 + CLIENT_ACTION_TYPES.length,
      });
    },
  );
});
