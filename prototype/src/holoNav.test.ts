/**
 * Сторож навигации над картой на ПК (`.holo-nav`): в ней только то, что нажимается.
 *
 * Там стояла метка «Карта» (`<span aria-current="page">`), оформленная как вкладка: она
 * не нажималась и не менялась, когда открыты «Технологии» или «Производство»
 * (замечание владельца 2026-09-25: «А зачем кнопка „Карта“? Она ничего не делает»).
 * Живой вёрстки в vitest нет — сторож читает разметку, как соседние.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');

describe('навигация над картой — только кнопки', () => {
  it('каждый пункт навигации — кнопка, метки-«вкладки» нет', () => {
    const at = BUILD.indexOf('<nav class="holo-nav"');
    expect(at).toBeGreaterThan(0);
    const nav = BUILD.slice(at, BUILD.indexOf('</nav>', at));
    const items = [...nav.matchAll(/<(\w+)[\s>]/g)].map((m) => m[1]).slice(1); // без самого <nav>
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((tag) => tag === 'button')).toBe(true);
    expect(nav).not.toContain('aria-current');
  });
});
