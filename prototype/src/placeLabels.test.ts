/**
 * Сторож подписей мест на холсте (SZ-map-ids) — статический, как соседние сторожа
 * рендера: холст в vitest не поднять, а проверять мок значило бы проверять мок.
 *
 * Что держит: карта подписывает место через `placeLabel` (`decisions/placeLabel.ts`), а
 * не сырым id сектора. На картах глав Sector Zero id — английские слова (`home_a`,
 * `pirate_den`), и холст показывал их одинаково на обоих языках. Там же жила зашитая
 * английская строка `'asteroid field'` — вид сектора берётся из данных через `tData`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

describe('SZ-map-ids — холст подписывает места именами', () => {
  it('ни одна подпись не пишет сырой id сектора', () => {
    // `fillText(n.id …)`, `fillText(p.id …)`, `fillText(id, …)` — прежние формы подписи.
    expect(MAIN.match(/fillText\(\s*(?:[np]\.)?id\b/g) ?? []).toEqual([]);
  });

  it('подписи мест идут через placeLabel', () => {
    // Четыре места: метка тумана, схема, поле астероидов и выноска мира.
    expect(MAIN.match(/fillText\(placeLabel\(/g)?.length).toBe(4);
  });

  it('вид сектора под полем астероидов — из данных, а не зашитой строкой', () => {
    expect(MAIN).not.toContain("'asteroid field'");
  });
});
