import { describe, expect, it } from 'vitest';
import { veteranMark, fleetVeteranGrade } from './veteranMark';
import { shippedGameData } from '../data/bundle';
import { setLocale } from '../localization/core';

const data = shippedGameData();
setLocale('ru');

describe('шевроны ветерана', () => {
  it('новичок — без шевронов', () => {
    expect(veteranMark({ unit: 'cruiser', count: 2 }, data, true)).toBeNull();
    expect(veteranMark({ unit: 'cruiser', count: 2, battles: 0.5 }, data, true)).toBeNull();
  });

  it('шевронов столько, сколько степеней «Выслуги» — до потолка шкалы', () => {
    expect(veteranMark({ unit: 'cruiser', count: 1, battles: 1 }, data, false)?.grade).toBe(1);
    expect(veteranMark({ unit: 'cruiser', count: 1, battles: 3 }, data, false)?.grade).toBe(3);
    expect(veteranMark({ unit: 'cruiser', count: 1, battles: 9 }, data, false)?.grade).toBe(
      data.medals.service!.grades.length,
    );
  });

  it('бонус в подписи — только там, где выслуга даёт силу (Sector Zero, VET-6)', () => {
    const vet = { unit: 'cruiser', count: 1, battles: 3 };
    const sz = veteranMark(vet, data, true)!;
    const net = veteranMark(vet, data, false)!;
    expect(sz.title).toContain('3');
    expect(sz.title).toContain(`+${Math.round(data.veteran.damagePerBattle * 300)}%`);
    expect(net.title).not.toContain('%');
  });

  it('флот: высшая степень среди стеков, выбитые стеки не в счёт', () => {
    expect(fleetVeteranGrade([{ unit: 'cruiser', count: 3 }], data)).toBe(0);
    expect(
      fleetVeteranGrade(
        [
          { unit: 'cruiser', count: 3 },
          { unit: 'frigate', count: 1, battles: 2 },
          { unit: 'cruiser', count: 0, battles: 4 },
        ],
        data,
      ),
    ).toBe(2);
  });
});
