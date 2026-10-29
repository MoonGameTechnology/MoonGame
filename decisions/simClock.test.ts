import { describe, it, expect } from 'vitest';
import {
  ADOPT_EVERY_MS,
  ADOPT_MOVING_MS,
  FPS_GAP_MS,
  adoptDue,
  advanceTarget,
  fpsNext,
  saneGap,
  simRuns,
  spinRuns,
  stepBacklog,
} from './simClock';

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

  it('РАЗРЫВ КАДРА НЕ ПРОКРУЧИВАЕТ МИР: полчаса без кадров — один правдоподобный кадр (AUD-23)', () => {
    // Темп забега ▶: 150 игровых секунд на реальную. Раньше 30 минут за краем окна
    // двигали мир на 75 игровых часов ОДНИМ шагом ядра — без бота Роя и драйверов боя,
    // и пассивный игрок выигрывал главу II, которую проигрывает при честной игре.
    const темп = 150 / 3600;
    expect(advanceTarget(0, 30 * 60_000, темп, ЧАС)).toBe(advanceTarget(0, FPS_GAP_MS, темп, ЧАС));
  });

  it('длинный, но правдоподобный кадр идёт целиком: слабое устройство не замедляется', () => {
    expect(advanceTarget(0, FPS_GAP_MS - 1, 1, ЧАС)).toBeCloseTo(((FPS_GAP_MS - 1) / 1000) * ЧАС, 6);
  });

  it('нулевой, отрицательный и нечисловой разрыв мир не двигают', () => {
    expect(advanceTarget(7, 0, 1, ЧАС)).toBe(7);
    expect(advanceTarget(7, -500, 1, ЧАС)).toBe(7);
    expect(advanceTarget(7, Number.NaN, 1, ЧАС)).toBe(7);
  });
});

describe('часы кадра — шаг отдельного потока расчёта', () => {
  it('кадры копят к шагу столько же, сколько сдвинули бы мир сами', () => {
    const три = stepBacklog(stepBacklog(stepBacklog(0, 16, 1, ЧАС), 16, 1, ЧАС), 16, 1, ЧАС);
    expect(три).toBeCloseTo(advanceTarget(0, 48, 1, ЧАС), 6);
  });

  it('ШАГ НЕ РАСТЁТ БЕЗ КОНЦА: медленный поток получает не больше одного правдоподобного кадра', () => {
    // Устройство считает мир медленнее, чем тот идёт: пока шаг в пути, кадры копят дальше.
    let накоплено = 0;
    for (let кадр = 0; кадр < 600; кадр++) накоплено = stepBacklog(накоплено, 16, 2, ЧАС);
    expect(накоплено).toBe(advanceTarget(0, FPS_GAP_MS, 2, ЧАС));
  });

  it('разрыв кадра не прибавляет больше одного правдоподобного кадра (AUD-23)', () => {
    expect(stepBacklog(0, 30 * 60_000, 1, ЧАС)).toBe(advanceTarget(0, FPS_GAP_MS, 1, ЧАС));
  });

  it('нулевой и отрицательный разрыв ничего не копят', () => {
    expect(stepBacklog(5, 0, 1, ЧАС)).toBe(5);
    expect(stepBacklog(5, -16, 1, ЧАС)).toBe(5);
  });
});

describe('часы кадра — мир отдельного потока на экране', () => {
  it('первый мир кадр берёт сразу', () => {
    expect(adoptDue(0, -Infinity, false)).toBe(true);
    expect(adoptDue(0, -Infinity, true)).toBe(true);
  });

  it('следующий — не раньше, чем через ADOPT_EVERY_MS после прошлого', () => {
    expect(adoptDue(1000 + ADOPT_EVERY_MS - 1, 1000, false)).toBe(false);
    expect(adoptDue(1000 + ADOPT_EVERY_MS, 1000, false)).toBe(true);
  });

  it('пока камера движется — не раньше, чем через ADOPT_MOVING_MS', () => {
    expect(ADOPT_MOVING_MS).toBeGreaterThan(ADOPT_EVERY_MS);
    expect(adoptDue(1000 + ADOPT_EVERY_MS, 1000, true)).toBe(false);
    expect(adoptDue(1000 + ADOPT_MOVING_MS - 1, 1000, true)).toBe(false);
    expect(adoptDue(1000 + ADOPT_MOVING_MS, 1000, true)).toBe(true);
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
