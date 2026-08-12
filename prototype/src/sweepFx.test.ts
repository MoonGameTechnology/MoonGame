import { describe, it, expect } from 'vitest';
import { GLOW_MIN, armGlow, sweepGlow, sweepPaint, sweepShows, type SweepArm } from './sweepFx';
import { nodeView } from './fogView';

const TAU = Math.PI * 2;
const ЛУЧ: SweepArm = { x: 0, y: 0, r: 100 };
/** Точка на расстоянии `d` под углом `ang` от центра луча. */
const точка = (ang: number, d = 50) => ({ x: Math.cos(ang) * d, y: Math.sin(ang) * d });

describe('развёртка — засветка одного луча', () => {
  it('ТОЛЬКО ЧТО ПРОЙДЕННЫЙ ГОРИТ ЯРЧЕ ВСЕГО: засветка про «когда видели», а не «далеко ли»', () => {
    const свежий = armGlow(ЛУЧ, точка(0.5), 0.5 + 0.01, TAU); // луч только что прошёл узел
    const давний = armGlow(ЛУЧ, точка(0.5), 0.5 + TAU * 0.75, TAU);
    expect(свежий).toBeGreaterThan(давний);
    expect(свежий).toBeGreaterThan(0.99);
  });

  it('НОЖ НА САМОМ ЛУЧЕ (замечено, не чинил): точное совпадение углов даёт полный оборот', () => {
    // delta считается вычитанием, и на точном совпадении погрешность уводит остаток в
    // минус — приведение знака (правило 2) добавляет полный оборот, и узел на один кадр
    // читается как «давно не виденный». Свойство исходной формулы, сохранено дословно.
    expect(armGlow(ЛУЧ, точка(0.5), 0.5, TAU)).toBeLessThan(0.01);
    // на волосок в любую сторону всё уже штатно
    expect(armGlow(ЛУЧ, точка(0.5), 0.5 + 1e-6, TAU)).toBeGreaterThan(0.99);
  });

  it('яркость не зависит от расстояния внутри досягаемости', () => {
    const близко = armGlow(ЛУЧ, точка(1, 10), 1 + 0.4, TAU);
    const далеко = armGlow(ЛУЧ, точка(1, 90), 1 + 0.4, TAU);
    expect(близко).toBeCloseTo(далеко, 12);
  });

  it('ВНЕ ДОСЯГАЕМОСТИ НЕ СВЕТИТСЯ: свечение обещало бы обзор, которого нет', () => {
    expect(armGlow(ЛУЧ, точка(0, 101), 0, TAU)).toBe(0);
    expect(armGlow(ЛУЧ, точка(0, 100), 0, TAU)).toBeGreaterThan(0); // ровно на границе — ещё достаёт
  });

  it('УГОЛ ПРИВЕДЁН К НЕОТРИЦАТЕЛЬНОМУ: иначе узел позади луча вспыхивал бы на нуле', () => {
    for (let ang = -TAU * 2; ang <= TAU * 2; ang += 0.05)
      for (const sweep of [-3, -0.1, 0, 0.1, 3, 7]) {
        const g = armGlow(ЛУЧ, точка(ang), sweep, TAU);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(1);
      }
  });

  it('КРИВАЯ КВАДРАТИЧНАЯ: линейная растянула бы хвост и съела момент пересечения', () => {
    // на половине оборота после прохода линейная дала бы 0.5, квадратичная — 0.25
    const g = armGlow(ЛУЧ, точка(0), TAU / 2, TAU);
    expect(g).toBeCloseTo(0.25, 9);
  });

  it('засветка гаснет монотонно по мере ухода луча', () => {
    let prev = Infinity;
    for (let d = 0; d < TAU; d += TAU / 64) {
      const g = armGlow(ЛУЧ, точка(0), d, TAU);
      expect(g).toBeLessThanOrEqual(prev + 1e-12);
      prev = g;
    }
  });
});

describe('развёртка — несколько лучей', () => {
  it('БЕРЁТСЯ САМЫЙ ЯРКИЙ, А НЕ СУММА: двойное покрытие не делает узел важнее', () => {
    const at = точка(0);
    const arms: SweepArm[] = [ЛУЧ, { x: 0, y: 0, r: 100 }];
    const один = armGlow(ЛУЧ, at, 0.3, TAU);
    expect(sweepGlow(arms, at, 0.3, TAU)).toBeCloseTo(один, 12);
    expect(sweepGlow(arms, at, 0.3, TAU)).toBeLessThan(один * 2);
  });

  it('луч, который не достаёт, картину не портит', () => {
    const at = точка(0, 90);
    const далёкий: SweepArm = { x: 1000, y: 1000, r: 10 };
    expect(sweepGlow([ЛУЧ, далёкий], at, 0.3, TAU)).toBeCloseTo(armGlow(ЛУЧ, at, 0.3, TAU), 12);
  });

  it('без лучей засветки нет', () => {
    expect(sweepGlow([], точка(0), 0, TAU)).toBe(0);
  });
});

describe('развёртка — кого подсвечивать', () => {
  it('ИСЧЕРПЫВАЮЩЕ по всем видам узла под туманом', () => {
    expect(sweepPaint('full')).toEqual({ do: 'paint', ownerColored: true });
    expect(sweepPaint('remembered')).toEqual({ do: 'paint', ownerColored: false });
    expect(sweepPaint('void')).toEqual({ do: 'skip' });
    expect(sweepPaint('unexplored')).toEqual({ do: 'skip' });
  });

  it('ПОМНИМЫЙ ГОРИТ НЕЙТРАЛЬНО: цвет владельца из памяти может быть устаревшим', () => {
    const view = nodeView({ sector: 'terran', identified: false, remembered: true });
    expect(sweepPaint(view)).toEqual({ do: 'paint', ownerColored: false });
  });

  it('НИКОГДА НЕ ВИДЕННЫЙ НЕ ВЫДАЁТ СЕБЯ ЗАСВЕТКОЙ', () => {
    const view = nodeView({ sector: 'terran', identified: false, remembered: false });
    expect(sweepPaint(view)).toEqual({ do: 'skip' });
  });

  it('ПУСТОЙ УЗЕЛ КОНТАКТА НЕ ИМЕЕТ — светиться нечему', () => {
    const view = nodeView({ sector: 'empty', identified: true, remembered: true });
    expect(sweepPaint(view)).toEqual({ do: 'skip' });
  });
});

describe('развёртка — порог отрисовки', () => {
  it('СЛАБАЯ ЗАСВЕТКА НЕ РИСУЕТСЯ: невидимый диск стоит полного круга каждый кадр', () => {
    expect(sweepShows(GLOW_MIN)).toBe(false);
    expect(sweepShows(0)).toBe(false);
    expect(sweepShows(GLOW_MIN + 0.001)).toBe(true);
    expect(sweepShows(1)).toBe(true);
  });
});
