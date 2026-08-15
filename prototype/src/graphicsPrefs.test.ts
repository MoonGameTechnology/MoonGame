import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// ПК-раскладка увеличивает интерфейс одним списком селекторов `zoom:var(--pcz)`. Окно,
// забытое в этом списке, едет 1× посреди 1.5× — игрок видит в нём чужой мелкий шрифт и
// никакой тест этого не замечает (`#buildwin` так и прожил). Окна-братья по оболочке
// `.twbox` объявлены в разметке одинаково, поэтому список сверяется с ней.
describe('CSS: ни одно окно не забыто в списке ПК-зума', () => {
  const css = readFileSync(fileURLToPath(new URL('../build.mjs', import.meta.url)), 'utf8');
  // Комментарии вырезаются ПЕРЕД разбором: они называют те же id (в т.ч. «#buildwin
  // здесь забыли»), и сканер, читающий их наравне с селекторами, охранял бы сам себя.
  const zoomList = css.slice(0, css.indexOf('{zoom:var(--pcz')).replace(/\/\*[\s\S]*?\*\//g, '');
  const zoomed = new Set(zoomList.slice(zoomList.lastIndexOf('@media')).match(/#[\w-]+/g) ?? []);

  it('список вообще найден — иначе сканер охраняет пустоту', () => {
    expect(zoomed.size).toBeGreaterThan(20);
  });

  it('каждое окно с оболочкой .twbox зумится вместе с остальным интерфейсом', () => {
    const windows = [...css.matchAll(/id="([\w-]+)"><div class="twbox"/g)].map((m) => m[1]);
    expect(windows.length).toBeGreaterThanOrEqual(4);
    for (const id of windows) expect(zoomed.has(`#${id}`), id).toBe(true);
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
