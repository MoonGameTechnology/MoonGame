import { describe, it, expect } from 'vitest';
import {
  fxBlur,
  glowOn,
  setGlowFx,
  starfieldOn,
  setStarfield,
  showFpsOn,
  setShowFps,
} from './graphicsPrefs';

// REFM-21. Модуль читает окружающее хранилище на импорте, поэтому тесты работают с ЖИВЫМ
// состоянием: каждый возвращает тумблер туда, где нашёл, — иначе порядок файлов начнёт
// влиять на результат.
function around<T>(read: () => boolean, write: (v: boolean) => void, body: () => T): T {
  const before = read();
  try {
    return body();
  } finally {
    write(before);
  }
}

describe('графика — кран размытия', () => {
  it('свечение включено — размытие проходит как есть', () => {
    around(glowOn, setGlowFx, () => {
      setGlowFx(true);
      expect(fxBlur(8)).toBe(8);
      expect(fxBlur(0)).toBe(0);
    });
  });

  it('свечение выключено — ЛЮБОЕ размытие обнуляется (не только диски свечения)', () => {
    around(glowOn, setGlowFx, () => {
      setGlowFx(false);
      expect(fxBlur(8)).toBe(0);
      expect(fxBlur(20)).toBe(0);
    });
  });

  it('кран переключается туда и обратно, не залипая', () => {
    around(glowOn, setGlowFx, () => {
      setGlowFx(false);
      expect(fxBlur(6)).toBe(0);
      setGlowFx(true);
      expect(fxBlur(6)).toBe(6);
    });
  });

  it('состояние крана и геттер не расходятся', () => {
    around(glowOn, setGlowFx, () => {
      setGlowFx(false);
      expect(glowOn()).toBe(false);
      expect(fxBlur(1)).toBe(0);
      setGlowFx(true);
      expect(glowOn()).toBe(true);
      expect(fxBlur(1)).toBe(1);
    });
  });
});

describe('графика — звёздное поле', () => {
  it('переключается и читается', () => {
    around(starfieldOn, setStarfield, () => {
      setStarfield(false);
      expect(starfieldOn()).toBe(false);
      setStarfield(true);
      expect(starfieldOn()).toBe(true);
    });
  });
});

describe('графика — счётчик кадров', () => {
  it('переключается и читается', () => {
    around(showFpsOn, setShowFps, () => {
      setShowFps(true);
      expect(showFpsOn()).toBe(true);
      setShowFps(false);
      expect(showFpsOn()).toBe(false);
    });
  });
});

describe('графика — независимость тумблеров', () => {
  it('выключенное свечение не гасит звёздное поле', () => {
    around(glowOn, setGlowFx, () =>
      around(starfieldOn, setStarfield, () => {
        setStarfield(true);
        setGlowFx(false);
        expect(starfieldOn()).toBe(true); // разные настройки — разные ключи
        expect(fxBlur(4)).toBe(0);
      }),
    );
  });
});
