import { describe, it, expect } from 'vitest';
import { introFor } from './introTrigger';

describe('обучающие вставки — какой приказ что объясняет', () => {
  it('первый курс в сетевой партии объясняет, что мир идёт без игрока', () => {
    expect(introFor('fleet.move', false, true)).toBe('asyncDelay');
  });

  it('первое отступление объясняет отход', () => {
    expect(introFor('fleet.retreat', false, true)).toBe('retreat');
  });

  it('СПИСОК ЗАКРЫТ: приказ без своей вставки не поднимает ничего', () => {
    expect(introFor('fleet.split', false, true)).toBeNull();
    expect(introFor('build.start', false, true)).toBeNull();
    expect(introFor('', false, true)).toBeNull();
  });
});

describe('обучающие вставки — тур владеет экраном', () => {
  it('ВО ВРЕМЯ ТУРА ВСТАВКИ МОЛЧАТ: двум учителям разом игрок не внемлет', () => {
    expect(introFor('fleet.move', true, true)).toBeNull();
    expect(introFor('fleet.retreat', true, true)).toBeNull();
  });

  it('после тура те же приказы снова учат', () => {
    expect(introFor('fleet.move', false, true)).toBe('asyncDelay');
  });
});

describe('обучающие вставки — только правда режима (правило 4)', () => {
  // Заказ владельца 2026-09-24: «убрать сообщение "мир идёт без вас"». В соло (схватка,
  // забег Sector Zero) мир без игрока стоит, а флот летит секундами — вставка лгала.
  it('в соло первый курс «Мир идёт без вас» не поднимает', () => {
    expect(introFor('fleet.move', false, false)).toBeNull();
  });

  it('прочие вставки от режима не зависят', () => {
    expect(introFor('fleet.retreat', false, false)).toBe('retreat');
  });
});
