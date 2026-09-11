// MSB-1 — БОЙ СТАЛ СПИСКОМ СТОРОН.
//
// Что здесь закрепляется и почему именно так. Решение владельца (§0.0
// multiside-combat-roadmap.md) — бой на N сторон, где «три» частный случай, а не цель.
// Форма `Battle { attacker, defender }` выражает ровно двоих и третью сторону вместить
// не может физически. Список может.
//
// Роль при этом НЕ исчезает: от неё зависит, кто бьёт `attack`, а кто отвечает
// `defense`. Она переезжает в саму сторону (`role`), потому что при N сторонах
// «атакующий ↔ обороняющийся» перестаёт описывать бой целиком — атакующими могут быть
// сразу четверо, и у каждого своя роль.
//
// Этот кирпич меняет ТОЛЬКО форму. Правила деления урона, вступления в идущий бой и
// совместного штурма — MSB-2/3/4; здесь ни один исход не меняется, и весь существующий
// боевой набор тестов обязан быть зелёным без правки ожиданий.
import { describe, expect, it } from 'vitest';
import { attackerOf, defenderOf, sidesOf } from './battle';
import type { Battle } from './gameState';

const duel = (): Battle => ({
  id: 'battle:0',
  location: 'P',
  phase: 'orbital',
  sides: [
    { ref: { kind: 'fleet', fleetId: 'f1' }, owner: 'p1', role: 'attacker' as const },
    { ref: { kind: 'garrison', planetId: 'P' }, owner: 'p2', role: 'defender' as const },
  ],
  round: 0,
});

describe('MSB-1 — форма боя', () => {
  it('бой держит СПИСОК сторон, а не два именованных поля', () => {
    const b = duel();
    expect(Array.isArray(b.sides)).toBe(true);
    expect(b.sides).toHaveLength(2);
    expect(sidesOf(b)).toHaveLength(2);
  });

  it('РОЛЬ ПРИНАДЛЕЖИТ СТОРОНЕ: от неё зависит, бьёт она attack или defense', () => {
    const b = duel();
    expect(b.sides.map((s) => s.role)).toEqual(['attacker', 'defender']);
  });

  it('дуэль читается теми же двумя вопросами, что и раньше', () => {
    const b = duel();
    expect(attackerOf(b)?.owner).toBe('p1');
    expect(defenderOf(b)?.owner).toBe('p2');
  });

  it('порядок в списке роли не задаёт — спрашивают по role, а не по индексу', () => {
    const b = duel();
    const flipped: Battle = { ...b, sides: [...b.sides].reverse() };
    expect(attackerOf(flipped)?.owner).toBe('p1');
    expect(defenderOf(flipped)?.owner).toBe('p2');
  });

  it('СТОРОН МОЖЕТ БЫТЬ БОЛЬШЕ ДВУХ — форма это уже держит (правила придут в MSB-2/3)', () => {
    const five: Battle = {
      ...duel(),
      sides: ['p1', 'p2', 'p3', 'p4', 'p5'].map((owner, i) => ({
        ref: { kind: 'fleet' as const, fleetId: `f${i}` },
        owner,
        role: (i === 0 ? 'attacker' : 'defender') as 'attacker' | 'defender',
      })),
    };
    expect(five.sides).toHaveLength(5);
    expect(sidesOf(five).map((s) => s.owner)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });
});
