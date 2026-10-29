import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('checks disk policy, durable stop intent, failures and restart protection', () => {
  expect(() =>
    execFileSync('python3', [fileURLToPath(new URL('./guard_test.py', import.meta.url))], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      timeout: 10_000,
      stdio: 'pipe',
    }),
  ).not.toThrow();
});
