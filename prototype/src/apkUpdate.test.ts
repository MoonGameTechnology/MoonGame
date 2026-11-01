// REFM-22 — сторож двух решений самообновления APK.
//
// Оба легко ломаются молча и оба видны только на телефоне: диагностика, которая
// перестала различать «ты свежий» и «сеть не отвечает», и порог, который перестал
// сдерживать проверку при возврате в передний план.
import { describe, expect, it } from 'vitest';
import { CHECK_GAP_MS, installMessage, shouldCheck, updateMessage } from './apkUpdate';
import type { UpdateCheck } from './updater';

const info = {
  versionCode: 42,
  versionName: 'alpha-deadbee',
  sha: 'deadbee',
  apkUrl: 'https://example.invalid/app.apk',
  notes: 'rolling',
  apkSha256: 'a'.repeat(64),
};
const OUTCOMES: UpdateCheck[] = [
  { kind: 'update', info, local: 41 },
  { kind: 'current', local: 41, remote: 41 },
  { kind: 'offline', error: 'DNS' },
  { kind: 'http', status: 503 },
  { kind: 'unparsable' },
  { kind: 'unverified' },
  { kind: 'unsupported' },
  { kind: 'dormant' },
];

describe('диагностика проверки', () => {
  it('у каждого исхода свой текст — иначе ручную проверку не проследить', () => {
    const said = OUTCOMES.map(updateMessage);
    for (const line of said) expect(line.trim().length).toBeGreaterThan(0);
    expect(new Set(said).size).toBe(OUTCOMES.length);
  });

  it('«ты на свежей версии» и «до сети не достучались» — РАЗНЫЕ строки', () => {
    // Ровно та пара, ради которой диагностика и заводилась: молчать одинаково в
    // обоих случаях значит не сказать ничего.
    expect(updateMessage({ kind: 'current', local: 41, remote: 41 })).not.toBe(
      updateMessage({ kind: 'offline', error: 'DNS' }),
    );
    expect(updateMessage({ kind: 'offline', error: 'DNS' })).not.toBe(updateMessage({ kind: 'http', status: 0 }));
  });

  it('текст приходит из локали, а не ключом', () => {
    for (const line of OUTCOMES.map(updateMessage)) expect(line).not.toMatch(/^upd\./);
  });
});

describe('статус проверенной установки', () => {
  it('подмена файла и отказ в разрешении читаются по-разному', () => {
    const codes = ['downloading', 'installing', 'E_UPDATE_PERMISSION', 'E_UPDATE_DIGEST', 'E_UPDATE_PACKAGE', 'E_UPDATE_DOWNLOAD', 'E_UPDATE_INSTALL', 'E_UPDATE_TIMEOUT', 'E_UPDATE_DNS', 'E_UPDATE_TLS', 'E_UPDATE_HTTP', 'E_UPDATE_STALE'];
    const said = codes.map(installMessage);
    expect(new Set(said).size).toBe(codes.length);
    for (const line of said) expect(line).not.toMatch(/^upd\./);
  });

  it('незнакомый код — отказ, а не «устанавливаю»', () => {
    for (const code of [undefined, null, 'ok', 42]) expect(installMessage(code)).toBe(installMessage('E_UPDATE_DOWNLOAD'));
  });
});

describe('порог молчаливых проверок', () => {
  const NOW = 1_700_000_000_000;

  it('офлайн не проверяем никогда', () => {
    expect(shouldCheck(NOW, 0, false)).toBe(false);
    expect(shouldCheck(NOW, NOW - CHECK_GAP_MS * 10, false)).toBe(false);
  });

  it('первая проверка проходит', () => {
    expect(shouldCheck(NOW, 0, true)).toBe(true);
  });

  it('внутри зазора — нет, за ним — да', () => {
    // Возврат в передний план на телефоне случается десятки раз в час: без порога
    // это стук по API, а не проверка обновления.
    expect(shouldCheck(NOW, NOW - 1, true)).toBe(false);
    expect(shouldCheck(NOW, NOW - CHECK_GAP_MS + 1, true)).toBe(false);
    expect(shouldCheck(NOW, NOW - CHECK_GAP_MS, true)).toBe(true);
  });
});

// A banner can stay open longer than the host retains its immutable APK URL.
describe('download uses a fresh signed release', () => {
  it('uses the release checked at click time and its matching digest', async () => {
    const { beginVerifiedUpdate } = await import('./apkUpdate');
    const latest = { ...info, versionCode: 43, apkUrl: 'https://77-221-140-87.sslip.io/downloads/android/alpha/43-deadbee/void-dominion-alpha.apk', apkSha256: 'b'.repeat(64) };
    const installed: string[][] = [];
    let checks = 0;
    await beginVerifiedUpdate({ check: async () => { checks++; return { kind: 'update', local: 41, info: latest }; }, install: (url, hash) => { installed.push([url, hash]); }, status: () => {} });
    expect(checks).toBe(1);
    expect(installed).toEqual([[latest.apkUrl, latest.apkSha256]]);
  });
  it.each(OUTCOMES.filter(x => x.kind !== 'update'))('refuses unavailable or unverified release: $kind', async outcome => {
    const { beginVerifiedUpdate } = await import('./apkUpdate');
    const installed: string[] = [], statuses: string[] = [];
    await beginVerifiedUpdate({ check: async () => outcome, install: url => { installed.push(url); }, status: text => { statuses.push(text); } });
    expect(installed).toEqual([]);
    expect(statuses.at(-1)).toBe(updateMessage(outcome));
  });
  it('refuses a URL outside the trusted distribution origin', async () => {
    const { beginVerifiedUpdate } = await import('./apkUpdate');
    let installed = false;
    await beginVerifiedUpdate({ check: async () => ({ kind: 'update', local: 41, info }), install: () => { installed = true; }, status: () => {} });
    expect(installed).toBe(false);
  });
});
