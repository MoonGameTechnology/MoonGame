import type { AvaOrchestrator } from './avaOrchestrator';
import type { AvaService } from './avaService';
import type { CorpArsenalService } from './corpArsenalService';
import type { AvaResultStore, AvaSessionStore } from './store';

/**
 * The AvA background loop (CORP-5), shared by both hosts — `main.ts` and the players'
 * host `prototype/netserver.ts` — so a corporations battle lives the same life on each.
 * No client is needed for any of it:
 *  - result delivery (AVA-8): every ended AvA match returns its corp-warehouse
 *    handouts (wear 1), settles the matchup and records the outcome; an ended snapshot
 *    is the outbox, so a failed pass retries until the result is recorded;
 *  - the war clock (AVA-8, S6): the war opens once the peace period is over;
 *  - challenge expiry (AVA-4), the roster window (AVA-6) and sessions for freshly
 *    locked matchups (AVA-7), in that order, so a lock and its battle land together;
 *  - a cancelled battle (short roster, no map) returns its handouts without wear.
 * While the corporations state moves to a new database (`maintenance`), everything
 * that writes there waits; the war clock keeps running in the game's own rooms.
 */
export interface AvaSweepDeps {
  sessionStore: AvaSessionStore;
  resultStore: AvaResultStore;
  ava: Pick<AvaService, 'sweepExpired' | 'sweepRosters'>;
  orchestrator: Pick<AvaOrchestrator, 'sweep' | 'sweepWar' | 'onMatchEnded'>;
  corpArsenal: Pick<CorpArsenalService, 'returnWar' | 'returnCancelled'>;
  maintenance: () => boolean;
  log: (message: string) => void;
}

export interface AvaSweeps {
  /** Deliver every ended AvA match's result; a match end calls it at once. Single-flight. */
  deliverResults(): Promise<void>;
  /** One pass of every sweep; resolves when all of them settled (errors are logged).
   *  Single-flight: a pass still running (a slow corporations call) is not doubled, so
   *  one locked matchup is never raised twice at once. */
  tick(): Promise<void>;
  /** Run `tick` on an unref'd interval; returns the stop function. */
  start(intervalMs?: number): () => void;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createAvaSweeps(deps: AvaSweepDeps): AvaSweeps {
  let delivering = false;
  let ticking = false;

  async function deliverResults(): Promise<void> {
    if (deps.maintenance() || delivering || !deps.sessionStore.pendingResults) return;
    delivering = true;
    try {
      for (const result of await deps.sessionStore.pendingResults()) {
        try {
          // Inventory returns commit locally; their remote audit remains retryable.
          await deps.corpArsenal.returnWar(result.matchupId);
          await deps.orchestrator.onMatchEnded(result.matchId, result.winner);
          if (!(await deps.resultStore.get(result.matchupId))) throw Error('E_AVA_RESULT_PENDING');
          await deps.sessionStore.markResultDelivered?.(result.matchId);
        } catch (error) {
          await deps.sessionStore.markResultRetry?.(result.matchId);
          deps.log(`ava result ${result.matchId} pending: ${reason(error)}`);
        }
      }
    } finally {
      delivering = false;
    }
  }

  async function tick(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      await pass();
    } finally {
      ticking = false;
    }
  }

  async function pass(): Promise<void> {
    const runs = [
      deliverResults().catch((error: unknown) => deps.log(`ava result retry pending: ${reason(error)}`)),
      deps.orchestrator
        .sweepWar()
        .catch((error: unknown) => deps.log(`ava war clock failed: ${reason(error)}`)),
    ];
    if (!deps.maintenance()) {
      runs.push(
        deps.ava
          .sweepExpired()
          .then(() => undefined)
          .catch((error: unknown) => deps.log(`ava expiry sweep failed: ${reason(error)}`)),
        deps.ava
          .sweepRosters()
          .then(() => deps.orchestrator.sweep())
          .then(() => undefined)
          .catch((error: unknown) => deps.log(`ava roster/session sweep failed: ${reason(error)}`))
          // After the roster and session sweeps, so a battle cancelled this pass returns now.
          .then(() => deps.corpArsenal.returnCancelled())
          .then(() => undefined)
          .catch((error: unknown) => deps.log(`ava cancelled handout return failed: ${reason(error)}`)),
      );
    }
    await Promise.all(runs);
  }

  function start(intervalMs = 60_000): () => void {
    const timer = setInterval(() => {
      tick().catch((error: unknown) => deps.log(`ava sweep pass failed: ${reason(error)}`));
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { deliverResults, tick, start };
}
