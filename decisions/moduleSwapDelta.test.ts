import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { moduleSwapDelta } from './moduleSwapDelta';

const data = shippedGameData();
const cruiser = data.units.heavy_cruiser!;

describe('moduleSwapDelta — что изменится у корабля от модуля плитки', () => {
  it('пустой отсек: прибавка модуля', () => {
    expect(moduleSwapDelta(cruiser, [], undefined, 'targeting_array', {}, data)).toEqual([
      { stat: 'attack', delta: 2 },
    ]);
  });

  it('занятый отсек: замена снимает старый модуль — есть и минус', () => {
    expect(
      moduleSwapDelta(
        cruiser,
        ['targeting_array', 'cargo_bay'],
        'targeting_array',
        'ablative_plating',
        {},
        data,
      ),
    ).toEqual([
      { stat: 'attack', delta: -2 },
      { stat: 'hp', delta: 6 },
    ]);
  });

  it('надетый модуль показывает свой вклад, а не ноль', () => {
    expect(
      moduleSwapDelta(cruiser, ['targeting_array'], 'targeting_array', 'targeting_array', {}, data),
    ).toEqual([{ stat: 'attack', delta: 2 }]);
  });

  it('звезда места множит вклад, как у построенного корабля', () => {
    const [plain] = moduleSwapDelta(cruiser, [], undefined, 'ablative_plating', {}, data);
    const [star] = moduleSwapDelta(
      cruiser,
      [],
      undefined,
      'ablative_plating',
      { moduleStars: { ablative_plating: 2 } },
      data,
    );
    expect(star!.delta).toBeGreaterThan(plain!.delta);
  });

  it('порядок — как в превью: атака раньше корпуса, остальное по алфавиту', () => {
    const stats = moduleSwapDelta(
      cruiser,
      ['siege_platform'],
      'siege_platform',
      'targeting_array',
      {},
      data,
    ).map((c) => c.stat);
    expect(stats).toEqual(['attack', 'siegeDamage']);
  });
});
