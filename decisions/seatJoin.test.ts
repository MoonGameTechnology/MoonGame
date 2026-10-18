import { describe, expect, it } from 'vitest';
import { startEnabled } from './seatJoin';

describe('когда можно входить', () => {
  it('ДОМ НЕ ВЫБРАН — КНОПКА ЗАПЕРТА: иначе сервер выдал бы любое свободное место', () => {
    expect(startEnabled(null)).toBe(false);
  });

  it('дом выбран — можно', () => {
    expect(startEnabled('p3')).toBe(true);
  });
});
