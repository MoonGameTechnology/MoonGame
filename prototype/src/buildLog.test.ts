import { describe, expect, it } from 'vitest';
import { FORTRESS_BUILDING, buildLogLine, type BuildLogKind } from './buildLog';

describe('правило 1 — три события, три текста, и «улучшено» называет уровень', () => {
  it('построено', () => {
    expect(buildLogLine('constructed', 'mine').key).toBe('log.build.done');
  });
  it('улучшено — свой ключ И подстановка уровня', () => {
    const l = buildLogLine('upgraded', 'mine');
    expect(l.key).toBe('log.build.upgraded');
    expect(l.needsLevel).toBe(true);
  });
  it('разрушено', () => {
    expect(buildLogLine('destroyed', 'mine').key).toBe('log.build.destroyed');
  });
  it('уровень нужен ТОЛЬКО улучшению', () => {
    expect(buildLogLine('constructed', 'mine').needsLevel).toBe(false);
    expect(buildLogLine('destroyed', 'mine').needsLevel).toBe(false);
  });
  it('ключи попарно различны', () => {
    const ключи = (['constructed', 'upgraded', 'destroyed'] as BuildLogKind[]).map(
      (k) => buildLogLine(k, 'mine').key,
    );
    expect(new Set(ключи).size).toBe(3);
  });
});

describe('правило 2 — якорь несёт только разрушение', () => {
  it('разрушение прыгает камерой', () => {
    expect(buildLogLine('destroyed', 'mine').anchored).toBe(true);
  });
  it.each(['constructed', 'upgraded'] as BuildLogKind[])('%s — без якоря', (k) => {
    expect(buildLogLine(k, 'mine').anchored).toBe(false);
  });
  it('якорь не зависит от здания', () => {
    for (const b of ['mine', FORTRESS_BUILDING, 'из-будущего'])
      expect(buildLogLine('destroyed', b).anchored).toBe(true);
  });
});

describe('правило 4 — зенитки включает только готовая крепость', () => {
  it('построенная крепость включает', () => {
    expect(buildLogLine('constructed', FORTRESS_BUILDING).installsFortressAA).toBe(true);
  });
  it('другая постройка не включает', () => {
    expect(buildLogLine('constructed', 'mine').installsFortressAA).toBe(false);
  });
  it('УЛУЧШЕННАЯ крепость не включает заново', () => {
    expect(buildLogLine('upgraded', FORTRESS_BUILDING).installsFortressAA).toBe(false);
  });
  it('РАЗРУШЕННАЯ крепость тем более не включает', () => {
    expect(buildLogLine('destroyed', FORTRESS_BUILDING).installsFortressAA).toBe(false);
  });
});

describe('полный перебор видов и зданий', () => {
  it('9 пар «вид × здание» непротиворечивы', () => {
    let n = 0;
    for (const kind of ['constructed', 'upgraded', 'destroyed'] as BuildLogKind[])
      for (const b of ['mine', FORTRESS_BUILDING, 'из-будущего']) {
        const l = buildLogLine(kind, b);
        // зенитки бывают только у построенной крепости
        expect(l.installsFortressAA).toBe(kind === 'constructed' && b === FORTRESS_BUILDING);
        // якорь — только у разрушения
        expect(l.anchored).toBe(kind === 'destroyed');
        // уровень — только у улучшения
        expect(l.needsLevel).toBe(kind === 'upgraded');
        n++;
      }
    expect(n).toBe(9);
  });
});
