import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  SECTOR_ZERO_ABSENT_HUD,
  SECTOR_ZERO_ABSENT_TOOLS,
  toolShown,
  type SessionTool,
} from './sectorZeroTools';

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

describe('поля шапки, которых нет в забеге (решение владельца 2026-09-24)', () => {
  it('эмблема с названием и местом, очки победы и день — ровно решение владельца', () => {
    expect(Object.keys(SECTOR_ZERO_ABSENT_HUD).sort()).toEqual(['crest', 'day', 'score']);
  });

  it('место живёт внутри блока эмблемы — уходит вместе с ним', () => {
    const crest = /<div class="crest" id="tbcrest">[\s\S]*?\n {4}<\/div>/.exec(MARKUP)?.[0] ?? '';
    for (const id of ['crestmark', 'tbname', 'tbplace']) expect(crest).toContain(`id="${id}"`);
  });

  it('каждое поле существует в разметке шапки', () => {
    for (const id of Object.values(SECTOR_ZERO_ABSENT_HUD))
      expect(MARKUP, `id="${id}" в build.mjs`).toContain(`id="${id}"`);
  });
});
