import { describe, expect, it } from 'vitest';
import { joinHref, startEnabled } from './seatJoin';

describe('когда можно входить', () => {
  it('ДОМ НЕ ВЫБРАН — КНОПКА ЗАПЕРТА: иначе сервер выдал бы любое свободное место', () => {
    expect(startEnabled(null)).toBe(false);
  });

  it('дом выбран — можно', () => {
    expect(startEnabled('p3')).toBe(true);
  });
});

describe('ссылка входа с выбранным местом', () => {
  it('всё уходящее в адрес ЭКРАНИРУЕТСЯ', () => {
    expect(joinHref('/игра', 'матч 1', 'p 2', 'дом&дом')).toBe(
      '/%D0%B8%D0%B3%D1%80%D0%B0?join=%D0%BC%D0%B0%D1%82%D1%87%201&slot=p%202&faction=%D0%B4%D0%BE%D0%BC%26%D0%B4%D0%BE%D0%BC'
          .replace('/%D0%B8%D0%B3%D1%80%D0%B0', '/игра'),
    );
  });

  it('простой случай читается как обычная ссылка', () => {
    expect(joinHref('/index.html', 'proto', 'p1', 'azure')).toBe(
      '/index.html?join=proto&slot=p1&faction=azure',
    );
  });

  it('ФРАКЦИИ НЕТ — НЕТ И ПАРАМЕТРА: пустой `faction=` сервер прочтёт как заданную пустую', () => {
    expect(joinHref('/i', 'm', 's', null)).toBe('/i?join=m&slot=s');
    expect(joinHref('/i', 'm', 's', '')).toBe('/i?join=m&slot=s');
  });
});
