import { describe, it, expect } from 'vitest';
import { nextPick, samePick, tapCandidates, touchPick, type TapPick } from './tapCycle';

const флот = (id: string): TapPick => ({ kind: 'fleet', id });
const мир = (id: string): TapPick => ({ kind: 'planet', id });

describe('тап по карте — из чего выбираем', () => {
  it('МИР ИДЁТ ПОСЛЕ ФЛОТОВ, НО ИДЁТ: иначе флот на орбите навсегда закроет свой мир', () => {
    expect(tapCandidates(['f1', 'f2'], 'p1')).toEqual([флот('f1'), флот('f2'), мир('p1')]);
  });

  it('порядок флотов сохраняется — ближайший к пальцу остаётся первым', () => {
    expect(tapCandidates(['near', 'far'], null).map((c) => c.id)).toEqual(['near', 'far']);
  });

  it('нет мира под тапом — в стопке только флоты', () => {
    expect(tapCandidates(['f1'], null)).toEqual([флот('f1')]);
  });

  it('пустой космос — пустая стопка', () => {
    expect(tapCandidates([], null)).toEqual([]);
  });
});

describe('тап по карте — перебор стопки', () => {
  const стопка = tapCandidates(['f1', 'f2'], 'p1');

  it('ТАП ПО НОВОМУ МЕСТУ БЕРЁТ ВЕРХНЕГО: иначе он отдавал бы случайный номер стопки', () => {
    expect(nextPick(стопка, null)).toEqual(флот('f1'));
    expect(nextPick(стопка, флот('чужой'))).toEqual(флот('f1'));
  });

  it('ПОВТОРНЫЙ ТАП БЕРЁТ СЛЕДУЮЩЕГО — так стопка разбирается на месте', () => {
    expect(nextPick(стопка, флот('f1'))).toEqual(флот('f2'));
    expect(nextPick(стопка, флот('f2'))).toEqual(мир('p1'));
  });

  it('перебор идёт по кругу: с последнего снова на верхнего', () => {
    expect(nextPick(стопка, мир('p1'))).toEqual(флот('f1'));
  });

  it('ОДИН КАНДИДАТ ОСТАЁТСЯ ВЫБРАННЫМ: тап по своему флоту не снимает выделение', () => {
    expect(nextPick([флот('f1')], флот('f1'))).toEqual(флот('f1'));
  });

  it('ПУСТО — ЗНАЧИТ СНЯТЬ ВЫДЕЛЕНИЕ: тап по пустому космосу это осознанное «ничего»', () => {
    expect(nextPick([], флот('f1'))).toBeNull();
  });

  it('флот и мир с одним id — разные кандидаты, вид объекта тоже часть выбора', () => {
    const однобуквенная = tapCandidates(['x'], 'x');
    expect(nextPick(однобуквенная, флот('x'))).toEqual(мир('x'));
    expect(samePick(флот('x'), мир('x'))).toBe(false);
  });
});

describe('тап пальцем — без перебора', () => {
  it('ФЛОТ ВАЖНЕЕ МИРА: на телефоне тап по орбите — это приказ флоту, а не осмотр мира', () => {
    expect(touchPick('f1', 'p1')).toEqual(флот('f1'));
  });

  it('нет своего флота под пальцем — берём мир', () => {
    expect(touchPick(null, 'p1')).toEqual(мир('p1'));
  });

  it('пустой космос — ничего', () => {
    expect(touchPick(null, null)).toBeNull();
  });
});
