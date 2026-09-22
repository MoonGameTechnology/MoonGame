import { describe, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';

/**
 * CP2.2 — воркер действительно ВЫХОДИТ из сборки, и список в нём настоящий.
 *
 * Остальные тесты этой папки проверяют правила; этот — единственный, кто проверяет
 * проводку. Без него `pnpm run check` остаётся зелёным при сборке, из которой
 * `sw.js` пропал целиком: гейт клиент не собирает, а список файлов существует
 * только внутри сборки, так что подделать его в тесте — значит не проверить ничего.
 */
const root = new URL('../../', import.meta.url).pathname;

describe('сборка воркера (CP2.2)', () => {
  it('кладёт рядом с приложением sw.js со списком ИМЕННО этой сборки', async () => {
    const result = (await build({
      root,
      logLevel: 'error',
      build: { write: false },
    })) as Rollup.RollupOutput;

    const files = result.output;
    const sw = files.find((f) => f.fileName === 'sw.js');
    expect(sw, 'sw.js не эмитится сборкой').toBeDefined();
    const code = sw?.type === 'asset' ? String(sw.source) : '';

    // Имя главного чанка содержит хэш содержимого — совпасть «по памяти» оно не может.
    const main = files.find((f) => /^assets\/main-.*\.js$/.test(f.fileName));
    expect(main).toBeDefined();
    expect(code).toContain(main?.fileName);
    expect(code).toContain('index.html');

    // LOC-6 сквозь всю сборку: оба языка кэшируемы, заранее не качается ни один.
    const locales = files.filter((f) => /^assets\/(ru|en)-.*\.js$/.test(f.fileName));
    expect(locales).toHaveLength(2);
    const precache = /__VOID_PRECACHE__>\s*\n\s*var [^=]+= (\[[^\]]*\])/.exec(code)?.[1] ?? '';
    expect(precache).not.toBe('');
    for (const locale of locales) expect(precache).not.toContain(locale.fileName);
  }, 60_000);
});
