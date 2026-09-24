import { describe, expect, it } from 'vitest';
import { LOCALE_IDS } from '../../../localization/index';
import { bakedLocale } from '../../../localization/bundles';
import { localeAssetPath as buildPath, platformLocaleFiles } from '../../platformBuild.mjs';
import { loadLocaleAsset, localeAssetPath, parseLocaleAsset } from './localeAsset';

const reply = (ok: boolean, body: unknown) => async () => ({ ok, json: async () => body });

describe('YAG-1.1d — файл языка: разбор', () => {
  it('плоская карта «ключ → текст» читается как есть', () => {
    expect(parseLocaleAsset({ 'hub.play': 'Играть', 'err.x': '' })).toEqual({
      'hub.play': 'Играть',
      'err.x': '',
    });
  });

  it('не карта или карта не текстов — отказ целиком, а не полупустой язык', () => {
    for (const junk of [null, 7, 'text', [], {}, { a: 'ok', b: 1 }, { a: { nested: 'x' } }]) {
      expect(parseLocaleAsset(junk)).toBeNull();
    }
  });
});

describe('YAG-1.1d — файл языка: загрузка', () => {
  it('просит ровно файл выбранного языка и отдаёт его тексты', async () => {
    const asked: string[] = [];
    const messages = await loadLocaleAsset('en', async (url) => {
      asked.push(url);
      return { ok: true, json: async () => ({ 'hub.play': 'Play' }) };
    });
    expect(asked).toEqual(['assets/locale-en.json']);
    expect(messages).toEqual({ 'hub.play': 'Play' });
  });

  it('файла нет или он испорчен — стабильный код отказа, без подробностей', async () => {
    await expect(loadLocaleAsset('ru', reply(false, null))).rejects.toThrow(/^E_LOCALE_ASSET$/);
    await expect(loadLocaleAsset('ru', reply(true, ['x']))).rejects.toThrow(/^E_LOCALE_ASSET$/);
  });
});

describe('YAG-1.1d — что пишет сборка, то и просит игра', () => {
  it('путь файла один и тот же у сборки и у загрузчика', () => {
    for (const id of LOCALE_IDS) expect(buildPath(id)).toBe(localeAssetPath(id));
  });

  it('файл на КАЖДЫЙ язык, и в каждом — язык с запечённым русским фолбэком', async () => {
    const files = await platformLocaleFiles();
    expect(files.map((f) => f.id)).toEqual([...LOCALE_IDS]);
    for (const file of files) {
      expect(file.path).toBe(localeAssetPath(file.id as (typeof LOCALE_IDS)[number]));
      const parsed = parseLocaleAsset(JSON.parse(file.contents));
      expect(parsed).toEqual(bakedLocale(file.id as (typeof LOCALE_IDS)[number]));
    }
  });
});
