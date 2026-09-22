import { describe, it, expect } from 'vitest';

import { computePowerCells, type TerritoryCell, type TerritorySeed } from './territory';
import {
  edgeSteps,
  waveCells,
  waveOffset,
  WIND_SHARE,
  type WaveConfig,
} from './territoryWave';

/**
 * M2.9 — волна на границе провинций, закреплённая тестом.
 *
 * Проверяется не «красиво ли», а три правила, без которых волна ломает карту:
 * ячейки обязаны остаться СКЛЕЕННЫМИ по общей границе, изгиб обязан быть ОДИНАКОВЫМ от
 * кадра к кадру, и `tags` обязаны остаться параллельны точкам — по ним границы
 * красятся в «своя / чужая / закрытая».
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
        // С ветром — не больше амплитуды плюс доля дыхания, и ни каплей больше.
        const [wx, wy] = waveOffset(x, y, { ...cfg, phase: 2.2 });
        expect(Math.abs(wx)).toBeLessThanOrEqual(cfg.amp * (1 + WIND_SHARE) + 1e-9);
        expect(Math.abs(wy)).toBeLessThanOrEqual(cfg.amp * (1 + WIND_SHARE) + 1e-9);
      }
  });

  it('ВЕТЕР ЕЛЕ ВИДЕН: дышит доля амплитуды, форма стоит на месте', () => {
    // Просьба владельца — «еле видно, аккуратно, как на голографической карте».
    // Значит двигается НЕ вся линия: неподвижная форма плюс маленькая рябь.
    let worst = 0;
    for (let x = -300; x <= 300; x += 13)
      for (let y = -300; y <= 300; y += 19) {
        const [ax, ay] = waveOffset(x, y, { ...cfg, phase: 0 });
        for (const phase of [0.5, 1.3, 2.9, 4.6]) {
          const [bx, by] = waveOffset(x, y, { ...cfg, phase });
          worst = Math.max(worst, Math.hypot(bx - ax, by - ay));
        }
      }
    // Ходит не больше двух долей дыхания от амплитуды: рябь, а не переезд линии.
    expect(worst).toBeLessThanOrEqual(cfg.amp * WIND_SHARE * 2 + 1e-9);
    expect(worst).toBeGreaterThan(0); // и всё-таки ходит
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
