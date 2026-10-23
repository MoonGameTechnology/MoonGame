import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { assetType, isWorkerAsset, readAssetDir } from './staticAssets';

it('читает из каталога только картинки и поток расчёта, а не всё, что там лежит', () => {
  const dir = mkdtempSync(join(tmpdir(), 'assets-'));
  try {
    const names = [
      'fighter-DYTR3J73.webp',
      'medals-AB12.svg',
      'sim-worker-0a1b2c3d4e.js',
      '.env',
      'notes.txt',
      'app.js',
      'sim-worker.js',
      'sim-worker-0a1b.js.map',
    ];
    for (const name of names) writeFileSync(join(dir, name), name);
    const assets = readAssetDir(dir);
    expect([...assets.keys()].sort()).toEqual([
      'fighter-DYTR3J73.webp',
      'medals-AB12.svg',
      'sim-worker-0a1b2c3d4e.js',
    ]);
    expect(assets.get('medals-AB12.svg')?.toString()).toBe('medals-AB12.svg');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('поток расчёта узнаётся только по имени со своим хешем', () => {
  expect(isWorkerAsset('sim-worker-0a1b2c3d4e.js')).toBe(true);
  expect(isWorkerAsset('sim-worker-.js')).toBe(false);
  expect(isWorkerAsset('evil-sim-worker-0a1b.js')).toBe(false);
  expect(isWorkerAsset('fighter-DYTR3J73.webp')).toBe(false);
});

it('тип содержимого — по расширению', () => {
  expect(assetType('a.webp')).toBe('image/webp');
  expect(assetType('a.svg')).toBe('image/svg+xml');
  expect(assetType('sim-worker-0a1b.js')).toBe('text/javascript; charset=utf-8');
});
