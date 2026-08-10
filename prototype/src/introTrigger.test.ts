import { describe, it, expect } from 'vitest';
import { introFor } from './introTrigger';

describe('обучающие вставки — какой приказ что объясняет', () => {
  it('первый курс объясняет, что мир идёт без игрока', () => {
    expect(introFor('fleet.move', false)).toBe('asyncDelay');
  });

  it('первое отступление объясняет отход', () => {
    expect(introFor('fleet.retreat', false)).toBe('retreat');
  });

  it('первый залп объясняет артиллерию', () => {
    expect(introFor('fleet.barrage', false)).toBe('artillery');
  });

  it('СПИСОК ЗАКРЫТ: приказ без своей вставки не поднимает ничего', () => {
    expect(introFor('fleet.split', false)).toBeNull();
    expect(introFor('build.start', false)).toBeNull();
    expect(introFor('', false)).toBeNull();
  });
});

describe('обучающие вставки — тур владеет экраном', () => {
  it('ВО ВРЕМЯ ТУРА ВСТАВКИ МОЛЧАТ: двум учителям разом игрок не внемлет', () => {
    expect(introFor('fleet.move', true)).toBeNull();
    expect(introFor('fleet.retreat', true)).toBeNull();
    expect(introFor('fleet.barrage', true)).toBeNull();
  });

  it('после тура те же приказы снова учат', () => {
    expect(introFor('fleet.move', false)).toBe('asyncDelay');
  });
});
