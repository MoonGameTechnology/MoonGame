// Регресс живого плейтеста: пипсы трюма стоящего флота ложились на диск планеты.
// Инвариант: у стоящей (радиальной) позы ВСЕ ячейки хвоста дальше от центра планеты,
// чем сам корабль; в полёте хвост по-прежнему тянется строго за корму.
import { describe, it, expect } from 'vitest';
import {
  CARGO_CELL,
  CARGO_ROW_MAX,
  cargoRowLayout,
  cargoRows,
  loadFill,
  squareRowY,
  tailAt,
  tailTheta,
  tallyY,
} from './markerTail';

const dist = (x: number, y: number): number => Math.hypot(x, y);

describe('хвост маркера флота', () => {
  it('стоящий флот: каждая ячейка хвоста ДАЛЬШЕ от центра планеты, чем корабль', () => {
    const RING = 15.5; // кольцо на дальнем зуме после ужатия (31 × 0.5) — худший случай
    // по кругу: 12 радиальных поз, все ряды хвоста (пипсы ly=5/13, «×N» ly=21/29)
    for (let k = 0; k < 12; k++) {
      const a0 = (k / 12) * 2 * Math.PI;
      const ax = Math.cos(a0) * RING;
      const ay = Math.sin(a0) * RING;
      const th = tailTheta(a0, true); // радиальная поза, разворот наружу
      for (const ly of [5, 13, 21, 29]) {
        for (const lx of [-14, 0, 14]) {
          const p = tailAt(ax, ay, th, lx, ly);
          expect(dist(p.x, p.y), `a0=${k} ly=${ly} lx=${lx}`).toBeGreaterThan(RING - 1e-9);
        }
      }
    }
  });

  it('без разворота хвост шёл ВНУТРЬ — ровно воспроизведение бага', () => {
    const RING = 15.5;
    const th = tailTheta(0, false); // старое поведение для радиальной позы
    const p = tailAt(RING, 0, th, 0, 13);
    expect(dist(p.x, p.y)).toBeLessThan(RING); // ячейка внутри кольца → на диске планеты
  });

  it('в полёте хвост тянется строго за корму (разворота нет)', () => {
    // курс вправо (ang=0): корма — влево, т.е. −x от якоря
    const th = tailTheta(0, false);
    const p = tailAt(100, 50, th, 0, 13);
    expect(p.x).toBeCloseTo(100 - 13, 9);
    expect(p.y).toBeCloseTo(50, 9);
  });

  it('локальный x (ряд пипсов) перпендикулярен хвосту в обеих позах', () => {
    for (const dock of [true, false]) {
      const th = tailTheta(Math.PI / 3, dock);
      const c = tailAt(0, 0, th, 0, 10);
      const l = tailAt(0, 0, th, -4, 10);
      const r = tailAt(0, 0, th, 4, 10);
      // середина между крайними ячейками ряда — сама точка хвоста
      expect((l.x + r.x) / 2).toBeCloseTo(c.x, 9);
      expect((l.y + r.y) / 2).toBeCloseTo(c.y, 9);
    }
  });
});

const крыло = (u: string) => u === 'fighter_squadron';
const груз = (unit: string) => ({ unit });

describe('хвост груза — что в каком ряду', () => {
  it('РЯДЫ ДЕЛЯТСЯ ПО ФОРМЕ: ромбы — крыло, квадраты — десант', () => {
    const r = cargoRows(3, 2, [], крыло);
    expect(r.diamonds.map((p) => p.kind)).toEqual(['wing', 'wing', 'wing']);
    expect(r.squares.map((p) => p.kind)).toEqual(['troop', 'troop']);
  });

  it('ГРУЗЯЩЕЕСЯ ВСТАЁТ В РЯД СВОЕЙ ФОРМЫ: иначе пипс «прыгнет» по окончании погрузки', () => {
    const r = cargoRows(1, 1, [груз('fighter_squadron'), груз('militia')], крыло);
    expect(r.diamonds.map((p) => p.kind)).toEqual(['wing', 'load']);
    expect(r.squares.map((p) => p.kind)).toEqual(['troop', 'load']);
  });

  it('грузящийся пипс несёт свою запись — по ней рисуется прогресс', () => {
    const p = груз('militia');
    expect(cargoRows(0, 0, [p], крыло).squares[0]!.load).toBe(p);
  });

  it('пустой трюм даёт два пустых ряда, а не один', () => {
    expect(cargoRows(0, 0, [], крыло)).toEqual({ diamonds: [], squares: [] });
  });
});

describe('хвост груза — уместить ряд', () => {
  it('короткий ряд рисуется целиком', () => {
    expect(cargoRowLayout(3)).toMatchObject({ shown: 3, over: 0 });
  });

  it('РЯД ОБРЕЗАН ПРЕДЕЛОМ, ОСТАТОК НАЗВАН ЧИСЛОМ: длинный хвост перекрыл бы соседей', () => {
    expect(cargoRowLayout(CARGO_ROW_MAX + 5)).toMatchObject({ shown: CARGO_ROW_MAX, over: 5 });
  });

  it('ровно по пределу остатка нет', () => {
    expect(cargoRowLayout(CARGO_ROW_MAX).over).toBe(0);
  });

  it('РЯД ЦЕНТРИРОВАН, и «+N» входит в ширину — иначе хвост уедет вбок', () => {
    const без = cargoRowLayout(CARGO_ROW_MAX);
    const с = cargoRowLayout(CARGO_ROW_MAX + 1);
    expect(без.firstX).toBe(-(CARGO_ROW_MAX * CARGO_CELL) / 2 + CARGO_CELL / 2);
    expect(с.firstX).toBeLessThan(без.firstX); // остаток расширил ряд и сдвинул начало
  });

  it('ряд из одной ячейки стоит по центру хвоста', () => {
    expect(cargoRowLayout(1).firstX).toBe(0);
  });
});

describe('хвост груза — где ряды и счётчик', () => {
  it('ВТОРОЙ РЯД ОПУСКАЕТСЯ, ТОЛЬКО ЕСЛИ ПЕРВЫЙ НЕПУСТ: иначе он повиснет с отступом', () => {
    expect(squareRowY(5, 0)).toBe(5);
    expect(squareRowY(5, 3)).toBe(5 + CARGO_CELL);
  });

  it('СЧЁТЧИК ОПУСКАЕТСЯ, ТОЛЬКО КОГДА РЯДОВ ДВА', () => {
    expect(tallyY(21, 0, 0)).toBe(21);
    expect(tallyY(21, 2, 0)).toBe(21);
    expect(tallyY(21, 0, 2)).toBe(21);
    expect(tallyY(21, 2, 2)).toBe(21 + CARGO_CELL);
  });
});

describe('хвост груза — доля погрузки', () => {
  it('ДОЛЯ ЗАЖАТА В [0, 1]: иначе пипс вырастет за свой размер или уйдёт в минус', () => {
    expect(loadFill(50, 0, 100)).toBeCloseTo(0.5, 12);
    expect(loadFill(-40, 0, 100)).toBe(0);
    expect(loadFill(500, 0, 100)).toBe(1);
  });

  it('на концах отрезка — ровно 0 и ровно 1', () => {
    expect(loadFill(0, 0, 100)).toBe(0);
    expect(loadFill(100, 0, 100)).toBe(1);
  });
});
