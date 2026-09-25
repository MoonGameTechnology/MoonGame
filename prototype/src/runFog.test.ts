/**
 * Туман забега на настоящих картах глав (решение владельца 2026-09-24: «круги везде»,
 * «для Sector Zero — свой по цифрам»; 2026-09-25: «только планету колонии, плюс крепость
 * даёт небольшой; без радара колония — совсем маленький обзор 100»). Правило держит ядро
 * (`state/visibility.test.ts`); здесь — что числа режима забега дают на картах глав ту
 * картину, ради которой их меняли: захваченное поле или мёртвый мир без радара не
 * открывает соседей, колония без радара видит только ближний круг, дальше видит радар.
 */
import { describe, expect, it } from 'vitest';
import { data } from './gameData';
import { pveModeId, pveState } from '../../packages/client/src/gameData';
import { freshSectorZeroProgress, prepareSectorZeroRun } from '../../decisions/sectorZeroProgress';
import {
  fleetRadarRange,
  sensorCoverage,
  sightCircles,
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
  it('у режима забега свои числа: колония и крепость видят 100, остальные виды — только себя', () => {
    expect(data.modes.pve_waves?.sight).toEqual({
      world: 0,
      byKind: { planet: 100, void_station: 100 },
      fleet: 90,
      radarScale: 2.5,
    });
  });

  it('каждый вид в таблице обзора — настоящий вид провинции', () => {
    // Опечатка в виде молча оставила бы колонии без обзора: таблица читается по ключу.
    const unknown = Object.values(data.modes)
      .flatMap((m) => Object.keys(m.sight?.byKind ?? {}))
      .filter((kind) => !data.sectorKinds[kind]);
    expect(unknown).toEqual([]);
  });

  it('глава I: видно пиратов у дома; дрейф — только засечка радара; дальний мир — нет', () => {
    const rows = byDistance(runStart(0));
    const seen = (id: string) => rows.find((r) => r.id === id)!;
    expect(['home_a', 'pirate_den'].map((id) => seen(id).identified)).toEqual([true, true]);
    // Опознаёт дом своим радаром (половина засечки); дрейф и скопление — только засечка.
    expect([seen('drift').identified, seen('drift').radar]).toEqual([false, true]);
    expect([seen('cluster').identified, seen('cluster').radar]).toEqual([false, true]);
    expect([seen('home_b').identified, seen('home_b').radar]).toEqual([false, false]);
  });

  it('глава II: захваченные поле и мёртвый мир без радара не открывают соседей', () => {
    const st = runStart(1);
    const world = (id: string) =>
      sightCircles(st, 'p1', data).find((c) => c.source.kind === 'world' && c.source.id === id)!;
    expect([world('cold_shoal').identify, world('deep_drift').identify]).toEqual([0, 0]);
    // «Споровое облако» в 171 от отмели: раньше его открывал круг поля, теперь — лишь засечка
    // радара Плацдарма.
    const { identify, radar } = sensorCoverage(st, 'p1', data);
    expect([identify.has('spore_cloud'), radar.has('spore_cloud')]).toEqual([false, true]);
    expect([identify.has('cold_shoal'), identify.has('deep_drift')]).toEqual([true, true]);
  });

  it('колония без радара видит только ближний круг: взятый ретранслятор не открывает Гнездо', () => {
    const st = runStart(1);
    const relay = st.planets.relay!;
    relay.owner = 'p1';
    relay.buildings = relay.buildings.filter((b) => b.type !== 'radar');
    const circle = sightCircles(st, 'p1', data).find((c) => c.source.id === 'relay')!;
    expect([circle.identify, circle.signature]).toEqual([100, 100]);
    expect(sensorCoverage(st, 'p1', data).identify.has('nest')).toBe(false); // 194 от ретранслятора
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
