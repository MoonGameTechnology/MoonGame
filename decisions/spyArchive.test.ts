import { describe, expect, it } from 'vitest';
import {
  parseSpyArchive,
  pushSpyRecord,
  SPY_ARCHIVE_MAX,
  spyOpGlyph,
  spyRecordOf,
  type SpyRecord,
} from './spyArchive';

describe('SPY-20 — архив донесений', () => {
  it('собирает записи из событий: новые сверху, не больше двадцати', () => {
    let archive: SpyRecord[] = [];
    for (let i = 0; i < SPY_ARCHIVE_MAX + 5; i++)
      archive = pushSpyRecord(
        archive,
        spyRecordOf('espionage.sent', { owner: 'p1', planetId: `w${i}`, op: 'theft' }, i, `#${i}`),
      );
    expect(archive).toHaveLength(SPY_ARCHIVE_MAX);
    expect(archive[0]).toEqual({ at: 24, text: '#24', planetId: 'w24', op: 'theft' });
    expect(archive.at(-1)!.text).toBe('#5');
  });

  it('не трогает прежний архив', () => {
    const before: SpyRecord[] = [{ at: 1, text: 'a' }];
    const after = pushSpyRecord(before, { at: 2, text: 'b' });
    expect(before).toEqual([{ at: 1, text: 'a' }]);
    expect(after.map((r) => r.text)).toEqual(['b', 'a']);
  });

  it('мир и операция — из события, а не из текста', () => {
    expect(
      spyRecordOf('espionage.succeeded', { planetId: 'n3', kind: 'sabotage' }, 5, 't'),
    ).toEqual({
      at: 5,
      text: 't',
      planetId: 'n3',
      op: 'sabotage',
    });
    expect(spyRecordOf('intel.deepened', { planetId: 'n3', layer: 2 }, 5, 't').op).toBe('recon');
    expect(spyRecordOf('espionage.counter.caught', { planetId: 'n3' }, 5, 't').op).toBe('counter');
    expect(spyRecordOf('espionage.posted', { planetId: 'n3' }, 5, 't').op).toBe('counter');
    // Провал называет жертву, а не мир: записи не к чему вести.
    expect(spyRecordOf('espionage.failed', { target: 'p2', kind: 'theft' }, 5, 't')).toEqual({
      at: 5,
      text: 't',
      op: 'theft',
    });
    // Неизвестное ядру значение — не операция.
    expect(
      spyRecordOf('espionage.sent', { planetId: 'n3', op: 'bribe' }, 5, 't').op,
    ).toBeUndefined();
  });

  it('у каждой операции свой значок, у неизвестной — общий', () => {
    const ops = ['recon', 'theft', 'sabotage', 'delay', 'disrupt', 'research', 'counter'] as const;
    const glyphs = ops.map(spyOpGlyph);
    expect(new Set(glyphs).size).toBe(ops.length);
    expect(glyphs).not.toContain(spyOpGlyph(undefined));
  });

  it('из сейва: нет архива — пустой, порча — null, лишнее срезано', () => {
    expect(parseSpyArchive(undefined)).toEqual([]);
    expect(parseSpyArchive({})).toBeNull();
    expect(parseSpyArchive([{ at: -1, text: 'x' }])).toBeNull();
    expect(parseSpyArchive([{ at: 1, text: 2 }])).toBeNull();
    expect(parseSpyArchive([{ at: 1, text: 'x', planetId: 7 }])).toBeNull();
    expect(parseSpyArchive([{ at: 1, text: 'x', op: 'bribe' }])).toBeNull();
    expect(parseSpyArchive([null])).toBeNull();
    const ok = [{ at: 1, text: 'x', planetId: 'n1', op: 'recon' }];
    expect(parseSpyArchive(ok)).toEqual(ok);
    const many = Array.from({ length: 30 }, (_, i) => ({ at: i, text: `${i}` }));
    expect(parseSpyArchive(many)).toHaveLength(SPY_ARCHIVE_MAX);
  });
});
