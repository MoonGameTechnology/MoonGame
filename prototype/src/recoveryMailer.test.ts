import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { recoveryMailer } from './recoveryMailer';
import { LOCALE, setLocale } from '../../localization/core';
import type { Mailer } from '../../packages/server/src/authApi';

it('keeps recipient locales and literal reset links independent across overlapping deliveries', async () => {
  const sent: Parameters<Mailer>[0][] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const send = recoveryMailer(async (message) => { sent.push(message); await blocked; })!;
  const previous = LOCALE;
  const link = 'https://play.example/?reset=%24%26%3F%2F&literal=$&-$`-$\'';
  try {
    setLocale('en');
    const deliveries = ['en', 'ru', 'unsupported', undefined].map((locale, index) => send({
      to: `player${index}@example.test`, template: 'password-reset', locale, params: { link },
    }));
    expect(sent.map((message) => message.subject)).toEqual([
      'Void Dominion — password reset', 'Void Dominion — сброс пароля',
      'Void Dominion — сброс пароля', 'Void Dominion — сброс пароля',
    ]);
    expect(sent[0]!.text).toContain('valid for 15 minutes');
    expect(sent[1]!.text).toContain('15 минут');
    for (const message of sent) expect(message.text).toContain(link);
    expect(LOCALE).toBe('en');
    release();
    await Promise.all(deliveries);
  } finally { release(); setLocale(previous); }
  expect(recoveryMailer(undefined)).toBeUndefined();
});

it('keeps the server package dependency graph free of localization catalogs and runtimes', async () => {
  const result = await build({
    entryPoints: ['packages/server/src/main.ts'], bundle: true, write: false,
    format: 'esm', platform: 'node', packages: 'external', metafile: true,
  });
  expect(Object.keys(result.metafile!.inputs).filter((file) => file.startsWith('localization/'))).toEqual([]);
});
