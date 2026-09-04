// Production-like multiplayer rehearsal without a public IP or rented server.
// Bundling keeps the CLI runnable from source while the repository remains TypeScript-first.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const integer = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
  return value;
};

const outfile = 'packages/server/dist/rehearsal.mjs';
mkdirSync('packages/server/dist', { recursive: true });
await build({
  entryPoints: ['prototype/src/rehearsal.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['ws', 'pg', 'fastify'],
});
const { runRehearsal } = await import(`${pathToFileURL(outfile).href}?run=${Date.now()}`);

// A broken invariant throws from inside the rehearsal; report it as FAIL rather than
// letting a stack trace stand in for the verdict.
let report;
let failure;
try {
  report = await runRehearsal({
    players: integer('PLAYERS', 4),
    latencyMs: integer('LATENCY_MS', 75),
    persistDelayMs: integer('PERSIST_DELAY_MS', 15),
    timeoutMs: integer('TIMEOUT_MS', 10_000),
  });
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

if (!report) {
  process.stdout.write(`
Void Dominion — multiplayer rehearsal

  result ............... FAIL (${failure})
`);
  process.exitCode = 1;
} else {
  const pass = report.hashMismatches === 0 && report.fogViolations === 0;
  process.stdout.write(`
Void Dominion — multiplayer rehearsal

  players .............. ${report.players}
  actions accepted ..... ${report.actionsAccepted}
  duplicates prevented . ${report.duplicatesPrevented}
  reconnects ........... ${report.reconnects}
  server restarts ...... ${report.serverRestarts}
  durable writes ....... ${report.durableWrites}
  wire action types .... ${report.wireActionTypes}
  wire applied ......... ${report.wireActionsApplied}
  wire rule rejections . ${report.wireActionsRejectedByRules}
  final sequence ....... ${report.finalSequence}
  hash mismatches ...... ${report.hashMismatches}
  fog violations ....... ${report.fogViolations}
  duration ............. ${report.durationMs.toFixed(1)} ms

  result ............... ${pass ? 'PASS' : 'FAIL'}
`);
  if (!pass) process.exitCode = 1;
}
