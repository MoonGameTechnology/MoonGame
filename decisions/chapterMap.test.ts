import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { pveChapter, pveState, PVE_MISSION_COUNT } from '../packages/client/src/gameData';
import { chapterMapView } from './chapterMap';

const data = shippedGameData();

describe('карта главы в меню — что игрок уже знает', () => {
  it('клетка на КАЖДЫЙ сектор главы — та же мозаика, что у игровой карты', () => {
    for (let i = 0; i < PVE_MISSION_COUNT; i++) {
      const s = pveState(data, i);
      const view = chapterMapView(s, []);
      expect(view.cells).toHaveLength(Object.keys(s.planets).length);
      expect(view.total).toBe(Object.keys(s.planets).length);
      for (const c of view.cells) expect(c.poly.length, c.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('до первого забега известен только старт; про туман — ни вида, ни хозяина', () => {
    const s = pveState(data, 1);
    const view = chapterMapView(s, []);
    const home = Object.values(s.planets)
      .filter((p) => p.owner === 'p1')
      .map((p) => p.id);
    expect(view.known).toBe(home.length);
    for (const c of view.cells) {
      if (home.includes(c.id)) expect(c).toMatchObject({ known: true, side: 'you' });
      else expect(c).toMatchObject({ known: false, kind: null, side: null, objective: false });
    }
    // Проходов из тумана не видно: с одной известной провинцией линий нет.
    expect(view.lanes).toEqual([]);
  });

  it('разведанное показывает вид, сторону, проходы и цели задач', () => {
    const s = pveState(data, 1);
    const all = Object.keys(s.planets);
    const targets = pveChapter(1).objectives.flatMap((o) =>
      o.kind === 'control' ? o.targets : [],
    );
    const view = chapterMapView(s, all, 'p1', targets);
    expect(view.known).toBe(all.length);
    expect(view.lanes.length).toBeGreaterThan(0);
    expect(view.cells.some((c) => c.side === 'hostile')).toBe(true);
    expect(
      view.cells
        .filter((c) => c.objective)
        .map((c) => c.id)
        .sort(),
    ).toEqual([...targets].sort());
    for (const c of view.cells) expect(c.kind).not.toBeNull();
  });

  it('мусор в памяти разведки не ломает панель', () => {
    const view = chapterMapView(pveState(data, 0), ['no_such_sector', 'no_such_sector']);
    expect(view.known).toBe(1);
  });
});
