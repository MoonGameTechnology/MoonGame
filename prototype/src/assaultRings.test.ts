import { describe, it, expect } from 'vitest';
import { ringed, ringsShown } from './assaultRings';

describe('кольца штурма — когда слой вообще есть', () => {
  it('взведённый приказ показывает кольца', () => {
    expect(ringsShown(true)).toBe(true);
  });

  it('ВНЕ ВЗВЕДЁННОГО ПРИКАЗА КОЛЕЦ НЕТ: подсветка обещала бы приказ, которого нет', () => {
    expect(ringsShown(false)).toBe(false);
  });
});

describe('кольца штурма — какие миры обводятся', () => {
  it('чужой захватываемый мир обводится', () => {
    expect(ringed({ owner: 'p2', capturable: true }, 'p1')).toBe(true);
  });

  it('СВОЙ МИР НЕ ОБВОДИТСЯ: штурмовать собственный тыл незачем', () => {
    expect(ringed({ owner: 'p1', capturable: true }, 'p1')).toBe(false);
  });

  it('НИЧЕЙНЫЙ МИР НЕ ОБВОДИТСЯ: у пустого узла нет обороны, которую ломать', () => {
    expect(ringed({ owner: null, capturable: true }, 'p1')).toBe(false);
  });

  it('НЕЗАХВАТЫВАЕМЫЙ СЕКТОР НЕ ОБВОДИТСЯ: ядро такой приказ не даст', () => {
    expect(ringed({ owner: 'p2', capturable: false }, 'p1')).toBe(false);
  });

  it('свой незахватываемый — тем более нет', () => {
    expect(ringed({ owner: 'p1', capturable: false }, 'p1')).toBe(false);
  });

  it('третий игрок — такая же цель, как второй: правило про «не своё», а не про врага', () => {
    expect(ringed({ owner: 'p3', capturable: true }, 'p1')).toBe(true);
  });
});
