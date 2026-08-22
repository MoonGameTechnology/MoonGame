import { describe, expect, it } from 'vitest';
import type { SortieState } from '../../packages/shared-core/src/index';
import type { Patrol } from './patrol';
import { resumeSortie, standingPatrol, stashOnStandDown } from './sortieResume';

/** То же, что ядровый `freshSortie`: полный бак и никакой перезарядки. */
const полный = (maxFuel: number): SortieState => ({
  fuel: Math.max(0, Math.floor(maxFuel)),
  rearming: 0,
});
const предел = (maxFuel: number, rearmRounds: number) => ({ maxFuel, rearmRounds });
const дежурство = (sortie: SortieState): Patrol => ({
  center: { x: 1, y: 2 },
  radius: 30,
  sortie,
});

describe('правило 1 — первый вылет идёт с полным баком', () => {
  it('нет отложенного — полный бак и ноль перезарядки', () => {
    expect(resumeSortie(undefined, предел(4, 3), полный)).toEqual({ fuel: 4, rearming: 0 });
  });
  it('крыло без топлива по спецификации встаёт на нуле, а не на выдуманном числе', () => {
    expect(resumeSortie(undefined, предел(0, 0), полный)).toEqual({ fuel: 0, rearming: 0 });
  });
});

describe('правило 2 — снятое крыло помнит вылет, повторная постановка продолжает', () => {
  it('снятие откладывает вылет как есть', () => {
    const s: SortieState = { fuel: 1, rearming: 2 };
    expect(stashOnStandDown(дежурство(s))).toEqual(s);
  });
  it('снимать нечего, если дежурства не было', () => {
    expect(stashOnStandDown(undefined)).toBeNull();
  });
  it('выключить и включить НЕ даёт бесплатной дозаправки', () => {
    const limits = предел(4, 3);
    const израсходованное: SortieState = { fuel: 1, rearming: 2 };
    const отложено = stashOnStandDown(дежурство(израсходованное));
    expect(resumeSortie(отложено ?? undefined, limits, полный)).toEqual(израсходованное);
    expect(resumeSortie(отложено ?? undefined, limits, полный)).not.toEqual(полный(4));
  });
  it('пустой бак остаётся пустым', () => {
    expect(resumeSortie({ fuel: 0, rearming: 3 }, предел(4, 3), полный)).toEqual({
      fuel: 0,
      rearming: 3,
    });
  });
});

describe('правило 3 — зажим нынешней спецификацией, и только сверху', () => {
  it('ослабшее крыло: топливо и перезарядка срезаются до нового предела', () => {
    expect(resumeSortie({ fuel: 9, rearming: 7 }, предел(3, 2), полный)).toEqual({
      fuel: 3,
      rearming: 2,
    });
  });
  it('усиление НЕ подливает топлива в начатый вылет', () => {
    expect(resumeSortie({ fuel: 1, rearming: 0 }, предел(10, 5), полный)).toEqual({
      fuel: 1,
      rearming: 0,
    });
  });
  it('крыло, потерявшее эскадрильи целиком, встаёт на нуле', () => {
    expect(resumeSortie({ fuel: 5, rearming: 4 }, предел(0, 0), полный)).toEqual({
      fuel: 0,
      rearming: 0,
    });
  });
  it('ровно на пределе ничего не меняется', () => {
    expect(resumeSortie({ fuel: 4, rearming: 3 }, предел(4, 3), полный)).toEqual({
      fuel: 4,
      rearming: 3,
    });
  });
});

describe('правило 5 — дежурство держит место и радиус мига постановки', () => {
  it('собирает место, радиус и вылет вместе', () => {
    const p = standingPatrol({ x: 7, y: 8 }, 42, { fuel: 2, rearming: 1 }, предел(4, 3), полный);
    expect(p).toEqual({ center: { x: 7, y: 8 }, radius: 42, sortie: { fuel: 2, rearming: 1 } });
  });
  it('место КОПИРУЕТСЯ: мир под крылом двинется, а дежурство останется где стояло', () => {
    const мир = { x: 7, y: 8 };
    const p = standingPatrol(мир, 42, undefined, предел(4, 3), полный);
    мир.x = 999;
    expect(p.center).toEqual({ x: 7, y: 8 });
  });
  it('без отложенного встаёт на полном баке', () => {
    expect(standingPatrol({ x: 0, y: 0 }, 5, undefined, предел(6, 2), полный).sortie).toEqual({
      fuel: 6,
      rearming: 0,
    });
  });
});
