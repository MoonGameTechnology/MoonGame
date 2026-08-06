import { describe, it, expect } from 'vitest';
import {
  CONTACT_FLOOR,
  CONTACT_FLASH_MS,
  contactAlpha,
  contactLost,
  episodeKey,
  forgetEnded,
  freshEpisodes,
  hourBucket,
  paintedThisFrame,
  sweptArc,
} from './alerts';

const HOUR = 3_600_000;
const TAU = Math.PI * 2;

describe('оповещения — часовой дроссель', () => {
  it('внутри часа корзина не меняется, за границей — меняется', () => {
    expect(hourBucket(0, HOUR)).toBe(hourBucket(HOUR - 1, HOUR));
    expect(hourBucket(HOUR, HOUR)).not.toBe(hourBucket(HOUR - 1, HOUR));
  });

  it('соседние кадры одного часа дают одну корзину — обход не идёт по кадрам', () => {
    const frames = [0, 16, 33, 500, 90_000].map((ms) => hourBucket(HOUR + ms, HOUR));
    expect(new Set(frames).size).toBe(1);
  });
});

describe('оповещения — эпизоды', () => {
  it('ключ различает и узел, и флот', () => {
    expect(episodeKey('C1R1', 'f1')).not.toBe(episodeKey('C1R1', 'f2'));
    expect(episodeKey('C1R1', 'f1')).not.toBe(episodeKey('C2R2', 'f1'));
  });

  it('первый раз звеним, второй — молчим', () => {
    const mem = new Set<string>();
    expect(freshEpisodes(mem, ['a', 'b'])).toEqual(['a', 'b']);
    expect(freshEpisodes(mem, ['a', 'b'])).toEqual([]);
  });

  it('новый гость среди старых — объявляется только он', () => {
    const mem = new Set(['a']);
    expect(freshEpisodes(mem, ['a', 'b'])).toEqual(['b']);
  });

  it('эпизод кончился — забыт; вернулся — это НОВЫЙ подход, и он звенит', () => {
    const mem = new Set<string>();
    freshEpisodes(mem, ['a']);
    forgetEnded(mem, new Set()); // флот ушёл
    expect(freshEpisodes(mem, ['a'])).toEqual(['a']); // вернулся — тревога снова
  });

  it('пока флот на месте, память его держит', () => {
    const mem = new Set<string>();
    freshEpisodes(mem, ['a']);
    forgetEnded(mem, new Set(['a']));
    expect(freshEpisodes(mem, ['a'])).toEqual([]);
  });

  it('чужие эпизоды не вычищаются вместе с одним закончившимся', () => {
    const mem = new Set<string>();
    freshEpisodes(mem, ['a', 'b']);
    forgetEnded(mem, new Set(['b']));
    expect(mem).toEqual(new Set(['b']));
  });
});

describe('развёртка — пересечение угла', () => {
  it('угол внутри пройденной дуги — засечка', () => {
    expect(sweptArc(0.1, 0.5, 0.3)).toBe(true);
  });

  it('угол вне дуги — тишина', () => {
    expect(sweptArc(0.1, 0.5, 1.2)).toBe(false);
    expect(sweptArc(0.1, 0.5, 0.05)).toBe(false);
  });

  it('ПЕРЕХОД ЧЕРЕЗ НОЛЬ не теряет засечку', () => {
    expect(sweptArc(TAU - 0.1, 0.1, 0)).toBe(true);
    expect(sweptArc(TAU - 0.1, 0.1, TAU - 0.05)).toBe(true);
    expect(sweptArc(TAU - 0.1, 0.1, 0.05)).toBe(true);
  });

  it('цель за пределами круга приводится к кругу', () => {
    expect(sweptArc(0.1, 0.5, 0.3 + TAU)).toBe(true);
    expect(sweptArc(0.1, 0.5, 0.3 - TAU)).toBe(true);
  });

  it('первого кадра не было — не засекаем разом всю карту', () => {
    expect(sweptArc(-1, 1, 0.5)).toBe(false);
  });

  it('рука не двигалась — засечки нет', () => {
    expect(sweptArc(0.4, 0.4, 0.4)).toBe(false);
  });

  it('угол ровно на конце дуги засчитан, ровно на начале — нет (иначе двойная засечка)', () => {
    expect(sweptArc(0.1, 0.5, 0.5)).toBe(true);
    expect(sweptArc(0.1, 0.5, 0.1)).toBe(false);
  });
});

describe('развёртка — что она красит', () => {
  const arm = { x: 0, y: 0, r: 100 };

  it('в досягаемости и на пройденном угле — покрашено', () => {
    // точка справа от опоры — её угол 0, рука проходит его через стык круга
    expect(paintedThisFrame([arm], { x: 50, y: 0 }, TAU - 0.2, 0.2)).toBe(true);
  });

  it('дальше досягаемости руки — не покрашено, как бы она ни крутилась', () => {
    expect(paintedThisFrame([arm], { x: 500, y: 0 }, -0.2, 0.2)).toBe(false);
  });

  it('в досягаемости, но рука туда ещё не дошла — не покрашено', () => {
    expect(paintedThisFrame([arm], { x: 50, y: 0 }, 1, 2)).toBe(false);
  });

  it('несколько рук: достаточно ОДНОЙ, что и достаёт, и прошла', () => {
    const far = { x: 1000, y: 1000, r: 10 };
    expect(paintedThisFrame([far, arm], { x: 50, y: 0 }, TAU - 0.2, 0.2)).toBe(true);
  });

  it('рук нет — красить нечем', () => {
    expect(paintedThisFrame([], { x: 1, y: 1 }, 0, 1)).toBe(false);
  });

  it('первого кадра не было — развёртка молчит, даже накрыв цель', () => {
    expect(paintedThisFrame([arm], { x: 50, y: 0 }, -1, 0.2)).toBe(false);
  });

  it('точка ровно на границе диска ещё покрывается', () => {
    expect(paintedThisFrame([arm], { x: 100, y: 0 }, TAU - 0.2, 0.2)).toBe(true);
  });
});

describe('радарная память — жизнь отметки', () => {
  it('свежая засечка горит ярко', () => {
    expect(contactAlpha(0)).toBe(1);
  });

  it('вспышка гаснет до тусклого призрака, но не в ноль', () => {
    expect(contactAlpha(CONTACT_FLASH_MS)).toBe(CONTACT_FLOOR);
    expect(contactAlpha(CONTACT_FLASH_MS * 10)).toBe(CONTACT_FLOOR);
  });

  it('яркость падает монотонно', () => {
    const a = contactAlpha(100);
    const b = contactAlpha(700);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(CONTACT_FLOOR - 1e-9);
  });

  it('отметка живёт дольше одного оборота — призрак держится до следующего прохода', () => {
    const period = 10_000;
    expect(contactLost(period, period)).toBe(false);
    expect(contactLost(period * 1.2, period)).toBe(false);
  });

  it('целый оборот с запасом без подтверждения — контакт потерян', () => {
    const period = 10_000;
    expect(contactLost(period * 1.3, period)).toBe(true);
  });
});
