import { describe, expect, it } from 'vitest';
import type { BuildingDef, UnitDef } from '../../packages/shared-core/src/index';
import {
  SIG_LARGE,
  SIG_MEDIUM,
  fleetSignature,
  planetRadar,
  sigClass,
  type RadarBuilding,
  type SigStack,
} from './sensorScale';

const юнит = (signature: number): UnitDef => ({ signature }) as unknown as UnitDef;
const каталогЮнитов =
  (m: Record<string, number>) =>
  (u: string): UnitDef | undefined =>
    u in m ? юнит(m[u]!) : undefined;

const здание = (radarRange: number, upgrades: number[] = []): BuildingDef =>
  ({
    radarRange,
    upgrades: upgrades.map((r) => ({ radarRange: r })),
  }) as unknown as BuildingDef;
const каталогЗданий =
  (m: Record<string, BuildingDef>) =>
  (t: string): BuildingDef | undefined =>
    m[t];

describe('правило 1 — шум это сумма по стопкам, а не число кораблей', () => {
  const кат = каталогЮнитов({ transport: 1, dread: 8 });
  it('складывает count × signature', () => {
    const stacks: SigStack[] = [
      { unit: 'transport', count: 3 },
      { unit: 'dread', count: 2 },
    ];
    expect(fleetSignature(stacks, кат)).toBe(3 + 16);
  });
  it('одинаковое ЧИСЛО кораблей даёт разный шум', () => {
    const мелкие = fleetSignature([{ unit: 'transport', count: 3 }], кат);
    const крупные = fleetSignature([{ unit: 'dread', count: 3 }], кат);
    expect(мелкие).not.toBe(крупные);
    expect(крупные).toBeGreaterThan(мелкие);
  });
  it('пустой состав молчит', () => {
    expect(fleetSignature([], кат)).toBe(0);
  });
  it('нулевая стопка ничего не добавляет', () => {
    expect(fleetSignature([{ unit: 'dread', count: 0 }], кат)).toBe(0);
  });
});

describe('правило 2 — незнание не прячет флот и не выдаёт дальность', () => {
  it('неизвестный тип шумит за 1 (умолчание схемы), а не за 0', () => {
    expect(fleetSignature([{ unit: 'из-будущего', count: 4 }], каталогЮнитов({}))).toBe(4);
  });
  it('флот из одних неизвестных типов остаётся видимым', () => {
    expect(fleetSignature([{ unit: '??', count: 1 }], каталогЮнитов({}))).toBeGreaterThan(0);
  });
  it('неизвестное здание слышит на 0 (умолчание схемы), а не даёт дальность даром', () => {
    expect(planetRadar([{ type: 'из-будущего', level: 9 }], каталогЗданий({}))).toBe(0);
  });
});

describe('правила 3–4 — три грубые ступени с абсолютными порогами', () => {
  it.each([
    [0, 'S'],
    [SIG_MEDIUM - 1, 'S'],
    [SIG_MEDIUM, 'M'],
    [SIG_LARGE - 1, 'M'],
    [SIG_LARGE, 'L'],
    [999, 'L'],
  ])('шум %i → ступень %s', (sig, ожидание) => {
    expect(sigClass(sig)).toBe(ожидание);
  });
  it('ступеней ровно три', () => {
    const все = new Set(Array.from({ length: 40 }, (_, i) => sigClass(i)));
    expect([...все].sort()).toEqual(['L', 'M', 'S']);
  });
  it('порог не зависит от того, что ещё есть на карте: одна и та же эскадра — та же ступень', () => {
    const эскадра: SigStack[] = [{ unit: 'dread', count: 1 }];
    const кат = каталогЮнитов({ dread: 8 });
    expect(sigClass(fleetSignature(эскадра, кат))).toBe('M');
    expect(sigClass(fleetSignature(эскадра, кат))).toBe('M'); // ничего внешнего не участвует
  });
});

describe('правила 5–6 — слух мира берётся лучшим массивом и по уровню', () => {
  const кат = каталогЗданий({
    radar: здание(10, [20, 30]),
    dish: здание(15),
    mine: здание(0),
  });
  it('без построек мир глух', () => {
    expect(planetRadar([], кат)).toBe(0);
  });
  it('две антенны НЕ складываются — берётся лучшая', () => {
    const b: RadarBuilding[] = [
      { type: 'radar', level: 1 },
      { type: 'dish', level: 1 },
    ];
    expect(planetRadar(b, кат)).toBe(15);
  });
  it('три одинаковых антенны не дальше одной', () => {
    const одна = planetRadar([{ type: 'dish', level: 1 }], кат);
    const три = planetRadar(
      [
        { type: 'dish', level: 1 },
        { type: 'dish', level: 1 },
        { type: 'dish', level: 1 },
      ],
      кат,
    );
    expect(три).toBe(одна);
  });
  it('уровень учитывается: прокачанный радар слышит дальше', () => {
    expect(planetRadar([{ type: 'radar', level: 1 }], кат)).toBe(10);
    expect(planetRadar([{ type: 'radar', level: 2 }], кат)).toBe(20);
    expect(planetRadar([{ type: 'radar', level: 3 }], кат)).toBe(30);
  });
  it('прокачанный массив побеждает лучший по первому уровню', () => {
    const b: RadarBuilding[] = [
      { type: 'radar', level: 3 },
      { type: 'dish', level: 1 },
    ];
    expect(planetRadar(b, кат)).toBe(30);
  });
  it('нерадарное здание слух не портит', () => {
    const b: RadarBuilding[] = [
      { type: 'mine', level: 1 },
      { type: 'dish', level: 1 },
    ];
    expect(planetRadar(b, кат)).toBe(15);
  });
});
