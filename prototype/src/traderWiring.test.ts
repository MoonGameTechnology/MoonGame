/**
 * Проводка торговца экспедиции (PVR-6.37) — статический сторож, как у соседних окон: проводка
 * живёт в DOM и кадре `main.ts`, а робот `smoke:sector-zero`, который проходит её вживую, в
 * CI не блокирует. Держит то, что может отвалиться молча: кнопка рельса, кадровый такт, вход
 * из карточки ресурса и привязка торговца к идущему забегу.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');

describe('торговец экспедиции — проводка', () => {
  it('кнопка рельса открывает окно и по умолчанию спрятана', () => {
    expect(MAIN).toMatch(/railTrader\.addEventListener\('click', \(\) => trader\.open\(\)\)/);
    expect(BUILD).toMatch(/<button id="rail-trader"[^>]*style="display:none"/);
  });

  it('кадр забега ведёт кнопку и окно, а торговец есть только у идущего забега', () => {
    expect(MAIN).toMatch(/tickAbandon\(\);\s*tickTrader\(\);/);
    expect(MAIN).toMatch(/return runInProgress\(\) \? traderOf\(ctx\(s\.time, s\)\) : undefined;/);
    expect(MAIN).toMatch(/cfg: runTrader,/);
  });

  it('карточка ресурса знает товары торговца и открывает его на ресурсе', () => {
    expect(MAIN).toMatch(/traderGoods: \(\) => \{\s*const cfg = runTrader\(\);/);
    expect(MAIN).toMatch(/onOpenTrader: \(res\) => trader\.open\(res\)/);
  });

  it('Back закрывает окно торговца', () => {
    expect(MAIN).toMatch(
      /\{ id: 'trader', isOpen: \(\) => trader\.isOpen\(\), close: \(\) => trader\.close\(\) \}/,
    );
  });
});
