// REFM-22 — сторож двух решений самообновления APK.
//
// Оба легко ломаются молча и оба видны только на телефоне: диагностика, которая
// перестала различать «ты свежий» и «сеть не отвечает», и порог, который перестал
// сдерживать проверку при возврате в передний план.
import { describe, expect, it } from 'vitest';
import { CHECK_GAP_MS, shouldCheck, updateMessage } from './apkUpdate';
import type { UpdateCheck } from './updater';

const info = {
  versionCode: 42,
  sha: 'deadbee',
  apkUrl: 'https://example.invalid/app.apk',
  notes: 'rolling',
};
const OUTCOMES: UpdateCheck[] = [
  { kind: 'update', info, local: 41 },
  { kind: 'current', local: 41, remote: 41 },
  { kind: 'offline', error: 'DNS' },
  { kind: 'http', status: 503 },
  { kind: 'unparsable' },
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
