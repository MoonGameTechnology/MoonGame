// YAG-6.3 — проводка удалённого конфига баланса: флаги площадки читаются ДО импорта игры,
// и каталог прототипа собирается уже с ними. Правила самих флагов — в
// `decisions/remoteBalance.test.ts`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

describe('YAG-6.3 — флаги доезжают до каталога игры', () => {
  it('каталог прототипа собирается с числами из флагов', async () => {
    vi.resetModules();
    const host = await import('./host');
    host.setRemoteFlags({ pve_waves: '4', pve_hold_hours: 'много' });
    const { data } = await import('../gameData');
    expect(data.modes['pve_waves']!.pve!.waves).toBe(4);
    // Негодный флаг — число поставки, а не сбой.
    expect(data.modes['pve_waves']!.pve!.holdHours).toBe(12);
    host.setRemoteFlags({});
    vi.resetModules();
  });

  it('без флагов каталог — ровно числа поставки', async () => {
    vi.resetModules();
    const { data } = await import('../gameData');
    expect(data.modes['pve_waves']!.pve!.waves).toBe(10);
    vi.resetModules();
  });

  it('загрузчик читает флаги до импорта игры', () => {
    const src = readFileSync(fileURLToPath(new URL('../bootstrap.ts', import.meta.url)), 'utf8');
    const flags = src.indexOf('config.flags().then(setRemoteFlags)');
    const game = src.indexOf("import('./main')");
    expect(flags).toBeGreaterThan(0);
    expect(game).toBeGreaterThan(flags);
  });
});
