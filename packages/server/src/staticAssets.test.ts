import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { assetType, readAssetDir } from './staticAssets';

it('читает из каталога только картинки, а не всё, что там лежит', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assets-'));
  try {
    for (const name of ['fighter-DYTR3J73.webp', 'medals-AB12.svg', '.env', 'notes.txt', 'app.js'])
      writeFileSync(join(dir, name), name);
    const assets = readAssetDir(dir);
    expect([...assets.keys()].sort()).toEqual(['fighter-DYTR3J73.webp', 'medals-AB12.svg']);
    expect(assets.get('medals-AB12.svg')?.toString()).toBe('medals-AB12.svg');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('тип содержимого — по расширению', () => {
  expect(assetType('a.webp')).toBe('image/webp');
  expect(assetType('a.svg')).toBe('image/svg+xml');
});
