// REFM-17 — сторож правила «цвет = отношение» и санитайзера цвета.
//
// Два утверждения, которые дороже всего проверять глазами: настройка палитры доходит до
// ОБОИХ представлений (иначе игрок с цветослепотой чинит только карту, а экран
// дипломатии остаётся в красно-зелёной ловушке), и подменённый цвет не втекает в
// разметку.
import { describe, it, expect } from 'vitest';
import type { DiplomaticStance } from '../../packages/shared-core/src/index';
import {
  RELATION_SCHEMES,
  isPaletteId,
  paletteOf,
  relationColor,
  safeHexColor,
  stanceColor,
} from './sideColors';

const STANCES: DiplomaticStance[] = ['war', 'peace', 'pact', 'alliance'];

describe('карта: три состояния, пакт и союз слиты', () => {
  it('война — цвет войны, мир — цвет мира', () => {
    const p = paletteOf('classic');
    expect(relationColor('war', p)).toBe(p.war);
    expect(relationColor('peace', p)).toBe(p.peace);
  });

  it('пакт и союз на карте НЕ различаются — оба «дружественный блок»', () => {
    const p = paletteOf('classic');
    expect(relationColor('pact', p)).toBe(p.bloc);
    expect(relationColor('alliance', p)).toBe(p.bloc);
  });
});

describe('дипломатия: четыре стойки — четыре различимых цвета', () => {
  for (const id of Object.keys(RELATION_SCHEMES)) {
    it(`палитра «${id}» не красит две стойки одинаково`, () => {
      const p = paletteOf(id);
      const cols = STANCES.map((st) => stanceColor(st, p));
      expect(new Set(cols).size).toBe(STANCES.length);
    });
  }
});

describe('настройка палитры доходит до ОБОИХ представлений', () => {
  it('cvd меняет цвет войны и на карте, и на чипе стойки', () => {
    // Тот самый разъезд, ради которого таблица одна: раньше палитру знала только карта.
    const classic = paletteOf('classic');
    const cvd = paletteOf('cvd');
    expect(relationColor('war', cvd)).not.toBe(relationColor('war', classic));
    expect(stanceColor('war', cvd)).not.toBe(stanceColor('war', classic));
  });

  it('в cvd союз не зелёный — иначе рядом с войной это красно-зелёная ловушка', () => {
    const cvd = paletteOf('cvd');
    // Okabe–Ito: враг — вермилион, дружественная пара — два синих.
    expect(cvd.alliance).toBe('#0072b2');
    expect(cvd.pact).toBe('#56b4e9');
  });
});

describe('незнакомая палитра', () => {
  it('вырождается в классическую, а не роняет отрисовку', () => {
    expect(paletteOf('нет-такой')).toBe(RELATION_SCHEMES.classic);
    expect(paletteOf(null)).toBe(RELATION_SCHEMES.classic);
    expect(paletteOf(undefined)).toBe(RELATION_SCHEMES.classic);
  });

  it('isPaletteId не принимает унаследованные свойства Object', () => {
    expect(isPaletteId('classic')).toBe(true);
    expect(isPaletteId('constructor')).toBe(false);
    expect(isPaletteId('toString')).toBe(false);
  });
});

describe('safeHexColor — санитайзер инлайнового цвета', () => {
  it('пропускает литеральный #rrggbb', () => {
    expect(safeHexColor('#ff5a4d', '#000000')).toBe('#ff5a4d');
    expect(safeHexColor('#FF5A4D', '#000000')).toBe('#FF5A4D');
  });

  it('всё остальное вырождается в доверенное умолчание', () => {
    for (const bad of [
      'red',
      '#fff',
      '#ff5a4d;background:url(x)',
      'red" onmouseover="alert(1)',
      '#ff5a4d ',
      '',
      null,
      undefined,
    ]) {
      expect(safeHexColor(bad, '#123456')).toBe('#123456');
    }
  });
});
