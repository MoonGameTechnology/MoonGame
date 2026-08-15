// HUD-DOCK: два дефекта низа экрана заперты тестами с разных сторон — логика режимов
// чистой моделью, а привязка ряда к листу сканом самой CSS: правило живёт в build.mjs
// строкой, у неё нет другого сторожа, и вернуть догадку в vh случайной правкой легко.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapIsWorkspace, panelOpen, sheetHeightVar, type DockState } from './hudDock';

const CALM: DockState = {
  aiming: false,
  merging: false,
  picking: false,
  chaining: false,
  hasSelection: true,
};

describe('панель уступает карте, когда игрок целится', () => {
  it('выделен объект и никакого прицела — лист открыт, хаб на месте', () => {
    expect(panelOpen(CALM)).toBe(true);
    expect(mapIsWorkspace(CALM)).toBe(false);
  });

  it('ЛЮБОЙ прицельный режим прячет лист — «Курс» тут наравне с остальными', () => {
    for (const mode of ['aiming', 'merging', 'picking', 'chaining'] as const) {
      const st = { ...CALM, [mode]: true };
      expect(mapIsWorkspace(st), mode).toBe(true);
      expect(panelOpen(st), mode).toBe(false);
    }
  });

  it('нечего показывать — лист закрыт, даже когда прицела нет', () => {
    expect(panelOpen({ ...CALM, hasSelection: false })).toBe(false);
  });

  it('прицел без выделения не открывает лист обратно', () => {
    expect(panelOpen({ ...CALM, hasSelection: false, aiming: true })).toBe(false);
  });
});

describe('высота листа уезжает в calc() — мусор туда пускать нельзя', () => {
  it('дробную высоту округляет: пол-пикселя ряду не нужны', () => {
    expect(sheetHeightVar(311.6)).toBe('312px');
    expect(sheetHeightVar(311.2)).toBe('311px');
  });

  it('ноль, отрицательное и не-число дают 0px, а не невалидное правило', () => {
    expect(sheetHeightVar(0)).toBe('0px');
    expect(sheetHeightVar(-40)).toBe('0px');
    expect(sheetHeightVar(Number.NaN)).toBe('0px');
    expect(sheetHeightVar(Number.POSITIVE_INFINITY)).toBe('0px');
  });
});

describe('CSS: ряд привязан к ЗАМЕРУ листа, а не к догадке в vh', () => {
  const css = readFileSync(fileURLToPath(new URL('../build.mjs', import.meta.url)), 'utf8');
  // Только правила, которые ПОДНИМАЮТ плавающий элемент над листом. Широкие раскладки
  // сажают ряд обратно на дно (bottom:14px), а один rule двигает #speedbar по горизонтали
  // (right:calc(...)) — им высота листа не нужна, и сканер не должен их трогать.
  const sheetRules = css
    .split('\n')
    .filter((l) => /body\.sheet-open\s+#(cmdbar|speedbar)\s*\{/.test(l) && /bottom:calc\(/.test(l));

  it('поднимающие правила вообще есть — иначе сканер молча охраняет пустоту', () => {
    expect(sheetRules.length).toBeGreaterThanOrEqual(3);
  });

  it('каждое поднимающее правило считает от --sheeth (vh только фолбэком внутри var)', () => {
    for (const rule of sheetRules) {
      expect(rule, rule.trim()).toMatch(/var\(--sheeth/);
      // Догадка вне var() — это ровно тот баг: лист ростом по содержимому, а ряд ушёл на 50vh.
      expect(rule.replace(/var\([^)]*\)/g, ''), rule.trim()).not.toMatch(/\d+vh/);
    }
  });

  it('нижний хаб уезжает и в прицельных режимах, не только в «Приказе»', () => {
    for (const el of ['#rail', '#speedbar', '#goals']) {
      expect(css, el).toMatch(new RegExp(`body\\.aim-mode\\s+${el}\\s*\\{`));
    }
  });
});

// ПК-зум и высота экрана — та же болезнь с другой стороны. Правила «влезь в окно»
// носили в себе константу 66.7vh («100vh ÷ 1.5»), а зум давно не всегда 1.5: лестница
// --pcz ставит 1.4…1.1, и на 1920×935 докованная панель уезжала на 36px ПОД нижний край
// окна вместе с концом очереди стройки. Живой браузер это ловит, гейт — нет, поэтому
// формулы сторожит скан.
describe('CSS: докованные слои ПК считают потолок от ВИДИМОГО окна', () => {
  const css = readFileSync(fileURLToPath(new URL('../build.mjs', import.meta.url)), 'utf8');
  // Селектор повторяется (телефонный базовый + ПК-докованный), поэтому ищем не «первое
  // правило про #side», а именно те, что считают от --vph.
  const vphRules = css.split('\n').filter((l) => l.includes('var(--vph)') && l.includes('{'));

  it('--vph выведена из живого зума, а не из зашитых «полутора»', () => {
    const decl = css.split('\n').find((l) => /--vph:/.test(l));
    expect(decl).toBeDefined();
    expect(decl).toMatch(/100dvh/);
    expect(decl).toMatch(/var\(--pcz\)/);
  });

  it('панель и список рейла упираются в --vph', () => {
    for (const sel of ['#side{', '#railtools{']) {
      const rule = vphRules.find((r) => r.includes(sel));
      expect(rule, sel).toBeDefined();
      expect(rule, sel).toMatch(/max-height:/);
    }
  });

  it('ни одно ПРАВИЛО больше не считает от 66.7vh (в комментариях — история, там можно)', () => {
    const live = css.split('\n').filter((l) => /66\.7vh/.test(l) && l.includes('{'));
    expect(live).toEqual([]);
  });
});
