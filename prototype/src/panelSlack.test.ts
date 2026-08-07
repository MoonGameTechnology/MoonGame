import { describe, it, expect } from 'vitest';
import { SHEET_WIDTH_RATIO, panelSlackFor, type PanelRect } from './panelSlack';

const VW = 1000;
const VH = 800;
const rect = (over: Partial<PanelRect> = {}): PanelRect => ({
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  ...over,
});

describe('припуск камеры — когда его нет', () => {
  it('нет панели — нет припуска', () => {
    expect(panelSlackFor(null, VW, VH)).toEqual({});
  });

  it('СХЛОПНУТАЯ ПАНЕЛЬ НЕ ДАЁТ СЛАБИНЫ: она ничего не закрывает', () => {
    expect(panelSlackFor(rect({ width: 0 }), VW, VH)).toEqual({});
    expect(panelSlackFor(rect({ height: 0 }), VW, VH)).toEqual({});
  });
});

describe('припуск камеры — какая это панель', () => {
  it('ШИРОКАЯ ПАНЕЛЬ — НИЖНИЙ ЛИСТ: закрыта полоса снизу', () => {
    const slack = panelSlackFor(rect({ width: VW, height: 300, top: VH - 300 }), VW, VH);
    expect(slack).toEqual({ bottom: 300 });
  });

  it('УЗКАЯ ПАНЕЛЬ — ПРАВАЯ КОЛОНКА: закрыта полоса справа', () => {
    const slack = panelSlackFor(rect({ width: 280, height: VH, left: VW - 280 }), VW, VH);
    expect(slack).toEqual({ right: 280 });
  });

  it('решает измеренная ширина, а не признак устройства — граница на 70%', () => {
    const wide = rect({ width: VW * SHEET_WIDTH_RATIO, height: 200, top: 600, left: 0 });
    expect(panelSlackFor(wide, VW, VH).bottom).toBeDefined();
    const narrow = rect({ width: VW * SHEET_WIDTH_RATIO - 1, height: 200, top: 600, left: 0 });
    expect(narrow.width < VW * SHEET_WIDTH_RATIO).toBe(true);
    expect(panelSlackFor(narrow, VW, VH).right).toBeDefined();
  });
});

describe('припуск камеры — сколько именно', () => {
  it('лист: припуск равен закрытой полосе, а не высоте панели', () => {
    // панель выше экрана, но закрывает только то, что попало на экран
    expect(panelSlackFor(rect({ width: VW, height: 2000, top: 500 }), VW, VH)).toEqual({
      bottom: 300,
    });
  });

  it('колонка: припуск равен закрытой полосе, а не ширине панели', () => {
    expect(panelSlackFor(rect({ width: 200, height: VH, left: 900 }), VW, VH)).toEqual({
      right: 100,
    });
  });

  it('ПРИПУСК НЕ БЫВАЕТ ОТРИЦАТЕЛЬНЫМ: панель за краем экрана закрывает ноль', () => {
    expect(panelSlackFor(rect({ width: VW, height: 100, top: VH + 50 }), VW, VH)).toEqual({
      bottom: 0,
    });
    expect(panelSlackFor(rect({ width: 200, height: VH, left: VW + 50 }), VW, VH)).toEqual({
      right: 0,
    });
  });

  it('панель во весь экран закрывает его целиком', () => {
    expect(panelSlackFor(rect({ width: VW, height: VH, top: 0 }), VW, VH)).toEqual({ bottom: VH });
  });

  it('припуск даётся только по одной оси — панель закрывает одну сторону', () => {
    const sheet = panelSlackFor(rect({ width: VW, height: 300, top: 500 }), VW, VH);
    expect(sheet.right).toBeUndefined();
    const column = panelSlackFor(rect({ width: 280, height: VH, left: 720 }), VW, VH);
    expect(column.bottom).toBeUndefined();
  });
});
