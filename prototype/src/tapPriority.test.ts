import { describe, it, expect } from 'vitest';
import { TAP_RADIUS, tapOwner, tapRadius, type TapModes } from './tapPriority';

const modes = (over: Partial<TapModes> = {}): TapModes => ({
  chainMode: false,
  merging: false,
  barrageAim: false,
  heroAim: false,
  heroSpawnAim: false,
  assaultAim: false,
  pickMode: false,
  aiming: false,
  squadronStrikeAim: false,
  ...over,
});

describe('тап по карте — кто его забирает', () => {
  it('РЕЖИМ «ПРИКАЗ» ГЛУШИТ ВСЁ: пока он жив, тап — всегда точка плана', () => {
    const все = modes({
      chainMode: true,
      merging: true,
      barrageAim: true,
      heroAim: true,
      heroSpawnAim: true,
      assaultAim: true,
      pickMode: true,
      aiming: true,
    });
    expect(tapOwner(все)).toBe('chain-plan');
  });

  it('каждый вооружённый приказ забирает тап себе', () => {
    expect(tapOwner(modes({ merging: true }))).toBe('merge');
    expect(tapOwner(modes({ barrageAim: true }))).toBe('barrage');
    expect(tapOwner(modes({ heroAim: true }))).toBe('cast');
    expect(tapOwner(modes({ heroSpawnAim: true }))).toBe('deploy');
    expect(tapOwner(modes({ assaultAim: true }))).toBe('assault');
    expect(tapOwner(modes({ aiming: true }))).toBe('move');
  });

  it('ВООРУЖЁННЫЙ ПРИКАЗ ВАЖНЕЕ ВЫДЕЛЕНИЯ — иначе приказ пропадёт, сменив выбор', () => {
    expect(tapOwner(modes({ aiming: true }))).not.toBe('select');
    expect(tapOwner(modes({ assaultAim: true }))).not.toBe('select');
  });

  it('НАБОР ГРУППЫ УСТУПАЕТ ВООРУЖЁННОМУ ХОДУ: игрок уже целится', () => {
    expect(tapOwner(modes({ pickMode: true }))).toBe('pick-group');
    expect(tapOwner(modes({ pickMode: true, aiming: true }))).toBe('move');
  });

  it('порядок среди приказов фиксирован: слияние раньше залпа, залп раньше способности', () => {
    expect(tapOwner(modes({ merging: true, barrageAim: true }))).toBe('merge');
    expect(tapOwner(modes({ barrageAim: true, heroAim: true }))).toBe('barrage');
    expect(tapOwner(modes({ heroAim: true, heroSpawnAim: true }))).toBe('cast');
    expect(tapOwner(modes({ heroSpawnAim: true, assaultAim: true }))).toBe('deploy');
  });

  it('ОБЫЧНОЕ ВЫДЕЛЕНИЕ — ПОСЛЕДНИЙ ВАРИАНТ: иначе ни один режим не сработал бы', () => {
    expect(tapOwner(modes())).toBe('select');
  });
});

describe('тап по карте — радиус попадания', () => {
  it('У ПАЛЬЦА РАДИУСЫ ШИРЕ — правило цели в 44 px', () => {
    for (const target of ['fleet', 'ping', 'node'] as const) {
      expect(tapRadius(target, true), target).toBeGreaterThan(tapRadius(target, false));
    }
  });

  it('МЕТКА МЕНЬШЕ УЗЛА: она висит над ним и не должна воровать его тапы', () => {
    expect(tapRadius('ping', false)).toBeLessThan(tapRadius('node', false));
    expect(tapRadius('ping', true)).toBeLessThan(tapRadius('node', true));
  });

  it('узел — самая крупная цель: мир больше корабля', () => {
    expect(tapRadius('node', false)).toBeGreaterThan(tapRadius('fleet', false));
    expect(tapRadius('node', true)).toBeGreaterThan(tapRadius('fleet', true));
  });

  it('таблица радиусов задаёт обе величины для каждой цели', () => {
    for (const pair of Object.values(TAP_RADIUS)) {
      expect(pair).toHaveLength(2);
      expect(pair[0]).toBeGreaterThan(0);
    }
  });
});
