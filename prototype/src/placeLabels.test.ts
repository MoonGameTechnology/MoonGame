/**
 * Сторож подписей мест (SZ-map-ids) — статический, как соседние сторожа рендера: холст в
 * vitest не поднять, а проверять мок значило бы проверять мок.
 *
 * Что держит: игрок видит место по имени провинции (`placeName` → `decisions/provinceName.ts`,
 * PVR-6.19), а не по сырому id узла. На картах глав Sector Zero id — английские слова
 * (`home_a`, `pirate_den`), и до PVR-6.19 холст, журнал и карточки показывали их одинаково на
 * обоих языках — п. 8.2.3 требований Яндекс Игр. Там же жила зашитая строка `'asteroid field'`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

describe('SZ-map-ids — места называются именами', () => {
  it('ни одна подпись холста не пишет сырой id узла', () => {
    // `fillText(n.id …)`, `fillText(p.id …)`, `fillText(id, …)` — прежние формы подписи.
    expect(MAIN.match(/fillText\(\s*(?:[np]\.)?id\b/g) ?? []).toEqual([]);
    // Четыре подписи: метка тумана, схема, поле астероидов, выноска мира.
    expect(MAIN.match(/fillText\(placeName\(/g)?.length).toBe(4);
  });

  it('вид сектора под полем астероидов — из данных, а не зашитой строкой', () => {
    expect(MAIN).not.toContain("'asteroid field'");
  });
});
