import { describe, expect, it } from 'vitest';
import { spyFaceIndex, spyFaceIndexes, spyPortraitSvg } from './spyPortrait';
import { SPY_FACES } from './spyPortraitArt';

describe('spyPortraitSvg', () => {
  it('draws ten distinct faces and cycles callsigns past them', () => {
    expect(SPY_FACES).toHaveLength(10);
    const faces = new Set(SPY_FACES.map((f) => f()));
    expect(faces.size).toBe(10);
    expect(spyFaceIndex(0)).toBe(0);
    expect(spyFaceIndex(10)).toBe(0);
    expect(spyFaceIndex(13)).toBe(3);
    expect(spyPortraitSvg(3, 0)).toContain(SPY_FACES[3]!());
  });

  it('gives live spies different faces: a clash takes the next free one', () => {
    // Slots 1..3 of generation 0 and the replacement in slot 3 (callsign 10 → face 0).
    expect(spyFaceIndexes([0, 1, 10])).toEqual([0, 1, 2]);
    expect(spyFaceIndexes([9, 19, 29, 0])).toEqual([9, 0, 1, 2]);
    expect(spyFaceIndexes([])).toEqual([]);
  });

  it('keeps the same face for the same callsign and adds a check per level, capped at 3', () => {
    const count = (html: string) => (html.match(/<circle[^>]*stroke="#5fe39a"/g) ?? []).length;
    expect(count(spyPortraitSvg(1, 0))).toBe(0);
    expect(count(spyPortraitSvg(1, 2))).toBe(2);
    expect(count(spyPortraitSvg(1, 9))).toBe(3);
    const face = spyPortraitSvg(1, 0).replace(/<circle[^>]*stroke="#5fe39a"[^>]*\/>|<path d="M[\d. -]+l[^"]+" fill="none" stroke="#5fe39a"[^>]*\/>/g, '');
    expect(spyPortraitSvg(1, 3)).toContain(face.slice(0, face.length - 6));
  });

  it('uses no ids: the portrait is inlined twice on one page', () => {
    for (const f of SPY_FACES) expect(f()).not.toMatch(/\sid=/);
    expect(spyPortraitSvg(0, 3)).not.toMatch(/\sid=/);
  });
});
