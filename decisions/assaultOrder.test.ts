import { describe, expect, it } from 'vitest';
import { assaultSteps } from './assaultOrder';

describe('связка приказов штурма', () => {
  it('ШТУРМУЮТ С БЛИЖНЕЙ ОРБИТЫ: не там — перевод идёт первым, иначе ядро откажет', () => {
    expect(assaultSteps('far')).toEqual(['orbit-near', 'assault']);
    expect(assaultSteps(undefined)).toEqual(['orbit-near', 'assault']);
  });

  it('уже на ближней — лишний приказ не издаём', () => {
    expect(assaultSteps('near')).toEqual(['assault']);
  });

  it('ПОРЯДОК ВАЖЕН: сначала орбита, потом штурм — обратный порядок это отказ ядра', () => {
    const шаги = assaultSteps('far');
    expect(шаги.indexOf('orbit-near')).toBeLessThan(шаги.indexOf('assault'));
  });

  it('штурм в связке всегда ровно один — просьба одна, приказ штурма один', () => {
    for (const orbit of ['near', 'far', 'high', undefined])
      expect(assaultSteps(orbit).filter((x) => x === 'assault')).toHaveLength(1);
  });
});
