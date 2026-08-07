import { describe, it, expect } from 'vitest';
import {
  ENTRY_UNBOUNDED_MS,
  fmtJoinWindow,
  joinWindow,
  rowAction,
  ruleSummary,
  type MatchTab,
} from './matchRow';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('строка матча — сводка правил', () => {
  it('скорость есть всегда, по умолчанию ×1', () => {
    expect(ruleSummary({})).toBe('×1');
    expect(ruleSummary({ timeScale: 20 })).toBe('×20');
  });

  it('НЕЗАДАННОЕ УСЛОВИЕ ПОБЕДЫ НЕ ЗАНИМАЕТ МЕСТА — строка и так тесная', () => {
    expect(ruleSummary({ timeScale: 5, victory: {} })).toBe('×5');
  });

  it('оба условия победы показываются вместе', () => {
    const s = ruleSummary({ timeScale: 5, victory: { scoreLimit: 1000, dominationPercent: 0.6 } });
    expect(s).toContain('×5');
    expect(s).toContain('1000');
    expect(s).toContain('60'); // доля карты — в процентах, а не в долях
  });
});

describe('строка матча — счётчик остатка', () => {
  it('дни и часы, часы, «вот-вот» — три разных подписи', () => {
    expect(fmtJoinWindow(3 * DAY + 5 * HOUR)).not.toBe(fmtJoinWindow(5 * HOUR));
    expect(fmtJoinWindow(5 * HOUR)).not.toBe(fmtJoinWindow(0));
  });

  it('ПРОСРОЧЕННОЕ ОКНО — «вот-вот», а не «осталось −3ч»', () => {
    expect(fmtJoinWindow(-3 * HOUR)).toBe(fmtJoinWindow(0));
  });

  it('неполный час — уже «вот-вот», а не «0ч»', () => {
    expect(fmtJoinWindow(59 * 60_000)).toBe(fmtJoinWindow(0));
  });
});

describe('строка матча — окно входа', () => {
  it('ОКНО ТОЛЬКО НА «ДОСТУПНЫХ»: своё кресло реконнектом окном не гейтится', () => {
    for (const tab of ['active', 'archived'] as MatchTab[]) {
      expect(joinWindow({ entryOpen: true, entryClosesInMs: 3 * HOUR }, tab), tab).toEqual({
        kind: 'none',
      });
    }
  });

  it('СТАРЫЙ СЕРВЕР (поля нет) — это «окно открыто», а не «закрыто»', () => {
    expect(joinWindow({}, 'available')).toEqual({ kind: 'none' });
    expect(joinWindow({ entryOpen: true }, 'available')).toEqual({ kind: 'none' });
  });

  it('закрытый вход назван закрытым', () => {
    expect(joinWindow({ entryOpen: false, entryClosesInMs: 0 }, 'available')).toEqual({
      kind: 'closed',
    });
  });

  it('«ОКНА НЕТ» НЕ ПЕЧАТАЕТСЯ КАК «ОСТАЛОСЬ 3650д»', () => {
    expect(joinWindow({ entryClosesInMs: ENTRY_UNBOUNDED_MS }, 'available')).toEqual({
      kind: 'none',
    });
    expect(joinWindow({ entryClosesInMs: Number.MAX_SAFE_INTEGER }, 'available')).toEqual({
      kind: 'none',
    });
  });

  it('обратный отсчёт отдаёт остаток и признак «скоро»', () => {
    expect(joinWindow({ entryClosesInMs: 3 * DAY }, 'available')).toEqual({
      kind: 'open',
      left: 3 * DAY,
      soon: false,
    });
    expect(joinWindow({ entryClosesInMs: 3 * HOUR }, 'available')).toMatchObject({ soon: true });
  });

  it('граница «скоро» — ровно сутки, и они ещё не «скоро»', () => {
    expect(joinWindow({ entryClosesInMs: DAY }, 'available')).toMatchObject({ soon: false });
    expect(joinWindow({ entryClosesInMs: DAY - 1 }, 'available')).toMatchObject({ soon: true });
  });
});

describe('строка матча — вторая кнопка', () => {
  it('ЧУЖОЙ МАТЧ В АРХИВ НЕ УБИРАЕТСЯ — на «доступных» второй кнопки нет', () => {
    expect(rowAction('available')).toBeNull();
  });

  it('свой активный прячут, архивный возвращают', () => {
    expect(rowAction('active')).toBe('archive');
    expect(rowAction('archived')).toBe('restore');
  });
});
