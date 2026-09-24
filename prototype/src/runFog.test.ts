/**
 * Туман забега на настоящих картах глав (решение владельца 2026-09-24: «круги везде»,
 * «для Sector Zero — свой по цифрам»). Правило держит ядро (`state/visibility.test.ts`);
 * здесь — что числа режима забега дают на картах глав ту картину, ради которой их меняли:
 * видно ближнее, не видно дальнего, и никакой мир не раскрывается «через голову» более
 * близкого.
 */
import { describe, expect, it } from 'vitest';
import { data } from './gameData';
import { pveModeId, pveState } from '../../packages/client/src/gameData';
import { freshSectorZeroProgress, prepareSectorZeroRun } from '../../decisions/sectorZeroProgress';
import {
  fleetRadarRange,
  sensorCoverage,
  type GameState,
} from '../../packages/shared-core/src/index';

/** Старт главы так, как его видит игрок: профиль по умолчанию и числа режима забега —
 *  ровно то, что `visibilityModule` закрепляет на первом шаге часов. */
function runStart(chapter: number): GameState {
  const st = prepareSectorZeroRun(
    pveState(data, chapter),
    freshSectorZeroProgress(data, 'fog'),
    data,
  );
  st.sight = { ...data.modes[pveModeId(chapter) ?? '']!.sight! };
  return st;
}

/** Расстояние — до БЛИЖАЙШЕГО своего мира: у игрока бывает не один стартовый мир (во
 *  второй главе — колония с беженцами и осаждённый гарнизон, задачи владельца 2026-09-24),
 *  и круг зрения стоит вокруг каждого. */
function byDistance(st: GameState) {
  const own = Object.values(st.planets).filter((p) => p.owner === 'p1');
  const { identify, radar } = sensorCoverage(st, 'p1', data);
  return Object.values(st.planets).map((p) => ({
    id: p.id,
    d: Math.min(
      ...own.map((o) => Math.hypot(p.position.x - o.position.x, p.position.y - o.position.y)),
    ),
    identified: identify.has(p.id),
    radar: radar.has(p.id),
  }));
}

describe('туман забега — круги на картах глав', () => {
  it('у режима забега свои числа', () => {
    expect(data.modes.pve_waves?.sight).toEqual({ world: 330, fleet: 90, radarScale: 2.5 });
  });

  it('глава I: видно пиратов и ближний дрейф; дальний мир по линии — нет', () => {
    const rows = byDistance(runStart(0));
    const seen = (id: string) => rows.find((r) => r.id === id)!;
    expect(['home_a', 'pirate_den', 'drift'].map((id) => seen(id).identified)).toEqual([
      true,
      true,
      true,
    ]);
    // 521 — только засечка радара; 781 по линии, раньше раскрытый целиком, — скрыт.
    expect([seen('cluster').identified, seen('cluster').radar]).toEqual([false, true]);
    expect([seen('home_b').identified, seen('home_b').radar]).toEqual([false, false]);
  });

  for (const chapter of [0, 1])
    it(`глава ${chapter + 1}: зрение монотонно — опознанный мир не дальше неопознанного`, () => {
      // На старте глаза игрока — его миры и флоты у них, поэтому картина обязана быть
      // кругами: самый дальний опознанный ближе самого близкого неопознанного.
      const rows = byDistance(runStart(chapter));
      const farthestSeen = Math.max(...rows.filter((r) => r.identified).map((r) => r.d));
      const nearestHidden = Math.min(...rows.filter((r) => !r.identified).map((r) => r.d));
      expect(farthestSeen).toBeLessThan(nearestHidden);
    });

  it('разведдрон стартового флота — с радаром: разведчик больше не слепой', () => {
    const st = runStart(0);
    const scouting = Object.values(st.fleets).filter(
      (f) => f.owner === 'p1' && f.units.some((u) => u.unit === 'scout_drone'),
    );
    expect(scouting.length).toBeGreaterThan(0);
    for (const f of scouting) expect(fleetRadarRange(f, data)).toBeGreaterThan(0);
  });
});
