import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLD_CURSOR, COLD_SVG, HOT_CURSOR, HOT_SVG, cursorCss, heatPointers } from '../cursors.mjs';

describe('игровой курсор', () => {
  it('холодный — тёмный корпус со светлой окантовкой', () => {
    expect(COLD_SVG).toContain('fill="#030810"');
    expect(COLD_SVG).toContain('stroke="#bfeee6"');
  });

  it('нагретый отличается от холодного и тлеет градиентом', () => {
    expect(HOT_SVG).not.toBe(COLD_SVG);
    expect(HOT_SVG).toContain('fill="url(#h)"');
  });

  it('у обоих есть системный запасной и хотспот на острие', () => {
    expect(COLD_CURSOR).toMatch(/\) 3 2,default$/);
    expect(HOT_CURSOR).toMatch(/\) 3 2,pointer$/);
  });

  it('`cursor:pointer` из любого листа становится нагревом, прочие курсоры не трогаются', () => {
    const out = heatPointers('.a{cursor:pointer;}.b{cursor: pointer}.c{cursor:not-allowed}.d{cursor:grab}');
    expect(out).toBe('.a{cursor:var(--cur-hot);}.b{cursor:var(--cur-hot)}.c{cursor:not-allowed}.d{cursor:grab}');
  });

  it('карта нагревается классом, который ставит main.ts', () => {
    expect(cursorCss()).toContain('#map.cur-hot{cursor:var(--cur-hot);}');
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain("classList.toggle('cur-hot'");
  });

  it('сборка ставит лист курсоров первым и греет все листы', () => {
    const build = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
    expect(build).toMatch(/`\$\{cursorCss\(\)\}\\n\$\{heatPointers\(/);
  });
});
