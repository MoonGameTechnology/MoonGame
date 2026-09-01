import { describe, expect, it } from 'vitest';
import {
  attentionTotal,
  countShown,
  battleConcernsMe,
  myBattleCount,
  railBadge,
  type BattleLike,
} from './attentionBadges';

const battle = (attacker: string, defender: string, location: string): BattleLike => ({
  attacker: { owner: attacker },
  defender: { owner: defender },
  location,
});

const seen =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id);
const blind = () => false;

describe('battleConcernsMe', () => {
  it('counts a battle I attack in', () => {
    expect(battleConcernsMe(battle('me', 'them', 'x'), 'me', blind)).toBe(true);
  });

  it('counts a battle I defend in', () => {
    expect(battleConcernsMe(battle('them', 'me', 'x'), 'me', blind)).toBe(true);
  });

  // Правило 1: наблюдаемая чужая война — тоже обстановка вокруг игрока.
  it("counts someone else's battle at a place I identify", () => {
    expect(battleConcernsMe(battle('a', 'b', 'x'), 'me', seen('x'))).toBe(true);
  });

  it("ignores someone else's battle behind the fog", () => {
    expect(battleConcernsMe(battle('a', 'b', 'x'), 'me', seen('y'))).toBe(false);
  });

  // Своя война видна и там, куда взгляд не достаёт.
  it('counts my own battle even in the fog', () => {
    expect(battleConcernsMe(battle('me', 'b', 'far'), 'me', seen('near'))).toBe(true);
  });
});

describe('myBattleCount', () => {
  it('counts only the battles that concern me', () => {
    const all = [
      battle('me', 'a', 'p1'),
      battle('a', 'b', 'p2'), // видимый чужой
      battle('a', 'b', 'p3'), // за туманом
      battle('b', 'me', 'p4'),
    ];
    expect(myBattleCount(all, 'me', seen('p2'))).toBe(3);
  });

  it('is zero on an empty war', () => {
    expect(myBattleCount([], 'me', seen('p1'))).toBe(0);
  });

  // Туман выключен ⇒ known всегда true: считаются все бои на карте.
  it('counts every battle when nothing is hidden', () => {
    const all = [battle('a', 'b', 'p1'), battle('c', 'd', 'p2')];
    expect(myBattleCount(all, 'me', () => true)).toBe(2);
  });
});

describe('countShown', () => {
  // Правило 2: ноль прячется, а не рисуется цифрой «0».
  it('hides the badge at zero', () => {
    expect(countShown(0)).toBe(false);
  });

  it('shows the badge from one up', () => {
    expect(countShown(1)).toBe(true);
    expect(countShown(9)).toBe(true);
  });
});

describe('attentionTotal', () => {
  // Правило 3: сумма, не максимум — иначе меньшая стопка исчезает под большей.
  it('adds battles and unread mail', () => {
    expect(attentionTotal(3, 2)).toBe(5);
  });

  it('is zero when nothing waits', () => {
    expect(attentionTotal(0, 0)).toBe(0);
  });

  it('surfaces mail with no battles', () => {
    expect(attentionTotal(0, 2)).toBe(2);
  });
});

describe('railBadge', () => {
  // Правило 4: при открытой панели у каждого инструмента свой значок.
  it('stays empty while the rail is open', () => {
    expect(railBadge(5, true)).toBe('');
  });

  it('mirrors the total while the rail is closed', () => {
    expect(railBadge(5, false)).toBe('5');
  });

  // Правило 5: пустая строка — это и есть «скрыть».
  it('is empty when nothing waits', () => {
    expect(railBadge(0, false)).toBe('');
  });
});
