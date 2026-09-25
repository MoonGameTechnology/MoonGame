import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { pveChapter, pveState, PVE_MISSION_COUNT } from '../packages/client/src/gameData';
import { chapterMapView, chapterTargets } from './chapterMap';

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
      else expect(c).toMatchObject({ known: false, kind: null, side: null, objective: null });
    }
    // Проходы видны только между двумя ИЗВЕСТНЫМИ провинциями: в туман линия не ведёт.
    const pos = new Map(home.map((id) => [`${s.planets[id]!.position.x},${s.planets[id]!.position.y}`, id]));
    for (const [x1, y1, x2, y2] of view.lanes) {
      expect(pos.has(`${x1},${y1}`)).toBe(true);
      expect(pos.has(`${x2},${y2}`)).toBe(true);
    }
  });

  it('разведанное показывает вид, сторону, проходы и цели задач', () => {
    const s = pveState(data, 1);
    const all = Object.keys(s.planets);
    const targets = pveChapter(1).objectives.flatMap((o) =>
      o.kind === 'control' ? o.targets : [],
    );
    const view = chapterMapView(s, all, 'p1', { active: targets, later: [] });
    expect(view.known).toBe(all.length);
    expect(view.lanes.length).toBeGreaterThan(0);
    expect(view.cells.some((c) => c.side === 'hostile')).toBe(true);
    expect(
      view.cells
        .filter((c) => c.objective === 'active')
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

describe('цели задач на карте главы (заказ владельца 2026-09-24)', () => {
  const s = pveState(data, 1);
  const pool = pveChapter(1).objectives;
  const control = pool.find((o) => o.kind === 'control')!;
  const raze = pool.find((o) => o.kind === 'raze')!;
  const razeWorlds = Object.values(s.planets)
    .filter((p) => p.buildings.some((b) => raze.targets.includes(b.type)))
    .map((p) => p.id);

  it('активная задача и «позже» различаются; одна клетка — одна метка', () => {
    const t = chapterTargets(s, pool, new Set([control.id]), new Set(Object.keys(s.planets)));
    expect([...t.active].sort()).toEqual([...control.targets].sort());
    expect(t.later).toEqual(expect.arrayContaining(razeWorlds));
    for (const id of t.active) expect(t.later).not.toContain(id);
  });

  it('захват метится и в тумане — задача сама называет место', () => {
    const t = chapterTargets(s, [control], new Set([control.id]), new Set());
    const view = chapterMapView(s, [], 'p1', t);
    const cell = view.cells.find((c) => c.id === control.targets[0])!;
    expect(cell.known).toBe(false);
    expect(cell.objective).toBe('active');
    expect(cell.side).toBeNull();
  });

  it('зачистка метится только по разведанному — метка не выдаёт разведку', () => {
    expect(razeWorlds.length).toBeGreaterThan(0);
    expect(chapterTargets(s, [raze], new Set([raze.id]), new Set()).active).toEqual([]);
    expect(chapterTargets(s, [raze], new Set([raze.id]), new Set(razeWorlds)).active).toEqual(
      [...razeWorlds].sort(),
    );
  });

  it('разведка, волны и форты одной точки не имеют', () => {
    const rest = pool.filter((o) => ['scout', 'wave', 'build'].includes(o.kind));
    const t = chapterTargets(s, rest, new Set(rest.map((o) => o.id)), new Set(Object.keys(s.planets)));
    expect(t).toEqual({ active: [], later: [], tasks: {} });
  });

  it('клетка знает свои задачи — тап по метке показывает, какая это задача (2026-09-25)', () => {
    // Заказ владельца: «на карте главы, если нажать на кружок задания, можно прочитать, что
    // за задание». Метка знала только «активна/позже», а не саму задачу.
    const t = chapterTargets(s, pool, new Set([control.id]), new Set(Object.keys(s.planets)));
    const view = chapterMapView(s, [], 'p1', t);
    const cell = (id: string) => view.cells.find((c) => c.id === id)!;
    expect(cell(control.targets[0]!).tasks[0]).toBe(control.id); // активная — первой
    for (const id of razeWorlds) expect(cell(id).tasks).toContain(raze.id);
    expect(view.cells.filter((c) => c.objective === null).every((c) => c.tasks.length === 0)).toBe(true);
    // Без целей (старый вызов) у клеток просто нет задач.
    expect(chapterMapView(s, []).cells.every((c) => c.tasks.length === 0)).toBe(true);
  });
});
