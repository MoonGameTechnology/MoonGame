import { describe, it, expect } from 'vitest';
import { swarmJournal } from './swarmJournal';

// PVR-4.5 — три уровня уверенности. Ни один не заглядывает в состояние Роя: всё, что
// здесь есть, игрок замерил сам.

const seen = (over: Partial<Parameters<typeof swarmJournal>[0] & object> = {}) => ({
  firstAt: 100,
  lastAt: 500,
  sorties: 2,
  firstDamage: 4,
  lastDamage: 4,
  ...over,
});

describe('журнал адаптаций', () => {
  it('без наблюдений — честное «не разведано», а не выдуманный процент', () => {
    expect(swarmJournal(undefined)).toEqual([{ tier: 'unknown', key: 'swarm.journal.unknown' }]);
  });

  it('пустая запись читается как отсутствие наблюдений', () => {
    expect(swarmJournal(seen({ sorties: 0 }))[0]?.tier).toBe('unknown');
  });

  it('отражённый вылет — ФАКТ, с собственными замерами игрока', () => {
    const rows = swarmJournal(seen());
    expect(rows[0]).toEqual({
      tier: 'fact',
      key: 'swarm.journal.intercept',
      vars: { n: 2, at: 100 },
    });
  });

  it('при том же уроне гипотезы НЕТ — «тот же самый» это не «усилился»', () => {
    expect(swarmJournal(seen()).map((r) => r.tier)).toEqual(['fact']);
  });

  it('выросший урон ПВО даёт гипотезу — и она помечена гипотезой, а не фактом', () => {
    const rows = swarmJournal(seen({ firstDamage: 4, lastDamage: 11 }));
    expect(rows.map((r) => r.tier)).toEqual(['fact', 'hypothesis']);
    expect(rows[1]?.vars).toEqual({ from: 4, to: 11 });
  });

  it('упавший урон гипотезу не заводит', () => {
    expect(swarmJournal(seen({ firstDamage: 9, lastDamage: 3 })).map((r) => r.tier)).toEqual([
      'fact',
    ]);
  });

  it('порядок строк фиксирован: факт раньше гипотезы', () => {
    const rows = swarmJournal(seen({ lastDamage: 99 }));
    expect(rows[0]?.tier).toBe('fact');
    expect(rows[1]?.tier).toBe('hypothesis');
  });

  it('уровень модуля в журнал НЕ попадает ни под каким видом', () => {
    const flat = JSON.stringify(swarmJournal(seen({ lastDamage: 99 })));
    expect(flat).not.toContain('level');
    expect(flat).not.toContain('star');
  });
});
