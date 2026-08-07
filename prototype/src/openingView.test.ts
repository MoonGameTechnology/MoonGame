import { describe, it, expect } from 'vitest';
import { HOME_ZOOM, openingView, pickHome, type WorldLike } from './openingView';

const world = (owner: string | null, buildings: number, x = 0): WorldLike => ({
  owner,
  buildings: Array.from({ length: buildings }, (_, i) => i),
  position: { x, y: 0 },
});

describe('стартовый вид — какой мир считается домом', () => {
  it('ДОМ — ЭТО СВОЙ ЗАСТРОЕННЫЙ МИР, а не первый попавшийся свой', () => {
    const worlds = [world('me', 0, 1), world('me', 2, 2), world('them', 5, 3)];
    expect(pickHome(worlds, 'me')?.position.x).toBe(2);
  });

  it('чужой застроенный мир домом не станет', () => {
    expect(pickHome([world('them', 9, 7)], 'me')).toBeNull();
  });

  it('НЕТ ЗАСТРОЕННОГО — ГОДИТСЯ ЛЮБОЙ СВОЙ: матч открывают и в разгар потерь', () => {
    const worlds = [world('them', 3, 1), world('me', 0, 5)];
    expect(pickHome(worlds, 'me')?.position.x).toBe(5);
  });

  it('ничейный мир домом не считается', () => {
    expect(pickHome([world(null, 4, 1)], 'me')).toBeNull();
  });

  it('нет своих миров вовсе — дома нет, и это не сбой', () => {
    expect(pickHome([], 'me')).toBeNull();
    expect(pickHome([world('them', 1)], 'me')).toBeNull();
  });

  it('порядок обхода — порядок списка: один и тот же список даёт один и тот же дом', () => {
    const worlds = [world('me', 1, 10), world('me', 1, 20)];
    expect(pickHome(worlds, 'me')?.position.x).toBe(10);
    expect(pickHome([...worlds].reverse(), 'me')?.position.x).toBe(20);
  });
});

describe('стартовый вид — куда встаёт камера', () => {
  it('ТЕЛЕФОН ОТКРЫВАЕТСЯ У ДОМА: плотную карту целиком на нём не прочесть', () => {
    const home = world('me', 2, 42);
    expect(openingView(true, home)).toEqual({
      kind: 'home',
      at: { x: 42, y: 0 },
      scale: HOME_ZOOM,
    });
  });

  it('ШИРОКИЙ ЭКРАН ОТКРЫВАЕТСЯ ОБЗОРОМ, даже когда дом есть', () => {
    expect(openingView(false, world('me', 2))).toEqual({ kind: 'whole-map' });
  });

  it('дома нет — обзор всей карты на любом экране, а не пустой вид', () => {
    expect(openingView(true, null)).toEqual({ kind: 'whole-map' });
    expect(openingView(false, null)).toEqual({ kind: 'whole-map' });
  });

  it('приближение задано множителем к вписыванию, а не в пикселях', () => {
    expect(HOME_ZOOM).toBeGreaterThan(1);
  });
});
