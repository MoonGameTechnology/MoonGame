import { describe, expect, it } from 'vitest';
import { hitKey, seenPatrolOver, shuttleHitView } from './shuttleHit';

const hit = { strikeId: 'st1', owner: 'p2', targetId: 'F1', targetOwner: 'p1' };
const none = new Set<string>();

describe('shuttleHitView — кому виден удар шаттлов', () => {
  it('жертва видит удар по своему флоту даже в тумане и получает строку журнала', () => {
    expect(shuttleHitView(hit, 'p1', false, none)).toEqual({ show: true, journal: true });
  });

  it('журнал пишет один раз на налёт по цели, вспышка — на каждый удар', () => {
    const said = new Set([hitKey(hit)]);
    expect(shuttleHitView(hit, 'p1', true, said)).toEqual({ show: true, journal: false });
    // Другая цель того же патруля — уже другая новость.
    const other = { ...hit, targetId: 'F2' };
    expect(shuttleHitView(other, 'p1', true, said).journal).toBe(true);
  });

  it('стрелявший видит свой удар только по опознанной цели и не пишет его в журнал', () => {
    expect(shuttleHitView(hit, 'p2', true, none)).toEqual({ show: true, journal: false });
    expect(shuttleHitView(hit, 'p2', false, none)).toEqual({ show: false, journal: false });
  });

  it('третий игрок видит удар, только если опознаёт цель', () => {
    expect(shuttleHitView(hit, 'p3', true, none)).toEqual({ show: true, journal: false });
    expect(shuttleHitView(hit, 'p3', false, none)).toEqual({ show: false, journal: false });
  });

  it('удар по ничейному миру журнала не трогает', () => {
    const neutral = { ...hit, targetOwner: null };
    expect(shuttleHitView(neutral, 'p1', true, none)).toEqual({ show: true, journal: false });
  });
});

describe('seenPatrolOver — откуда тянуть трассу чужого удара', () => {
  const target = { x: 100, y: 0 };

  it('берёт видимый патруль того же владельца, в круге которого стоит цель', () => {
    const seen = [{ owner: 'p2', at: { x: 40, y: 0 }, radius: 90 }];
    expect(seenPatrolOver(seen, 'p2', target)).toEqual({ x: 40, y: 0 });
  });

  it('чужой владелец, цель за кругом и круг без радиуса трассы не дают', () => {
    expect(
      seenPatrolOver([{ owner: 'p3', at: { x: 40, y: 0 }, radius: 90 }], 'p2', target),
    ).toBeNull();
    expect(
      seenPatrolOver([{ owner: 'p2', at: { x: -40, y: 0 }, radius: 90 }], 'p2', target),
    ).toBeNull();
    expect(
      seenPatrolOver([{ owner: 'p2', at: { x: 100, y: 0 }, radius: 0 }], 'p2', target),
    ).toBeNull();
  });

  it('из двух накрывающих цель кругов выбирает ближний центр', () => {
    const seen = [
      { owner: 'p2', at: { x: 30, y: 0 }, radius: 90 },
      { owner: 'p2', at: { x: 120, y: 0 }, radius: 90 },
    ];
    expect(seenPatrolOver(seen, 'p2', target)).toEqual({ x: 120, y: 0 });
  });

  it('пустой обзор — источника нет, будет одна вспышка у цели', () => {
    expect(seenPatrolOver([], 'p2', target)).toBeNull();
  });
});
