import { describe, expect, it } from 'vitest';
import { archiveEffect, type ArchiveOp } from './archiveOutcome';

describe('чем кончается «в архив» / «вернуть»', () => {
  it('УДАЧА — МОЛЧАНИЕ И ПЕРЕЧИТАННЫЙ СПИСОК: строка меняет вкладку, это и есть ответ', () => {
    expect(archiveEffect('archive', 'ok')).toEqual({ kind: 'refresh' });
    expect(archiveEffect('restore', 'ok')).toEqual({ kind: 'refresh' });
  });

  it('ОТКАЗ НАЗЫВАЕТ ДЕЙСТВИЕ: «в архив» и «вернуть» отказываются разными словами', () => {
    expect(archiveEffect('archive', 'refused')).toEqual({
      kind: 'say',
      key: 'browser.archive-failed',
    });
    expect(archiveEffect('restore', 'refused')).toEqual({
      kind: 'say',
      key: 'browser.restore-failed',
    });
  });

  it('ОБРЫВ ДЕЙСТВИЙ НЕ РАЗЛИЧАЕТ: беда в канале, текст один', () => {
    const связь = { kind: 'say', key: 'browser.archive-error' };
    expect(archiveEffect('archive', 'unreachable')).toEqual(связь);
    expect(archiveEffect('restore', 'unreachable')).toEqual(связь);
  });

  it('отказ и обрыв — разные тексты: повторять стоит только второй', () => {
    for (const op of ['archive', 'restore'] as ArchiveOp[]) {
      expect(archiveEffect(op, 'refused')).not.toEqual(archiveEffect(op, 'unreachable'));
    }
  });

  it('удача — единственный исход без сообщения', () => {
    for (const op of ['archive', 'restore'] as ArchiveOp[]) {
      expect(archiveEffect(op, 'ok').kind).toBe('refresh');
      expect(archiveEffect(op, 'refused').kind).toBe('say');
      expect(archiveEffect(op, 'unreachable').kind).toBe('say');
    }
  });
});
