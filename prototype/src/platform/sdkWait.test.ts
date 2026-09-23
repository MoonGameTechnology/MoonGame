import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { SDK_LOADER_SELECTOR, sdkLoaderPresent } from './sdkWait';

const BUILD_SCRIPT = readFileSync(new URL('../../build.mjs', import.meta.url), 'utf8');
const loader = /const SDK_LOADER = `([\s\S]*?)`;/.exec(BUILD_SCRIPT)?.[1] ?? '';

/** Минимальный `querySelector`, понимающий ровно форму `script[src="…"]`. */
const docWith = (html: string): Pick<Document, 'querySelector'> => ({
  querySelector: (selector: string) => {
    const src = /^script\[src="(.+)"\]$/.exec(selector)?.[1];
    if (src === undefined) throw new Error(`селектор вне формы теста: ${selector}`);
    return html.includes(`<script async src="${src}"`) ? ({} as Element) : null;
  },
});

describe('sdkLoaderPresent — ждать SDK только там, где сборка положила лоадер', () => {
  it('селектор находит РЕАЛЬНЫЙ тег SDK_LOADER из build.mjs', () => {
    // Сторож на расхождение: поменяй путь лоадера — и хост молча перестанет ждать SDK
    // на площадке. Проверяем по значению константы, а не по памяти.
    expect(loader).not.toBe('');
    expect(sdkLoaderPresent(docWith(loader))).toBe(true);
    expect(SDK_LOADER_SELECTOR).toBe('script[src="/sdk.js"]');
  });

  it('разметка без лоадера (веб, APK, дев) — ждать нечего', () => {
    expect(sdkLoaderPresent(docWith('<script>/* игра */</script>'))).toBe(false);
  });
});
