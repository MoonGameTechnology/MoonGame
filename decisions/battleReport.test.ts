import { describe, expect, it } from 'vitest';
import { battleTailParts, foesPeak, headcount, hullLeft, newMedals, rewardParts } from './battleReport';

describe('battleReport — рапорт о своём бое', () => {
  it('считает юнитов в стеках, битое число — ноль', () => {
    expect(headcount([{ count: 3 }, { count: 2 }, {}, { count: -1 }])).toBe(5);
  });

  it('пик врагов растёт с подкреплением и не убывает от гибели (правило 1)', () => {
    let peak = foesPeak(0, 6, 0);
    expect(peak).toBe(6);
    peak = foesPeak(peak, 4, 2); // двое пали: было по-прежнему шесть
    expect(peak).toBe(6);
    peak = foesPeak(peak, 7, 2); // вступили ещё пятеро
    expect(peak).toBe(9);
  });

  it('корпус выживших: полный у стека без hp, мёртвые не входят (правила 2–3)', () => {
    const hp = (u: string) => (u === 'corvette' ? 100 : 400);
    expect(
      hullLeft(
        [
          { unit: 'corvette', count: 2, hp: 150 },
          { unit: 'cruiser', count: 1 },
          { unit: 'cruiser', count: 0, hp: 0 },
        ],
        hp,
      ),
    ).toEqual({ current: 550, max: 600 });
  });

  it('хвост итога: враги и корпус, без пустых частей (правило 4)', () => {
    expect(battleTailParts({ foes: 9, destroyed: 7, hull: { current: 340.4, max: 500 } })).toEqual([
      { key: 'log.battle.foes', params: { n: 9, k: 7 } },
      { key: 'log.battle.hull', params: { cur: 340, max: 500, pct: 68 } },
    ]);
    expect(battleTailParts({ foes: 0, destroyed: 0 })).toEqual([]);
    expect(battleTailParts({ foes: 3, destroyed: 5, hull: { current: 0, max: 0 } })).toEqual([
      { key: 'log.battle.foes', params: { n: 3, k: 3 } },
    ]);
  });

  it('новая медаль — только та, которой не было до боя (правило 5)', () => {
    const before = ['corvette|medal.valour.1', 'corvette|medal.valour.1'];
    const after = ['corvette|medal.valour.1', 'corvette|medal.valour.1', 'corvette|medal.valour.1', 'cruiser|medal.service.1'];
    expect(newMedals(before, after)).toEqual(['corvette|medal.valour.1', 'cruiser|medal.service.1']);
    expect(newMedals(after, before)).toEqual([]);
  });

  it('награды: знак очков, выслуга, медали; нет наград — пусто', () => {
    expect(rewardParts({ points: 20, veterans: 4, medals: [{ medal: 'Искра', unit: 'Корвет' }] })).toEqual([
      { key: 'log.battle.reward.points', params: { sign: '+', n: 20 } },
      { key: 'log.battle.reward.service', params: { n: 4 } },
      { key: 'log.battle.reward.medal', params: { medal: 'Искра', unit: 'Корвет' } },
    ]);
    expect(rewardParts({ points: -12, veterans: 0, medals: [] })).toEqual([
      { key: 'log.battle.reward.points', params: { sign: '−', n: 12 } },
    ]);
    expect(rewardParts({ points: 0, veterans: 0, medals: [] })).toEqual([]);
  });
});
