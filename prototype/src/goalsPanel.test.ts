import { describe, it, expect } from 'vitest';
import {
  GOALS_BONUS_XP,
  goalsChanged,
  rewardDue,
  goalsCounter,
  goalsTrayHtml,
  goalsListHtml,
} from './goalsPanel';

describe('goalsPanel — награда', () => {
  it('платят, когда список выполнен и ещё не платили (правило 1)', () => {
    expect(rewardDue(true, false)).toBe(true);
  });

  it('второй раз не платят, хотя список так и остаётся выполненным (правило 1)', () => {
    expect(rewardDue(true, true)).toBe(false);
  });

  it('невыполненный список не платит ни при какой защёлке', () => {
    expect(rewardDue(false, false)).toBe(false);
    expect(rewardDue(false, true)).toBe(false);
  });

  it('сумма награды — одно число на весь список', () => {
    expect(GOALS_BONUS_XP).toBe(40);
  });
});

describe('goalsPanel — когда перерисовывать', () => {
  it('перерисовка только при изменении длины (правило 2)', () => {
    expect(goalsChanged(2, 3)).toBe(true);
    expect(goalsChanged(2, 2)).toBe(false);
    expect(goalsChanged(0, 0)).toBe(false);
  });
});

describe('goalsPanel — счётчик', () => {
  it('всегда «сделано/всего» (правило 4)', () => {
    expect(goalsCounter(0, 4)).toBe('0/4');
    expect(goalsCounter(4, 4)).toBe('4/4');
  });
});

describe('goalsPanel — разметка', () => {
  it('лоток несёт значок и счётчик, а подсказка экранируется (правила 3–5)', () => {
    const html = goalsTrayHtml('Цели <b>', 2, 4);
    expect(html).toContain('class="gl-tray"');
    expect(html).toContain('◎');
    expect(html).toContain('>2/4<');
    expect(html).toContain('title="Цели &lt;b&gt;"');
  });

  it('развёрнутый список отмечает выполненное галочкой, остальное кружком', () => {
    const html = goalsListHtml(
      'Цели',
      'свернуть',
      [
        { label: 'шахта', done: true },
        { label: 'флот', done: false },
      ],
      1,
    );
    expect(html).toContain('gl-item done');
    expect(html).toContain('✓');
    expect(html).toContain('○');
    expect(html).toContain('>1/2<');
  });

  it('подписи целей экранируются — они приходят из локали, а не из кода', () => {
    const html = goalsListHtml('Цели', 'свернуть', [{ label: '<img>', done: false }], 0);
    expect(html).toContain('&lt;img&gt;');
    expect(html).not.toContain('<img>');
  });

  it('счёт берётся ПЕРЕДАННЫЙ, а не выводится из строк — одна истина', () => {
    // если список выполненного и строки разойдутся, показать надо то, что ведёт firstGoals
    const html = goalsListHtml('Цели', 'свернуть', [{ label: 'шахта', done: false }], 3);
    expect(html).toContain('>3/1<');
  });

  it('пустой список не ломает разметку', () => {
    const html = goalsListHtml('Цели', 'свернуть', [], 0);
    expect(html).toContain('>0/0<');
    expect(html).toContain('class="gl-list"');
  });
});
