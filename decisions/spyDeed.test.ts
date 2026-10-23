import { describe, expect, it } from 'vitest';
import { spyDeed } from './spyDeed';

describe('правило 1 — саботаж называет число', () => {
  it('повреждено и снесено', () => {
    const hits = [{ destroyed: false }, { destroyed: true }, { destroyed: false }];
    expect(spyDeed({ kind: 'sabotage', hits })).toEqual({
      key: 'log.spy.sabotage',
      params: { n: 3, d: 1 },
      lost: false,
    });
  });
  it('ломать нечего — своя строка', () => {
    expect(spyDeed({ kind: 'sabotage', hits: [] })?.key).toBe('log.spy.sabotage.none');
  });
});

describe('правило 2 — кража называет добычу', () => {
  it('ресурс и сколько', () => {
    expect(spyDeed({ kind: 'theft', loot: { resource: 'metal', amount: 40 } })).toEqual({
      key: 'log.spy.theft',
      params: { res: 'metal', amount: 40 },
      lost: false,
    });
  });
  it('пустая казна — своя строка', () => {
    expect(spyDeed({ kind: 'theft', loot: null })?.key).toBe('log.spy.theft.none');
  });
});

describe('правило 3 — кража исследований называет технологию', () => {
  it('технология', () => {
    expect(spyDeed({ kind: 'research', tech: 'optics' })).toEqual({
      key: 'log.spy.research',
      params: { tech: 'optics' },
      lost: false,
    });
  });
  it('красть нечего — цель отстаёт', () => {
    expect(spyDeed({ kind: 'research', tech: null })?.key).toBe('log.spy.research.none');
  });
});

describe('правило 4 — гибель агента не прячется', () => {
  it('флаг переходит в строку', () => {
    expect(spyDeed({ kind: 'theft', loot: null, agentLost: true })?.lost).toBe(true);
  });
  it('не саботаж и не кража — ничего', () => {
    expect(spyDeed({ kind: 'recon' })).toBeNull();
  });
});
