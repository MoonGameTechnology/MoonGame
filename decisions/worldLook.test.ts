import { describe, expect, it } from 'vitest';
import { worldLook } from './worldLook';

const live = {
  owner: 'p2',
  garrison: [{ count: 3 }, { count: 2 }],
  buildings: [{ type: 'starfort', level: 2, hp: 40 }],
};

describe('worldLook — мир вне обзора помнит, каким его разведали', () => {
  it('мир в обзоре рисуется живым', () => {
    expect(worldLook(live, 'planet')).toEqual({
      owner: 'p2',
      garrison: 5,
      buildings: live.buildings,
      sector: 'planet',
      stale: false,
    });
  });

  it('разведанный мир вне обзора рисуется по снимку, а не по живому миру', () => {
    const look = worldLook(live, 'void_station', {
      owner: 'p3',
      garrison: 1,
      buildings: [{ type: 'mine', level: 1 }],
      environment: { kind: 'planet' },
    });
    // Захват, гарнизон и крепость, появившиеся после разведки, сквозь туман не видны.
    expect(look).toEqual({
      owner: 'p3',
      garrison: 1,
      buildings: [{ type: 'mine', level: 1 }],
      sector: 'planet',
      stale: true,
    });
  });

  it('снимок без вида провинции (старое сохранение) оставляет вид узла', () => {
    expect(worldLook(live, 'nebula', { owner: null, garrison: 0, buildings: [] }).sector).toBe('nebula');
  });
});
