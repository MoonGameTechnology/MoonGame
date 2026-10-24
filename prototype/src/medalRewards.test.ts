import { afterAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { TUTORIAL_MEDAL } from './profileArt';
import { medalRewardsHtml } from './medalRewards';

afterAll(() => setLocale('ru'));

const first = {
  medalId: 'first' as const,
  grade: 3 as const,
  sovereigns: 10,
  warrants: 20,
  xp: 50,
};
const tutorial = {
  medalId: 'tutorial' as const,
  grade: 3 as const,
  sovereigns: 10,
  warrants: 0,
  xp: 0,
};

describe('medal reward window', () => {
  it('one row per degree; a zero part is left out; the total appears for two rows and more', () => {
    setLocale('ru');
    const one = medalRewardsHtml([first]);
    expect(one).toContain('Первый рубеж');
    expect(one).toContain('III степень');
    expect(one).toContain('+10 ◆ · +20 ⌖ · +50 опыта');
    expect(one).not.toContain('Всего');
    const two = medalRewardsHtml([first, tutorial]);
    expect(two).toContain(TUTORIAL_MEDAL);
    expect(two).toContain('<em>+10 ◆</em>');
    expect(two).toContain('Всего: +20 ◆ · +20 ⌖ · +50 опыта');
    expect(two).toContain('data-mreward="ok"');
  });

  it('has no raw keys in either locale', () => {
    for (const locale of ['ru', 'en'] as const) {
      setLocale(locale);
      expect(medalRewardsHtml([first, tutorial])).not.toMatch(/profile\.(medal|grade|reward)/);
    }
    expect(medalRewardsHtml([first])).toContain('+50 XP');
  });
});
