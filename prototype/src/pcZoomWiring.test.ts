// UIX-2.1: голографический интерфейс ПК растёт с окном через CSS-зум `--pcz`. Под зумом vh и
// vw растут вместе со слоем: окно «во весь экран» (`100dvh`) при зуме 1,25 вылезает за край
// на четверть. Поэтому размеры окон в голографических стилях считаются от `--vph`/`--vpw` —
// видимых высоты и ширины в px зумленного слоя. jsdom раскладку не считает, и сторожит это
// скан файлов, как в `topBar.test.ts`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { narrowLayouts } from '../../decisions/pcScale';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const holoCss = read('../holographic.css');
const bridgeCss = read('../bridge-shell.css');
const holoUi = read('./holographicUi.ts');

/** Правила без комментариев: `[селектор, тело]` самого внутреннего уровня. */
const rules = (css: string): Array<[string, string]> =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [
    (m[1] ?? '').trim(),
    m[2] ?? '',
  ]);
const VIEWPORT_UNIT = /(?<![\w-])\d*\.?\d+[dsl]?v(?:h|w|min|max)\b/;
/** Слои, которые JS ставит в экранных px: зума у них нет, и vh/vw им верны. */
const UNZOOMED = /#objtip|#statpop/;

describe('масштаб ПК доходит до стилей (UIX-2.1)', () => {
  it('holographicUi считает масштаб с «Размером интерфейса» и кладёт его в --holo-pcz', () => {
    expect(holoUi).toMatch(/pcScale\(w, h, uiScalePct\(\)\)/);
    expect(holoUi).toMatch(/setProperty\('--holo-pcz'/);
  });

  it('--pcz берётся из --holo-pcz, --vph и --vpw делят экран на него', () => {
    const [, root] = rules(holoCss).find(([selector]) => selector === 'body.holo-ui') ?? ['', ''];
    expect(root).toMatch(/--pcz:var\(--holo-pcz,1\)/);
    expect(root).toMatch(/--vph:calc\(100dvh \/ var\(--pcz\)\)/);
    expect(root).toMatch(/--vpw:calc\(100dvw \/ var\(--pcz\)\)/);
  });

  it('в голографических стилях нет vh и vw, кроме слоёв без зума', () => {
    // Единственные законные 100dvh и 100dvw — в самих определениях --vph и --vpw.
    const DEFINITIONS = /--vp[hw]:calc\(100dv[hw] \/ var\(--pcz\)\)/g;
    const offenders = [...rules(holoCss), ...rules(bridgeCss)]
      .filter(([selector, body]) => !UNZOOMED.test(selector) && VIEWPORT_UNIT.test(body.replace(DEFINITIONS, '')))
      .map(([selector]) => selector);
    expect(offenders).toEqual([]);
  });

  it('узкие раскладки — классы от раскладки под зумом, а не медиа-запросы по окну (UIX-2.2)', () => {
    const css = holoCss + bridgeCss;
    const queries = [...css.matchAll(/@media\s*([^{]+)\{/g)].map((m) => (m[1] ?? '').trim());
    // (max-width:700px) голограмме не достаётся: консоль включается от 720 px окна, а под
    // зумом ПК раскладка не уже 900 px.
    expect(queries.filter((q) => /max-(width|height)/.test(q) && q !== '(max-width:700px)')).toEqual(
      [],
    );
    const used = new Set([...css.matchAll(/:where\(\.(holo-[wh]\d+)\)/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(Object.keys(narrowLayouts(1, 1, 1)).sort());
    expect(holoUi).toMatch(/narrowLayouts\(w, h, zoom\)/);
  });
});
