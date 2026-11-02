import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('runs a delegated Steward with zero sockets, then stops on recall and expiry', () => {
  const output = execFileSync(process.execPath, ['prototype/stewardofflinetest.mjs'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
    timeout: 90_000,
  });
  expect(output).toContain('Offline Steward orders OK');
  expect(output).toContain('Offline Steward recall OK');
  expect(output).toContain('Offline defensive Steward orders OK');
  expect(output).toContain('Offline Steward expiry OK');
  expect(output).toContain('Steward host regression OK');
}, 95_000);
