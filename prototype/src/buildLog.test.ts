import { describe, expect, it } from 'vitest';
import { buildLogLine, type BuildLogKind } from './buildLog';

// ORB-3. Здесь было ПРАВИЛО 4: «готовый звёздный форт ставит миру зенитки», и под него
// строка ленты несла флаг `installsFortressAA`, а `main.ts` по этому флагу дописывала
// миру `orbital_aa`. Правила больше нет: орбитальное ПКО — самостоятельная постройка,
// которую исследуют (`orbital_defense_grid`) и строят, и выдать её иначе нельзя.
//
// Флаг снят из ТИПА `BuildLogLine`, а не оставлен в положении «всегда false»: пока поле
// существует, кто-то может снова на него ветвиться. Нет поля — не на что ветвиться, и
// вместе с ним ушёл аргумент `building`: вид здания на строку ленты не влияет вовсе.

describe('правило 1 — три события, три текста, и «улучшено» называет уровень', () => {
  it('построено', () => {
    expect(buildLogLine('constructed').key).toBe('log.build.done');
  });
  it('улучшено — свой ключ И подстановка уровня', () => {
    const l = buildLogLine('upgraded');
    expect(l.key).toBe('log.build.upgraded');
    expect(l.needsLevel).toBe(true);
  });
  it('разрушено', () => {
    expect(buildLogLine('destroyed').key).toBe('log.build.destroyed');
  });
  it('уровень нужен ТОЛЬКО улучшению', () => {
    expect(buildLogLine('constructed').needsLevel).toBe(false);
    expect(buildLogLine('destroyed').needsLevel).toBe(false);
  });
  it('ключи попарно различны', () => {
    const ключи = (['constructed', 'upgraded', 'destroyed'] as BuildLogKind[]).map(
      (k) => buildLogLine(k).key,
    );
    expect(new Set(ключи).size).toBe(3);
  });
});

describe('правило 2 — якорь несёт только разрушение', () => {
  it('разрушение прыгает камерой', () => {
    expect(buildLogLine('destroyed').anchored).toBe(true);
  });
  it.each(['constructed', 'upgraded'] as BuildLogKind[])('%s — без якоря', (k) => {
    expect(buildLogLine(k).anchored).toBe(false);
  });
});

describe('полный перебор видов', () => {
  it('три вида непротиворечивы — и НИ ОДИН ничего не тянет за собой', () => {
    let n = 0;
    for (const kind of ['constructed', 'upgraded', 'destroyed'] as BuildLogKind[]) {
      const l = buildLogLine(kind);
      // якорь — только у разрушения
      expect(l.anchored).toBe(kind === 'destroyed');
      // уровень — только у улучшения
      expect(l.needsLevel).toBe(kind === 'upgraded');
      // и БОЛЬШЕ НИЧЕГО: строка ленты рассказывает о событии, а не меняет мир
      expect(Object.keys(l).sort()).toEqual(['anchored', 'key', 'needsLevel']);
      n++;
    }
    expect(n).toBe(3);
  });
});
