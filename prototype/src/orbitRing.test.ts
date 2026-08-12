import { describe, it, expect } from 'vitest';
import {
  ORBIT_R,
  ORBIT_SPIN,
  ORBIT_ZOOM_IN,
  chevronAngle,
  fortified,
  orbitBloom,
  orbitsLive,
  orbitRadius,
  ringShown,
  slotAngle,
  type RingHost,
} from './orbitRing';

describe('орбита — порог открытия слоя', () => {
  it('на пороге слой уже жив', () => {
    expect(orbitsLive(ORBIT_ZOOM_IN)).toBe(true);
  });

  it('на общем виде слой закрыт', () => {
    expect(orbitsLive(1)).toBe(false);
    expect(orbitsLive(ORBIT_ZOOM_IN - 0.01)).toBe(false);
  });

  it('ОДИН ПОРОГ на ширину, вращение и разворот шеврона', () => {
    const far = orbitsLive(1.2);
    expect(far).toBe(false);
    expect(orbitBloom(1.2)).toBe(0.5); // кольцо ужато
    expect(slotAngle(0, 1, 1e6, far)).toBe(slotAngle(0, 1, 0, far)); // и не крутится
    expect(chevronAngle(0.3, far)).toBe(0.3); // и нос радиальный
  });
});

describe('орбита — раздутие радиуса зумом', () => {
  it('вдали кольцо ужато вдвое', () => {
    expect(orbitBloom(0.5)).toBe(0.5);
    expect(orbitBloom(ORBIT_ZOOM_IN)).toBe(0.5);
  });

  it('вблизи распускается и упирается в 2.4×', () => {
    expect(orbitBloom(2)).toBeCloseTo(0.98, 12);
    expect(orbitBloom(9)).toBe(2.4);
  });

  it('множитель никогда не выходит за [0.5, 2.4]', () => {
    for (const scale of [-3, 0, 1, 1.6, 1.9, 3, 40]) {
      const b = orbitBloom(scale);
      expect(b).toBeGreaterThanOrEqual(0.5);
      expect(b).toBeLessThanOrEqual(2.4);
    }
  });
});

describe('орбита — радиус кольца', () => {
  it('КОЛЬЦО НЕ ЗАЛЕЗАЕТ НА СОСЕДА: тесный зазор режет радиус', () => {
    const gap = 50;
    expect(orbitRadius(2.4, gap)).toBeCloseTo(gap * 0.4, 12);
  });

  it('просторный зазор потолком не является — работает зум', () => {
    expect(orbitRadius(1, 1000)).toBe(ORBIT_R);
  });

  it('ОДИНОКОМУ УЗЛУ ПОТОЛОК НЕ НУЖЕН: без связей кольцо живёт по зуму', () => {
    expect(orbitRadius(2.4, Infinity)).toBeCloseTo(ORBIT_R * 2.4, 12);
  });

  it('радиус не бывает шире 40% зазора ни при каком зуме', () => {
    for (const bloom of [0.5, 1, 1.7, 2.4]) {
      for (const gap of [20, 60, 200]) {
        expect(orbitRadius(bloom, gap)).toBeLessThanOrEqual(gap * 0.4 + 1e-9);
      }
    }
  });
});

describe('орбита — слоты флотов', () => {
  it('одинокий флот стоит ровно на «12 часах»', () => {
    expect(slotAngle(0, 1, 0, false)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('ВЕЕР СИММЕТРИЧЕН ЦЕНТРУ: крайние расходятся поровну', () => {
    const first = slotAngle(0, 4, 0, false);
    const last = slotAngle(3, 4, 0, false);
    expect((first + last) / 2).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('соседние слоты не совпадают — шевроны не налезают', () => {
    expect(slotAngle(1, 3, 0, false)).not.toBe(slotAngle(2, 3, 0, false));
  });

  it('ВРАЩЕНИЕ ПО ИГРОВОМУ ВРЕМЕНИ: накопленная фаза сдвигает слот', () => {
    const base = slotAngle(0, 2, 0, true);
    expect(slotAngle(0, 2, 1000, true) - base).toBeCloseTo(1000 * ORBIT_SPIN, 12);
  });

  it('НА ЗАКРЫТОМ СЛОЕ ФАЗА НЕ ДВИГАЕТ НИЧЕГО', () => {
    expect(slotAngle(0, 2, 5e5, false)).toBe(slotAngle(0, 2, 0, false));
  });
});

describe('орбита — разворот шеврона', () => {
  it('НА ЖИВОМ КОЛЬЦЕ НОС ПО КАСАТЕЛЬНОЙ: флот идёт по кругу', () => {
    expect(chevronAngle(0, true)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('на неподвижной орбите нос радиальный — движения нет', () => {
    expect(chevronAngle(0.7, false)).toBe(0.7);
  });
});

const узел = (over: Partial<RingHost> = {}): RingHost => ({
  typeHasOrbit: true,
  starfort: false,
  garrison: [],
  parked: 1,
  ...over,
});

describe('орбитальное кольцо — у кого оно вообще есть', () => {
  it('у типа-ГОРОДА кольцо есть', () => {
    expect(ringShown(узел(), 1)).toBe(true);
  });

  it('РАЗВЯЗКА БЕЗ УКРЕПЛЕНИЙ КОЛЬЦА НЕ ПОЛУЧАЕТ: её берут простым прибытием', () => {
    expect(ringShown(узел({ typeHasOrbit: false }), 1)).toBe(false);
  });

  it('КРЕПОСТЬ ДАЁТ КОЛЬЦО РАЗВЯЗКЕ: такой узел приходится штурмовать с орбиты', () => {
    expect(ringShown(узел({ typeHasOrbit: false, starfort: true }), 1)).toBe(true);
  });

  it('живой гарнизон тоже даёт кольцо развязке', () => {
    expect(ringShown(узел({ typeHasOrbit: false, garrison: [{ count: 3 }] }), 1)).toBe(true);
  });

  it('ГАРНИЗОН ИЗ НУЛЕЙ — НЕ УКРЕПЛЕНИЕ: записи остаются в состоянии после потерь', () => {
    expect(fortified(false, [{ count: 0 }, { count: 0 }])).toBe(false);
    expect(ringShown(узел({ typeHasOrbit: false, garrison: [{ count: 0 }] }), 1)).toBe(false);
  });

  it('хотя бы одна живая единица среди нулей укрепляет узел', () => {
    expect(fortified(false, [{ count: 0 }, { count: 1 }, { count: 0 }])).toBe(true);
  });

  it('пустой гарнизон не укрепляет', () => {
    expect(fortified(false, [])).toBe(false);
  });
});

describe('орбитальное кольцо — когда его рисовать', () => {
  it('ПУСТАЯ ОРБИТА НЕ РИСУЕТСЯ: кольцо — сведение «здесь стоят», а не украшение', () => {
    expect(ringShown(узел({ parked: 0 }), 1)).toBe(false);
    expect(ringShown(узел({ parked: 1 }), 1)).toBe(true);
  });

  it('НА СХЕМАТИЧНОМ ВИДЕ КОЛЕЦ НЕТ ВОВСЕ: вдали они сливаются с узлом в пятно', () => {
    expect(ringShown(узел(), 0)).toBe(false);
    expect(ringShown(узел({ starfort: true, garrison: [{ count: 9 }] }), 0)).toBe(false);
  });

  it('ИСЧЕРПЫВАЮЩЕ: кольцо ровно там, где есть где встать, кто стоит и на чём смотреть', () => {
    let рисуем = 0;
    for (const typeHasOrbit of [true, false])
      for (const starfort of [true, false])
        for (const живой of [true, false])
          for (const parked of [0, 2])
            for (const detail of [0, 0.5, 1]) {
              const host: RingHost = {
                typeHasOrbit,
                starfort,
                garrison: [{ count: живой ? 4 : 0 }],
                parked,
              };
              const ждём = detail > 0 && parked > 0 && (typeHasOrbit || starfort || живой);
              expect(ringShown(host, detail)).toBe(ждём);
              if (ждём) рисуем++;
            }
    // 48 наборов; кольцо живёт при parked > 0 (1 из 2) × detail > 0 (2 из 3) ×
    // «есть где встать» (7 из 8) = 14
    expect(рисуем).toBe(14);
  });
});
