import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { CHAT_TEXT_MAX } from '../packages/protocol/src/index';
import { BOT_REPLY_KEYS } from '../packages/server/src/botSocial';
import { LOCALE, setLocale } from '../localization/core';
import { botChatText } from './botChatText';

it('renders every reply in RU and EN independently of the global client locale', () => {
  const previous = LOCALE;
  try {
    setLocale('en');
    for (const key of BOT_REPLY_KEYS) {
      const ru = botChatText(key, 'ru');
      const en = botChatText(key, 'en');
      expect(ru).not.toBe(key);
      expect(en).not.toBe(key);
      expect(ru.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
      expect(ru.length).toBeLessThanOrEqual(CHAT_TEXT_MAX);
      expect(en.length).toBeLessThanOrEqual(CHAT_TEXT_MAX);
      expect(en).not.toMatch(/[а-яё]/i);
      expect(LOCALE).toBe('en');
    }
  } finally {
    setLocale(previous);
  }
});

it('keeps responder logic free of presentation catalogs and locale runtimes', async () => {
  const result = await build({
    entryPoints: ['packages/server/src/botSocial.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    metafile: true,
  });
  expect(
    Object.keys(result.metafile!.inputs).filter((file) => file.startsWith('localization/')),
  ).toEqual([]);
});
