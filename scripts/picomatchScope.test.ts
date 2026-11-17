import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const packagePath = /(?:^|[\\/])node_modules[\\/]picomatch$/;

function includesPicomatch(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(includesPicomatch);
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  return node.name === 'picomatch' || node.from === 'picomatch' ||
    (typeof node.path === 'string' && packagePath.test(node.path)) ||
    Object.entries(node).some(([key, child]) => key === 'picomatch' || includesPicomatch(child));
}

describe('temporary CVE-2026-112366 exception stays outside runtime dependencies', () => {
  it('rejects introduction into any production workspace graph or mobile package', () => {
    const graph: unknown = JSON.parse(execFileSync('pnpm', ['list', '-r', '--prod', '--depth', 'Infinity', '--json'], {
      cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10_000,
    }));
    expect(includesPicomatch(graph)).toBe(false);
    const mobile = JSON.parse(readFileSync(new URL('../mobile/package-lock.json', import.meta.url), 'utf8')) as {
      packages: Record<string, { name?: string; dev?: boolean }>;
    };
    expect(Object.entries(mobile.packages).filter(([path, pkg]) =>
      (packagePath.test(path) || pkg.name === 'picomatch') && pkg.dev !== true,
    )).toEqual([]);
  }, 15_000);

  it.each([
    { dependencies: { picomatch: { version: '4.0.7' } } },
    { dependencies: { alias: { from: 'picomatch', version: '4.0.7' } } },
    { dependencies: { alias: { path: '/app/node_modules/.pnpm/picomatch@4.0.7/node_modules/picomatch' } } },
    { dependencies: { parent: { optionalDependencies: { picomatch: {} } } } },
  ])('the scope guard detects direct, aliased and nested matcher dependencies: %j', graph => {
    expect(includesPicomatch(graph)).toBe(true);
  });
});
