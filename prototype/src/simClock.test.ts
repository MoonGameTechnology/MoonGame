import { describe, it, expect } from 'vitest';
import { FPS_GAP_MS, advanceTarget, fpsNext, saneGap, simRuns, spinRuns } from './simClock';

const ЧАС = 3_600_000;

describe('часы кадра — правдоподобие разрыва', () => {
  it('обычный кадр проходит', () => {
    expect(saneGap(16)).toBe(true);
  });

  it('ВОЗВРАТ ИЗ ФОНА НЕ КАДР: минутный разрыв провернул бы орбиты одним скачком', () => {
    expect(saneGap(FPS_GAP_MS)).toBe(false);
    expect(saneGap(60_000)).toBe(false);
  });

  it('нулевой и отрицательный разрыв не считаются', () => {
    expect(saneGap(0)).toBe(false);
    expect(saneGap(-5)).toBe(false);
  });
});

describe('часы кадра — крутится ли симуляция', () => {
  it('соло на ходу — крутится', () => {
    expect(simRuns(false, 1, false, false)).toBe(true);
  });

  it('В СЕТИ ЧАСЫ У СЕРВЕРА: свой ход времени разъехался бы с авторитетным', () => {
    expect(simRuns(true, 1, false, false)).toBe(false);
  });

  it('пауза останавливает мир', () => {
    expect(simRuns(false, 0, false, false)).toBe(false);
  });

  it('баннер останавливает мир', () => {
    expect(simRuns(false, 1, true, false)).toBe(false);
  });

  it('РЕШЁННЫЙ МАТЧ НЕ ДОИГРЫВАЮТ: счёт уже объявлен', () => {
    expect(simRuns(false, 1, false, true)).toBe(false);
  });
});

describe('часы кадра — насколько двигать время', () => {
  it('секунда реального времени на скорости 1 — час игрового', () => {
    expect(advanceTarget(0, 1000, 1, ЧАС)).toBe(ЧАС);
  });

  it('СКОРОСТЬ МНОЖИТ, А НЕ ДОБАВЛЯЕТ ТИК', () => {
    expect(advanceTarget(0, 1000, 60, ЧАС)).toBe(60 * ЧАС);
  });

  it('ПРОСАДКА FPS МИР НЕ ЗАМЕДЛЯЕТ: два коротких кадра равны одному длинному', () => {
    const один = advanceTarget(0, 32, 10, ЧАС);
    const два = advanceTarget(advanceTarget(0, 16, 10, ЧАС), 16, 10, ЧАС);
    expect(два).toBeCloseTo(один, 6);
  });

  it('время идёт от текущего, а не от нуля', () => {
    expect(advanceTarget(5 * ЧАС, 1000, 1, ЧАС)).toBe(6 * ЧАС);
  });
});

describe('часы кадра — спин орбит', () => {
  it('В СЕТИ КРУТИТСЯ ВСЕГДА: там мир идёт у сервера, локальной паузы нет', () => {
    expect(spinRuns(true, 0, true)).toBe(true);
  });

  it('в соло на паузе корабли замирают', () => {
    expect(spinRuns(false, 0, false)).toBe(false);
    expect(spinRuns(false, 1, true)).toBe(false);
  });

  it('в соло на ходу крутится', () => {
    expect(spinRuns(false, 1, false)).toBe(true);
  });
});

describe('часы кадра — сглаженный FPS', () => {
  it('среднее тянется к мгновенному значению, а не прыгает', () => {
    const было = 60;
    const стало = fpsNext(было, 1000 / 30);
    expect(стало).toBeLessThan(было);
    expect(стало).toBeGreaterThan(30);
  });

  it('устойчивый кадр держит среднее на месте', () => {
    expect(fpsNext(60, 1000 / 60)).toBeCloseTo(60, 6);
  });
});
