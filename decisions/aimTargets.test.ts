import { describe, it, expect } from 'vitest';
import { ownFleets, hostileFleets, mergeAnchors, deployPick, assaultTargetOk } from './aimTargets';

const ME = 'p1';
const флоты = [
  { id: 'a', owner: ME },
  { id: 'b', owner: ME },
  { id: 'c', owner: 'p2' },
  { id: 'd', owner: 'p3' },
];

describe('aimTargets — множества флотов', () => {
  it('свои — только мои (правила 3, 5)', () => {
    expect(ownFleets(флоты, ME).map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('чужие — все, кроме моих: и враг, и третья сторона (правило 2)', () => {
    expect(hostileFleets(флоты, ME).map((f) => f.id)).toEqual(['c', 'd']);
  });

  it('свои и чужие в сумме дают всех и не пересекаются', () => {
    const s = ownFleets(флоты, ME).length;
    const h = hostileFleets(флоты, ME).length;
    expect(s + h).toBe(флоты.length);
  });
});

describe('aimTargets — якорь слияния (правило 1)', () => {
  it('исключает уже выделенные — иначе флот слился бы сам с собой', () => {
    expect(mergeAnchors(флоты, ME, ['a']).map((f) => f.id)).toEqual(['b']);
  });

  it('выделены все свои — якоря нет вовсе', () => {
    expect(mergeAnchors(флоты, ME, ['a', 'b'])).toEqual([]);
  });

  it('чужие не становятся якорем, даже когда своих не выделено', () => {
    expect(mergeAnchors(флоты, ME, []).map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('aimTargets — высадка героя (правило 3)', () => {
  it('с абордажем корабль важнее мира', () => {
    expect(deployPick(true, true, true)).toBe('fleet');
  });

  it('БЕЗ абордажа мир под своим флотом остаётся миром', () => {
    expect(deployPick(false, true, true)).toBe('world');
  });

  it('без абордажа один только корабль под пальцем — это ничего', () => {
    expect(deployPick(false, true, false)).toBe('none');
  });

  it('с абордажем, но мимо корабля — берётся мир', () => {
    expect(deployPick(true, false, true)).toBe('world');
  });

  it('мимо всего — ничего, при любом перке', () => {
    expect(deployPick(true, false, false)).toBe('none');
    expect(deployPick(false, false, false)).toBe('none');
  });
});

describe('aimTargets — цель штурма (правило 4)', () => {
  it('чужой захватываемый мир годится', () => {
    expect(assaultTargetOk('p2', true, ME)).toBe(true);
  });

  it('свой мир штурмовать нечего', () => {
    expect(assaultTargetOk(ME, true, ME)).toBe(false);
  });

  it('ничей мир не годится — не у кого отнимать', () => {
    expect(assaultTargetOk(null, true, ME)).toBe(false);
    expect(assaultTargetOk(undefined, true, ME)).toBe(false);
  });

  it('незахватываемый сектор не годится даже у врага', () => {
    expect(assaultTargetOk('p2', false, ME)).toBe(false);
  });
});
