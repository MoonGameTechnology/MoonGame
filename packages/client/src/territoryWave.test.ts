import { describe, it, expect } from 'vitest';

import { BOUNDARY, computePowerCells, type TerritoryCell, type TerritorySeed } from './territory';
import { edgeSteps, waveCells, waveOffset, type WaveConfig } from './territoryWave';

/**
 * M2.9 — волна на границе провинций, закреплённая тестом.
 *
 * Проверяется не «красиво ли», а три правила, без которых волна ломает карту:
 * ячейки обязаны остаться СКЛЕЕННЫМИ по общей границе, изгиб обязан быть ОДИНАКОВЫМ от
 * кадра к кадру, и `tags` обязаны остаться параллельны точкам — по ним границы
 * красятся в «своя / чужая», а край карты не обводится вовсе.
 */

const cfg: WaveConfig = { amp: 10, wavelength: 180, segment: 40 };

const seeds: TerritorySeed[] = [
  { x: 0, y: 0, w: 9000, owner: 'p1', kind: 'planet' },
  { x: 260, y: 0, w: 9000, owner: null, kind: 'planet' },
  { x: 130, y: 225, w: 9000, owner: 'p2', kind: 'planet' },
];
const clip: Array<[number, number]> = [
  [-200, -200],
  [460, -200],
  [460, 420],
  [-200, 420],
];

const key = ([x, y]: [number, number]): string => `${x.toFixed(6)},${y.toFixed(6)}`;

describe('M2.9 — волна на границе', () => {
  it('ОДНО И ТО ЖЕ ВХОДНОЕ — ОДИН И ТОТ ЖЕ ИЗГИБ: карта не «дышит» между кадрами', () => {
    const a = waveCells(computePowerCells(seeds, clip), cfg);
    const b = waveCells(computePowerCells(seeds, clip), cfg);
    expect(a.map((c) => c.poly)).toEqual(b.map((c) => c.poly));
  });

  it('СМЕЩЕНИЕ ЗАВИСИТ ТОЛЬКО ОТ ТОЧКИ — иначе соседние ячейки разойдутся щелью', () => {
    // Это сердце правила: одну и ту же точку карты обе ячейки обязаны сдвинуть одинаково,
    // как бы они её ни обходили.
    expect(waveOffset(37, -12, cfg)).toEqual(waveOffset(37, -12, cfg));
    expect(waveOffset(37, -12, cfg)).not.toEqual(waveOffset(38, -12, cfg));
  });

  it('ОБЩАЯ ГРАНИЦА ОСТАЁТСЯ ОБЩЕЙ: точки двух соседей совпадают до последнего знака', () => {
    const cells = waveCells(computePowerCells(seeds, clip), cfg);
    // Берём пару, у которой есть общая грань, и сверяем точки, лежащие у обоих.
    let shared = 0;
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const setJ = new Set(cells[j]!.poly.map(key));
        for (const p of cells[i]!.poly) if (setJ.has(key(p))) shared += 1;
      }
    }
    // На трёх ячейках общих точек заведомо больше нуля; важно, что они СОВПАДАЮТ точно.
    expect(shared).toBeGreaterThan(0);
  });

  it('АМПЛИТУДА ОГРАНИЧЕНА: точка не убегает дальше заявленного', () => {
    for (let x = -300; x <= 300; x += 17)
      for (let y = -300; y <= 300; y += 23) {
        const [dx, dy] = waveOffset(x, y, cfg);
        expect(Math.abs(dx)).toBeLessThanOrEqual(cfg.amp + 1e-9);
        expect(Math.abs(dy)).toBeLessThanOrEqual(cfg.amp + 1e-9);
      }
  });

  it('TAGS ИДУТ ПАРАЛЛЕЛЬНО ТОЧКАМ — иначе куски одной границы покрасятся по-разному', () => {
    const plain = computePowerCells(seeds, clip);
    const wavy = waveCells(plain, cfg);
    for (let i = 0; i < wavy.length; i++) {
      expect(wavy[i]!.poly.length).toBe(wavy[i]!.tags.length);
      // Набор соседей не изменился: волна не вправе добавить или убрать границу.
      expect([...new Set(wavy[i]!.tags)].sort()).toEqual([...new Set(plain[i]!.tags)].sort());
    }
  });

  it('ГРАНЬ ДРОБИТСЯ ПО ДЛИНЕ — у общей границы обе ячейки получают одинаковые точки', () => {
    expect(edgeSteps(200, 40)).toBe(5);
    expect(edgeSteps(200, 40)).toBe(edgeSteps(200, 40));
    // Короткую грань не дробим в пыль, длинную — не дробим до бесконечности.
    expect(edgeSteps(1, 40)).toBe(2);
    expect(edgeSteps(100000, 40)).toBe(16);
  });

  it('КРАЙ КАРТЫ НЕ ВОЛНУЕТСЯ: провинция доходит до рамки ровно (владелец 2026-09-24)', () => {
    // «У провинций у края карты не должно быть своих волнистых краёв». Оба конца каждого
    // отрезка грани края обязаны остаться на линии клипа — включая вершину, где граница
    // двух провинций упирается в край: её обе ячейки держат одинаково (правило 1).
    const onClip = ([x, y]: [number, number]): boolean =>
      Math.abs(x + 200) < 1e-9 || Math.abs(x - 460) < 1e-9 || Math.abs(y + 200) < 1e-9 || Math.abs(y - 420) < 1e-9;
    let edgeSegments = 0;
    for (const cell of waveCells(computePowerCells(seeds, clip), cfg)) {
      const n = cell.poly.length;
      for (let k = 0; k < n; k++) {
        if (cell.tags[k] !== BOUNDARY) continue;
        edgeSegments += 1;
        expect(onClip(cell.poly[k]!)).toBe(true);
        expect(onClip(cell.poly[(k + 1) % n]!)).toBe(true);
      }
    }
    expect(edgeSegments).toBeGreaterThan(3);
  });

  it('…а граница МЕЖДУ провинциями волну сохраняет', () => {
    // Иначе правило края выключило бы M2.9 целиком. Точка на прямой грани — на расстоянии
    // ноль от неё; изогнутая граница обязана уйти с прямой хотя бы в одной точке.
    const plain = computePowerCells(seeds, clip);
    const dist = (p: [number, number], a: [number, number], b: [number, number]): number => {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    const straight = plain.flatMap((c) => c.poly.map((a, k) => [a, c.poly[(k + 1) % c.poly.length]!] as const));
    const bent = waveCells(plain, cfg).some((c) =>
      c.poly.some((p, k) => c.tags[k] !== BOUNDARY && straight.every(([a, b]) => dist(p, a, b) > 0.5)),
    );
    expect(bent).toBe(true);
  });

  it('НУЛЕВАЯ АМПЛИТУДА — ЭТО ВЫКЛЮЧАТЕЛЬ: мозаика возвращается как была', () => {
    const plain = computePowerCells(seeds, clip);
    expect(waveCells(plain, { ...cfg, amp: 0 })).toBe(plain);
  });

  it('ВЫРОЖДЕННУЮ ЯЧЕЙКУ НЕ ТРОГАЕТ: меньше трёх точек — не полигон', () => {
    const thin: TerritoryCell = {
      poly: [
        [0, 0],
        [10, 0],
      ],
      tags: [-1, -1],
      owner: null,
      kind: 'planet',
      idx: 0,
    };
    expect(waveCells([thin], cfg)[0]).toBe(thin);
  });
});
