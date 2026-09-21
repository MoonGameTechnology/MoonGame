import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { freshSectorZeroProgress, type SectorZeroProgress } from './sectorZeroProgress';
import { workshopRows, forgeLadder } from './sectorZeroWorkshop';

const data = shippedGameData();
const profile = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
  ...freshSectorZeroProgress(data, 'profile-7'),
  ...over,
});

describe('sectorZeroWorkshop — что видно ДО подтверждения', () => {
  it('показывает только ОТКРЫТЫЕ модули: чужого в мастерской нет', () => {
    const rows = workshopRows(profile(), data);
    expect(rows.map((r) => r.id).sort()).toEqual([...profile().modules].sort());
  });

  it('цена и шанс следующей ступени видны, даже когда денег нет', () => {
    // `EC-2.3`: игрок обязан понимать стоимость до того, как сможет заплатить —
    // это требование сторов, а не удобство.
    const [row] = workshopRows(profile({ warrants: 0 }), data);
    const step = forgeLadder(data).steps[0]!;
    expect([row!.chance, row!.warrants]).toEqual([step.chance, step.warrants]);
    expect([row!.can, row!.reason]).toEqual([false, 'E_FORGE_NOT_ENOUGH']);
  });

  it('показывает, что даст звезда: вклад сейчас и вклад после', () => {
    const cap = forgeLadder(data).cap;
    const [row] = workshopRows(profile({ warrants: 9999 }), data);
    expect(row!.next!.cargoCapacity!).toBeGreaterThan(row!.now.cargoCapacity!);
    // На потолке «после» нет — предлагать нечего, а не «то же самое ещё раз».
    const [top] = workshopRows(
      profile({ warrants: 9999, stars: { cargo_bay: cap, ion_engine: cap } }),
      data,
    );
    expect([top!.can, top!.reason, top!.next]).toEqual([false, 'E_FORGE_AT_CAP', null]);
  });

  it('хватает денег — кнопка живая', () => {
    const [row] = workshopRows(profile({ warrants: 9999 }), data);
    expect([row!.can, row!.reason]).toEqual([true, null]);
  });

  it('пустая лестница выключает мастерскую целиком, без флага в коде', () => {
    const bare = { ...data, sectorZeroStars: { cap: 0, guaranteed: 0, steps: [] } };
    expect(workshopRows(profile({ warrants: 9999 }), bare)).toEqual([]);
  });
});
