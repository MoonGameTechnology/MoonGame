/**
 * Радар на карте (REFM-239) — прямой тест владельца: развёртка, контакты и картины
 * дальности.
 *
 * Здесь проверено то, что текстом не проверить: лучи идут от своих источников и сливаются
 * по месту, прозрачность гасит хром, но не механику, рука красит контакт только проходом и
 * пишет ленту один раз на контакт, а пинг — раз на кадр, контакт гаснет через оборот без
 * повтора, двери владельца сбрасывают память и кладут сигнатуры, граница обзора рисует круги
 * хука, а дальномер открывается только у выбранного разведанного мира. Каждый тест — свежая
 * загрузка модулей: у камеры, тумана и радара своё состояние.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
  type SightCircle,
  type SignatureContact,
} from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import type { RadarSources } from './mapRadar';

// Первая загрузка тянет ядро и данные игры — секунды под нагрузкой полного гейта. Граф
// греется один раз; тесты после `vi.resetModules()` берут его из кеша трансформаций.
beforeAll(async () => {
  await import('./mapRadar');
}, 60_000);
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('__PLAYER_BUILD__', false); // туман читает профиль сборки
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const planet = (id: string, x: number, owner: string | null = null): Planet => ({
  id,
  owner,
  kind: 'planet',
  position: { x, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  links: [],
});

const player = (id: string): Player =>
  ({ id, name: id, faction: 'azure', status: 'active', resources: {} }) as Player;

const fleet = (id: string, owner: string, unit: string, location = 'A'): Fleet =>
  ({
    id,
    owner,
    location,
    movement: null,
    units: [{ unit, count: 1 }],
    traits: [],
    battleId: null,
  }) as unknown as Fleet;

/** Миры A (свой), B, C по оси x, шаг 1000. */
function base(patch: (st: GameState) => void = () => {}): GameState {
  const st = createInitialState({ seed: 'radar', version: { data: '0.1.0', manifest: '1' } });
  const out: GameState = {
    ...st,
    time: 0,
    planets: { A: planet('A', 0, 'p1'), B: planet('B', 1000), C: planet('C', 2000, 'p2') },
    players: { p1: player('p1'), p2: player('p2') },
    fleets: {},
    battles: {},
  };
  patch(out);
  return out;
}

/** Холст-самописец: какие методы звали и с чем; свойства просто запоминает. */
function fakeCanvas(conic = true) {
  const calls: Array<[string, unknown[]]> = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'createConicGradient' && !conic) return undefined;
      return (...args: unknown[]) => {
        calls.push([key, args]);
        return key.startsWith('create') ? { addColorStop: () => {} } : undefined;
      };
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const named = (name: string) => calls.filter(([k]) => k === name).map(([, a]) => a);
  return { ctx, calls, named };
}

async function boot(w: GameState = base(), opts: { conic?: boolean; net?: boolean } = {}) {
  const canvas = fakeCanvas(opts.conic ?? true);
  const env = {
    world: w,
    sources: { worlds: [], fleets: [] } as RadarSources,
    sight: [] as SightCircle[],
    contacts: [] as SignatureContact[],
    notes: [] as Array<[string, string | undefined]>,
    pings: 0,
  };
  const camera = await import('./mapCamera');
  camera.initMapCamera({
    vw: () => 1600,
    vh: () => 900,
    mobile: () => false,
    console: () => false,
    world: () => env.world,
    me: () => 'p1',
    select: () => {},
    closeDiplo: () => {},
    ring: () => {},
  });
  camera.frameMap(Object.values(w.planets).map((p) => p.position));
  const fog = await import('./mapFog');
  fog.initMapFog({
    world: () => env.world,
    me: () => 'p1',
    net: () => opts.net ?? false,
    contacts: () => env.contacts,
    sight: () => env.sight,
  });
  const geo = await import('./fleetGeometry');
  geo.initFleetGeometry({
    world: () => env.world,
    me: () => 'p1',
    now: () => 0,
    lod: () => ({ scale: 2, art: 1, detail: 1, provinceDetail: 1, markerRadius: 3 }),
    forkMarks: () => [],
    orbits: () => new Map() as never,
  });
  const radar = await import('./mapRadar');
  radar.initMapRadar({
    world: () => env.world,
    me: () => 'p1',
    ctx: () => canvas.ctx,
    vw: () => 1600,
    vh: () => 900,
    sources: () => env.sources,
    sight: () => env.sight,
    note: (text, at) => env.notes.push([text, at]),
    placeName: (id) => `«${id}»`,
    ping: () => env.pings++,
  });
  return { radar, camera, fog, env, canvas };
}

/** Время развёртки, при котором рука стоит на угле `ang` (`SWEEP_DIV` мс на радиан). */
const atAngle = (ang: number, div: number): number => ang * div;

describe('REFM-239 — двери владельца', () => {
  it('сигнатуры снимка кладёт дверь копией, контакты развёртки сбрасывает дверь', async () => {
    const { radar } = await boot();
    const list: SignatureContact[] = [{ location: 'B', size: 'M' } as SignatureContact];
    radar.takeNetSignatures(list);
    list.push({ location: 'C', size: 'S' } as SignatureContact);
    expect(radar.netSignatures).toEqual([{ location: 'B', size: 'M' }]);
    radar.takeNetSignatures([]);
    expect(radar.netSignatures).toEqual([]);
  });

  it('прозрачность хрома развёртки зажата в 0..1', async () => {
    const { radar } = await boot();
    expect(radar.sweepOpacity).toBe(1); // ключа нет — полная
    radar.setSweepOpacity(0.4);
    expect(radar.sweepOpacity).toBe(0.4);
    radar.setSweepOpacity(7);
    expect(radar.sweepOpacity).toBe(1);
    radar.setSweepOpacity(-2);
    expect(radar.sweepOpacity).toBe(0);
  });
});

describe('REFM-239 — дальность и источники', () => {
  it('источники развёртки — только свои миры и флоты, у которых радар есть', async () => {
    const w = base((st) => {
      st.planets.A!.buildings = [{ type: 'radar', level: 1, hp: 18 }];
      st.planets.C!.buildings = [{ type: 'radar', level: 1, hp: 18 }]; // чужой
      st.fleets = {
        s: fleet('s', 'p1', 'scout'),
        x: fleet('x', 'p1', 'frigate_no_such_unit'),
        z: fleet('z', 'p2', 'scout', 'C'),
      };
    });
    const { radar } = await boot(w);
    const own = radar.ownRadarSources();
    expect(own.worlds.map((v) => v.at)).toEqual([{ x: 0, y: 0 }]);
    expect(own.worlds[0]!.reach).toBe(radar.planetRadar(w.planets.A!));
    expect(own.fleets.map((v) => v.fleet.id)).toEqual(['s']);
    expect(own.fleets[0]!.reach).toBe(radar.fleetRadar(w.fleets.s!));
    expect(own.fleets[0]!.reach).toBeGreaterThan(0);
  });

  it('чужому миру — только масштаб режима; мир без массива слуха не имеет', async () => {
    const w = base((st) => {
      st.planets.C!.buildings = [{ type: 'radar', level: 1, hp: 18 }];
      st.sight = { world: 120, fleet: 40, radarScale: 2 };
      // Блэкаут хозяина — его беда, а не наша разведка: чужой мир его не знает.
      st.players.p2 = { ...player('p2'), arrears: ['energy'] } as Player;
    });
    const { radar } = await boot(w);
    const { data } = await import('./gameData');
    expect(radar.planetRadar(w.planets.C!)).toBe(data.buildings.radar!.radarRange! * 2);
    expect(radar.planetRadar(w.planets.B!)).toBe(0);
  });
});

describe('REFM-239 — развёртка', () => {
  it('без конического градиента развёртки нет: ни лучей, ни засветки', async () => {
    const { radar, env } = await boot(base(), { conic: false });
    env.sources = { worlds: [{ at: { x: 0, y: 0 }, reach: 500 }], fleets: [] };
    radar.drawScanSweep(1000);
    expect(radar.sweepOn).toBe(false);
    expect(radar.sweepArms).toEqual([]);
    expect(radar.sweepGlow({ x: 0, y: 0 })).toBe(0);
  });

  it('луч на источник; совпавшие по месту сливаются в дальний, флот несёт луч с собой', async () => {
    const { radar, env, camera } = await boot();
    env.sources = {
      worlds: [
        { at: { x: 0, y: 0 }, reach: 300 },
        { at: { x: 0, y: 0 }, reach: 700 },
        { at: { x: 2000, y: 0 }, reach: 200 },
      ],
      fleets: [{ fleet: fleet('s', 'p1', 'scout', 'B'), reach: 150 }],
    };
    radar.drawScanSweep(1000);
    expect(radar.sweepOn).toBe(true);
    const home = camera.world({ x: 0, y: 0 });
    const ship = camera.world({ x: 1000, y: 0 });
    expect(radar.sweepArms).toHaveLength(3);
    expect(radar.sweepArms[0]).toEqual({ x: home.x, y: home.y, r: camera.worldDist(700) });
    expect(radar.sweepArms[2]).toEqual({ x: ship.x, y: ship.y, r: camera.worldDist(150) });
  });

  it('засветка ярче всего там, где рука прошла только что', async () => {
    const { radar, env, camera } = await boot();
    env.sources = { worlds: [{ at: { x: 0, y: 0 }, reach: 1500 }], fleets: [] };
    radar.drawScanSweep(atAngle(0.01, radar.SWEEP_DIV)); // рука чуть за востоком
    const east = camera.world({ x: 1000, y: 0 });
    const west = camera.world({ x: -1000, y: 0 });
    expect(radar.sweepGlow(east)).toBeGreaterThan(0.9);
    expect(radar.sweepGlow(west)).toBeLessThan(radar.sweepGlow(east));
  });

  it('прозрачность гасит только хром: в нуле лучи посчитаны, а холст не тронут', async () => {
    const { radar, env, canvas } = await boot();
    env.sources = { worlds: [{ at: { x: 0, y: 0 }, reach: 500 }], fleets: [] };
    radar.setSweepOpacity(0);
    radar.drawScanSweep(1000);
    expect(radar.sweepOn).toBe(true);
    expect(radar.sweepArms).toHaveLength(1);
    expect(canvas.named('createConicGradient')).toHaveLength(0);
    radar.setSweepOpacity(1);
    radar.drawScanSweep(1000);
    expect(canvas.named('createConicGradient')).toHaveLength(1);
  });

  it('рука красит контакт проходом: лента — раз на контакт, пинг — раз на кадр', async () => {
    const { radar, env, fog } = await boot(base(), { net: true });
    env.sources = { worlds: [{ at: { x: 0, y: 0 }, reach: 1500 }], fleets: [] };
    // Контакт на востоке (угол 0) — рука проходит его между двумя кадрами.
    env.contacts = [
      { location: 'B', size: 'M', position: { x: 1000, y: 0 } },
      { location: 'B', size: 'S', position: { x: 1000, y: 0 } },
    ] as SignatureContact[];
    fog.refreshVision();
    const div = radar.SWEEP_DIV;
    const frame = (now: number) => {
      radar.drawScanSweep(now);
      radar.updateRadarContacts(now);
    };
    frame(atAngle(Math.PI, div)); // рука на западе — восток не задет
    expect([...radar.paintedContacts.values()]).toEqual([]);
    const crossed = atAngle(2 * Math.PI + 0.01, div);
    frame(atAngle(2 * Math.PI - 0.01, div));
    frame(crossed); // прошла восток
    expect([...radar.paintedContacts.values()].map((c) => c.size)).toEqual(['M', 'S']);
    expect(env.notes).toEqual([
      [t('threat.contact', { size: 'M', at: '«B»' }), 'B'],
      [t('threat.contact', { size: 'S', at: '«B»' }), 'B'],
    ]);
    expect(env.pings).toBe(1); // две цели в одном кадре — один пинг
    // Следующий оборот перекрашивает те же контакты: ленты нет, пинг есть.
    frame(atAngle(4 * Math.PI - 0.01, div));
    frame(atAngle(4 * Math.PI + 0.01, div));
    expect(env.notes).toHaveLength(2);
    expect(env.pings).toBe(2);
    // Дверь смены матча забывает всё нарисованное.
    radar.forgetRadarContacts();
    expect(radar.paintedContacts.size).toBe(0);
  });

  it('контакт без повторного прохода гаснет через оборот, а пока жив — рисуется', async () => {
    const { radar, env, fog, canvas } = await boot(base(), { net: true });
    env.sources = { worlds: [{ at: { x: 0, y: 0 }, reach: 1500 }], fleets: [] };
    env.contacts = [
      { location: 'B', size: 'L', position: { x: 1000, y: 0 } },
    ] as SignatureContact[];
    fog.refreshVision();
    const div = radar.SWEEP_DIV;
    for (const ang of [2 * Math.PI - 0.01, 2 * Math.PI + 0.01]) {
      radar.drawScanSweep(atAngle(ang, div));
      radar.updateRadarContacts(atAngle(ang, div));
    }
    const at = atAngle(2 * Math.PI + 0.01, div);
    radar.drawRadarContacts(at + 100);
    expect(canvas.named('fillText').map(([text]) => text)).toContain('◆L');
    expect(radar.paintedContacts.size).toBe(1);
    radar.drawRadarContacts(at + 2 * radar.SWEEP_PERIOD);
    expect(radar.paintedContacts.size).toBe(0);
  });

  it('без зрения (туман выключен) рука ничего не красит', async () => {
    const { radar, env } = await boot();
    env.sources = { worlds: [{ at: { x: 0, y: 0 }, reach: 1500 }], fleets: [] };
    for (const ang of [2 * Math.PI - 0.01, 2 * Math.PI + 0.01]) {
      radar.drawScanSweep(atAngle(ang, radar.SWEEP_DIV));
      radar.updateRadarContacts(atAngle(ang, radar.SWEEP_DIV));
    }
    expect(radar.paintedContacts.size).toBe(0);
    expect(env.pings).toBe(0);
  });
});

describe('REFM-239 — картины дальности', () => {
  const circle = (patch: Partial<SightCircle>): SightCircle =>
    ({
      x: 0,
      y: 0,
      signature: 600,
      identify: 300,
      owner: 'p1',
      source: { kind: 'world', id: 'A' },
      ...patch,
    }) as SightCircle;

  it('граница обзора — из кругов хука: без кругов холст не тронут', async () => {
    const { radar, canvas } = await boot();
    radar.drawRadarCoverage();
    expect(canvas.calls).toEqual([]);
  });

  it('у выбранного мира — ещё два своих кольца поверх общей границы', async () => {
    const { radar, env, canvas } = await boot();
    env.sight = [circle({})];
    radar.drawRadarCoverage();
    const plain = canvas.named('arc').length;
    const sel = await import('./interaction');
    sel.pickWorld('A');
    radar.drawRadarCoverage();
    expect(canvas.named('arc').length - plain * 2).toBe(2);
  });

  it('дальномер — только у выбранного мира, где разведан радар', async () => {
    const w = base((st) => {
      st.planets.A!.buildings = [{ type: 'radar', level: 1, hp: 18 }];
      st.planets.C!.buildings = [{ type: 'radar', level: 1, hp: 18 }];
    });
    const { radar, canvas, fog } = await boot(w);
    fog.refreshVision();
    radar.drawRadarRange(0);
    expect(canvas.calls).toEqual([]); // нет выбора — нет дальномера
    const sel = await import('./interaction');
    sel.pickWorld('C'); // чужой неразведанный мир: тап не разведка
    radar.drawRadarRange(0);
    expect(canvas.calls).toEqual([]);
    sel.pickWorld('A');
    radar.drawRadarRange(0);
    const reach = radar.planetRadar(w.planets.A!);
    expect(reach).toBeGreaterThan(0);
    expect(canvas.named('fillText').map(([text]) => text)).toEqual([
      t('map.radar.detect', { n: reach }),
      t('map.radar.identify', { n: Math.round(reach / 2) }),
    ]);
  });
});

describe('REFM-239 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const RADAR = readFileSync(new URL('./mapRadar.ts', import.meta.url), 'utf8');
  const init = /initMapRadar\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки радара — мир, место, канвас, экран, кэш кадра, лента, имя места и звук', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'ctx: () => cx,',
      'vw: () => VW,',
      'vh: () => VH,',
      "sources: () => perWorld('radar', ownRadarSources),",
      "sight: () => perWorld('sight', () => sightCircles(s, ME, data)),",
      'note,',
      'placeName,',
      "ping: () => snd.play('radar'),",
    ]) {
      expect(init, hook).toContain(hook);
    }
  });

  it('состояние радара меняют только двери владельца', () => {
    expect(MAIN).not.toMatch(
      /\bfunction (sweepGlow|ownRadarSources|drawScanSweep|updateRadarContacts|drawRadarContacts|fleetRadar|planetRadar|drawSignatureAt|drawUnionTier|drawRadarCoverage|drawRadarRange|setSweepOpacity)\(/,
    );
    expect(MAIN).not.toMatch(/\bradarMemory\.|\b(sweepArms|sweepAng|sweepPrevAng|SWEEP_DIV)\b/);
    expect(MAIN).not.toMatch(/^\s*(netSignatures|sweepOn|sweepOpacity) = /m);
    // Смена матча забывает контакты, снимок сервера кладёт свои — дверями.
    expect(MAIN).toMatch(/resetFogMemory\(\);[^\n]*\n\s*worldMemo = null;\n\s*forgetRadarContacts\(\);/);
    expect(MAIN).toContain('takeNetSignatures(radarContacts(snap.signatures));');
    // Туман берёт сигнатуры сервера у радара тем же хуком.
    expect(MAIN).toContain('contacts: () => netSignatures,');
  });

  it('модуль не тянет `main.ts`', () => {
    expect(RADAR).not.toMatch(/from '\.\/main'/);
  });
});
