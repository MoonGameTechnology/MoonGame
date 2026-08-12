import { describe, it, expect } from 'vitest';
import { emblemTally, type UnitStack } from './fleetTally';

const крыло = (unit: string) => unit === 'fighter_squadron' || unit === 'bomber_squadron';
const st = (unit: string, count: number): UnitStack => ({ unit, count });
const считать = (units: UnitStack[], landing: UnitStack[] = []) =>
  emblemTally(units, landing, крыло);

describe('эмблема флота — корпуса и крыло', () => {
  it('флот без эскадрилий: все единицы — корабли', () => {
    expect(считать([st('cruiser', 3), st('scout', 1)])).toEqual({
      ships: 4,
      wingPips: 0,
      troops: 0,
    });
  });

  it('ЭСКАДРИЛЬИ НА БОРТУ — ГРУЗ: носитель с трюмом не должен читаться втрое большим', () => {
    expect(считать([st('cruiser', 2), st('fighter_squadron', 6)])).toEqual({
      ships: 2,
      wingPips: 6,
      troops: 0,
    });
  });

  it('ЧИСТОЕ КРЫЛО САМО ЕСТЬ ФЛОТ: иначе оно показало бы «0 кораблей»', () => {
    expect(считать([st('fighter_squadron', 4)])).toEqual({
      ships: 4,
      wingPips: 0,
      troops: 0,
    });
  });

  it('у чистого крыла нет хвоста груза — везти некому и не на чем', () => {
    expect(считать([st('fighter_squadron', 2), st('bomber_squadron', 3)]).wingPips).toBe(0);
  });

  it('ОДИН КОРПУС УЖЕ ПЕРЕКЛЮЧАЕТ КРЫЛО В ГРУЗ — развилка идёт по наличию, а не по большинству', () => {
    expect(считать([st('cruiser', 1), st('fighter_squadron', 9)])).toEqual({
      ships: 1,
      wingPips: 9,
      troops: 0,
    });
  });

  it('корпус с нулевым счётом корпусом не считается', () => {
    // нулевая стопка остаётся в состоянии после потерь: крыло обязано остаться флотом
    expect(считать([st('cruiser', 0), st('fighter_squadron', 5)])).toEqual({
      ships: 5,
      wingPips: 0,
      troops: 0,
    });
  });

  it('пустой флот даёт нули, а не отрицательные числа', () => {
    expect(считать([])).toEqual({ ships: 0, wingPips: 0, troops: 0 });
  });

  it('корабли и ромбики НИКОГДА не считают одну эскадрилью дважды', () => {
    for (const корпусов of [0, 1, 5])
      for (const крылатых of [0, 1, 7]) {
        const units = [st('cruiser', корпусов), st('fighter_squadron', крылатых)];
        const t = считать(units);
        expect(t.ships + t.wingPips).toBe(корпусов + крылатых);
      }
  });
});

describe('эмблема флота — десант', () => {
  it('ДЕСАНТ СЧИТАЕТСЯ ОТДЕЛЬНО: он решает судьбу мира, а не бой в космосе', () => {
    const t = считать([st('cruiser', 2)], [st('militia', 3), st('marine', 1)]);
    expect(t).toEqual({ ships: 2, wingPips: 0, troops: 4 });
  });

  it('десант не влияет на развилку «корпуса или крыло»', () => {
    const без = считать([st('fighter_squadron', 4)]);
    const с = считать([st('fighter_squadron', 4)], [st('militia', 9)]);
    expect(с.ships).toBe(без.ships);
    expect(с.wingPips).toBe(без.wingPips);
    expect(с.troops).toBe(9);
  });

  it('нет десанта — ноль, а не пропуск', () => {
    expect(считать([st('cruiser', 1)], []).troops).toBe(0);
  });
});
