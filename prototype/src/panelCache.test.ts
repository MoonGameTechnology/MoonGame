import { describe, it, expect } from 'vitest';
import { FORGOTTEN, panelChanged, afterRebuild, keepScroll } from './panelCache';

describe('panelCache — когда перестраивать (правило 1)', () => {
  it('та же разметка — не трогаем DOM', () => {
    expect(panelChanged('<div>a</div>', '<div>a</div>')).toBe(false);
  });

  it('другая разметка — перестраиваем', () => {
    expect(panelChanged('<div>b</div>', '<div>a</div>')).toBe(true);
  });

  it('первый кадр: кэш пуст, разметка есть — перестраиваем', () => {
    expect(panelChanged('<div>a</div>', '')).toBe(true);
  });

  it('пустая разметка при пустом кэше не считается изменением', () => {
    expect(panelChanged('', '')).toBe(false);
  });
});

describe('panelCache — досье гаснет вместе с листом (правило 2)', () => {
  it('после перестройки лист помнит разметку, а досье забыто', () => {
    expect(afterRebuild('<div>a</div>')).toEqual({ panel: '<div>a</div>', objDesc: '' });
  });

  it('забыть досье нельзя — оно в том же значении, что и новая разметка листа', () => {
    for (const html of ['', '<b>x</b>', '<div>очень длинная разметка</div>']) {
      expect(afterRebuild(html).objDesc, html).toBe('');
    }
  });
});

describe('panelCache — закрытый лист забывает всё (правило 3)', () => {
  it('и лист, и досье пусты', () => {
    expect(FORGOTTEN).toEqual({ panel: '', objDesc: '' });
  });

  // Сторож: после забвения ЛЮБАЯ непустая разметка обязана считаться изменением,
  // иначе повторно открытый лист останется пустым.
  it('после забвения следующая разметка всегда требует перестройки', () => {
    expect(panelChanged('<div>a</div>', FORGOTTEN.panel)).toBe(true);
  });
});

describe('panelCache — прокрутка (правило 4)', () => {
  it('ненулевую восстанавливаем', () => {
    expect(keepScroll(1)).toBe(true);
    expect(keepScroll(340)).toBe(true);
  });

  it('нулевую не пишем — это не восстановление, а лишняя запись', () => {
    expect(keepScroll(0)).toBe(false);
  });

  it('отрицательной не бывает, но и её не пишем', () => {
    expect(keepScroll(-5)).toBe(false);
  });
});
