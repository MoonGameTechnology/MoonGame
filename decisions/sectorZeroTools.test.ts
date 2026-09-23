import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { SECTOR_ZERO_ABSENT_TOOLS, toolShown, type SessionTool } from './sectorZeroTools';

const MARKUP = readFileSync(new URL('../prototype/build.mjs', import.meta.url), 'utf8');
const TOOLS = Object.keys(SECTOR_ZERO_ABSENT_TOOLS) as SessionTool[];

describe('PVR-6.1 — инструменты мультиплеера не едут в забег Sector Zero', () => {
  it('список — ровно решение владельца: дипломатия осталась', () => {
    expect(TOOLS.sort()).toEqual(['chat', 'corp', 'mail', 'market', 'pings', 'steward']);
  });

  it('каждая кнопка существует в разметке рельса', () => {
    // Переименуй кнопку — и без этой проверки она тихо вернулась бы в забег.
    for (const id of Object.values(SECTOR_ZERO_ABSENT_TOOLS))
      expect(MARKUP, `id="${id}" в build.mjs`).toContain(`id="${id}"`);
  });

  it('в забеге инструментов нет, в остальной игре — есть', () => {
    for (const tool of TOOLS) {
      expect(toolShown(tool, true)).toBe(false);
      expect(toolShown(tool, false)).toBe(true);
    }
  });
});
