import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Keep the boot/save regression in the normal gate. This exercises the bundled
// controller with the fake DOM; it is deliberately not called a visual test.
it('keeps login ahead of the hub and preserves Sector Zero saves with the modern UI', () => {
  const output = execFileSync(process.execPath, ['prototype/uitest.mjs'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
    timeout: 120_000,
  });
  expect(output.match(/Boot regression OK/g)).toHaveLength(3);
  expect(output.match(/Solo boot regression OK/g)).toHaveLength(3);
  expect(output).toContain('Card navigation OK');
  expect(output).toContain('UI OK');
}, 130_000);
