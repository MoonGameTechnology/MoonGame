import { describe, expect, it } from 'vitest';
import {
  PURSE_DRIP_MS,
  PURSE_FLOAT_MS,
  purseStep,
  type PurseFloat,
  type PurseReading,
  type PurseTrack,
} from './purseDelta';

const HOUR = 3_600_000;

/** Прогон показаний одной плашки: [запас, скорость за час, время мира, время экрана]. */
function run(steps: ReadonlyArray<readonly [number, number, number, number]>): PurseFloat[][] {
  let memory: Record<string, PurseTrack> = {};
  return steps.map(([stock, perHour, world, now]) => {
    const out = purseStep(memory, { metal: { stock, perHour } }, world, now);
    memory = out.memory;
    return out.floats;
  });
}

describe('purseStep', () => {
  // Правило 1: вход в партию не всплывает всем запасом.
  it('takes the first reading as a baseline', () => {
    expect(run([[12_000, 0, 0, 0]])).toEqual([[]]);
  });

  // Правило 2: цена уходит с плашки сразу и ровно той суммой, что заплачена.
  it('floats a spend at once, with the income of the same reading left out', () => {
    const floats = run([
      [500, 360, 0, 0],
      // за секунду мира пришла десятая (360/ч), и тут же ушло 120
      [380.1, 360, 1000, 16],
    ]);
    expect(floats[1]).toEqual([{ key: 'metal', delta: -120 }]);
  });

  it('floats a sale or a reward as a gain', () => {
    const floats = run([
      [500, 0, 0, 0],
      [800, 0, 0, 16],
    ]);
    expect(floats[1]).toEqual([{ key: 'metal', delta: 300 }]);
  });

  // Правило 3: на ▶▶ забега (×300) доход 1000/ч даёт больше единицы за кадр — это не скачок.
  it('does not take fast income for a jump', () => {
    const frameWorld = 16 * 300; // мс мира за кадр
    const perFrame = (1000 * frameWorld) / HOUR;
    expect(perFrame).toBeGreaterThan(1);
    const steps: Array<[number, number, number, number]> = [];
    for (let i = 0; i <= 60; i++) steps.push([500 + perFrame * i, 1000, frameWorld * i, 16 * i]);
    const floats = run(steps).flat();
    // за секунду экрана — одна капля, а не шестьдесят «скачков»
    expect(floats.length).toBe(1);
    expect(floats[0]!.delta).toBeGreaterThan(0);
  });

  // Правила 4 и 5: капля всплывает не чаще PURSE_DRIP_MS и только целым.
  it('floats income drip-wise, whole units only, carrying the fraction', () => {
    const steps: Array<[number, number, number, number]> = [];
    // 0.3 за показание, показание раз в секунду экрана
    for (let i = 0; i <= 12; i++) steps.push([100 + 0.3 * i, 1080, 1000 * i, 1000 * i]);
    const floats = run(steps);
    const shown = floats.flatMap((f, i) => f.map((x) => ({ at: i * 1000, delta: x.delta })));
    // первая единица набралась на 4-м показании; дальше — раз в 4 секунды
    expect(shown).toEqual([
      { at: 4000, delta: 1 },
      { at: 8000, delta: 1 },
      { at: 12000, delta: 1 },
    ]);
    // всплыло 3 из 3.6 — дробь не потерялась, она ждёт следующей единицы
    const sum = shown.reduce((a, x) => a + x.delta, 0);
    expect(sum).toBe(Math.floor(0.3 * 12));
    expect(PURSE_DRIP_MS).toBe(4000);
  });

  // Правило 6: убыль показывает строка скорости, а не красное число раз в 4 секунды.
  it('never floats a slow drain', () => {
    const steps: Array<[number, number, number, number]> = [];
    for (let i = 0; i <= 20; i++) steps.push([100 - 0.5 * i, -1800, 1000 * i, 1000 * i]);
    expect(run(steps).flat()).toEqual([]);
  });

  it('still floats a spend and a sale on a draining resource', () => {
    const floats = run([
      [100, -1800, 0, 0],
      [99.5, -1800, 1000, 1000],
      [49, -1800, 2000, 2000], // трата 50 поверх убыли
      [348.5, -1800, 3000, 3100], // продажа 300: убыль её не съедает
    ]);
    expect(floats[2]).toEqual([{ key: 'metal', delta: -50 }]);
    expect(floats[3]).toEqual([{ key: 'metal', delta: 300 }]);
  });

  // Правило 3, вторая половина: склад на нуле при долге — не «+N».
  it('does not float the difference while the stock is pinned at zero', () => {
    const steps: Array<[number, number, number, number]> = [];
    // долг 3600/ч на ×300: формула ушла бы на −4.8 за кадр, а ядро держит склад на нуле
    for (let i = 0; i <= 10; i++) steps.push([0, -3600, 16 * 300 * i, 16 * i]);
    expect(run(steps).flat()).toEqual([]);
  });

  // Правило 7: два «-120» подряд не налезают друг на друга — второе ждёт и всплывает суммой.
  it('folds jumps into one number while the previous one is still shown', () => {
    const floats = run([
      [1000, 0, 0, 0],
      [880, 0, 0, 100],
      [760, 0, 0, 300],
      [700, 0, 0, 600],
      [700, 0, 0, 100 + PURSE_FLOAT_MS - 1],
      [700, 0, 0, 100 + PURSE_FLOAT_MS],
    ]);
    expect(floats[1]).toEqual([{ key: 'metal', delta: -120 }]);
    expect(floats.slice(2, 5).flat()).toEqual([]);
    expect(floats[5]).toEqual([{ key: 'metal', delta: -180 }]);
  });

  it('drops jumps that cancel out (a spend refunded)', () => {
    const floats = run([
      [1000, 0, 0, 0],
      [880, 0, 0, 100],
      [760, 0, 0, 300],
      [880, 0, 0, 500],
      [880, 0, 0, 100 + PURSE_FLOAT_MS],
      [880, 0, 0, 100 + PURSE_FLOAT_MS * 2],
    ]);
    expect(floats.flat()).toEqual([{ key: 'metal', delta: -120 }]);
  });

  it('puts a jump ahead of the drip', () => {
    const floats = run([
      [100, 3600, 0, 0],
      [151, 3600, 1000, 10], // за секунду мира капнула единица, и тут же продажа на 50
      [151, 3600, 1000, 10 + PURSE_DRIP_MS],
    ]);
    expect(floats[1]).toEqual([{ key: 'metal', delta: 50 }]);
    expect(floats[2]).toEqual([{ key: 'metal', delta: 1 }]); // капля дождалась своей очереди
  });

  // Правило 1 снова: время мира назад — другая партия или сохранение.
  it('starts over when the world clock goes back', () => {
    const floats = run([
      [5000, 0, 10 * HOUR, 0],
      [200, 0, 0, 5000],
    ]);
    expect(floats.flat()).toEqual([]);
  });

  it('keeps the memory of a chip that is not shown, and floats the difference when it returns', () => {
    const first = purseStep({}, { biomass: { stock: 0, perHour: 0 } }, 0, 0);
    const hidden = purseStep(first.memory, {}, 1000, 1000);
    expect(hidden.memory['biomass']?.stock).toBe(0);
    const back = purseStep(hidden.memory, { biomass: { stock: 50, perHour: 0 } }, 2000, 2000);
    expect(back.floats).toEqual([{ key: 'biomass', delta: 50 }]);
  });

  it('ignores a reading that is not a number', () => {
    const readings: Record<string, PurseReading> = { metal: { stock: Number.NaN, perHour: 0 } };
    expect(purseStep({}, readings, 0, 0)).toEqual({ memory: {}, floats: [] });
  });
});
