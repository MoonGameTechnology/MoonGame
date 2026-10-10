/**
 * Туман карты (REFM-231, второй PR) — прямой тест владельца зрения и памяти разведки.
 *
 * Зрение снаружи только читают, менять его можно дверями модуля, поэтому здесь проверено
 * то, что текстом не проверить: до первого пересчёта туман выключен, пересчёт видит свой мир
 * и пишет в память только опознанное, тот же мир берёт запомненное зрение, а новый мир,
 * песочница и смена матча — свежее, сеть берёт сигнатуры и патрули у сервера, окна шпионажа
 * открывают мир и флоты, а вопросы к туману (флот, бой, событие журнала, детали мира)
 * отвечают по тому же зрению. Каждый тест — свежая загрузка модуля: у тумана своё состояние.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  createInitialState,
  type Battle,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
  type SignatureContact,
} from '../../packages/shared-core/src/index';

// Первая загрузка тянет ядро и данные игры — секунды под нагрузкой полного гейта. Граф
// греется один раз; тесты после `vi.resetModules()` берут его из кеша трансформаций.
beforeAll(async () => {
  await import('./mapFog');
}, 60_000);
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('__PLAYER_BUILD__', false);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const IDS = ['A', 'B', 'C', 'D', 'E'] as const;

const planet = (id: string, x: number): Planet => ({
  id,
  owner: null,
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

const fleet = (id: string, owner: string, location: string): Fleet =>
  ({
    id,
    owner,
    location,
    movement: null,
    units: [{ unit: 'frigate', count: 1 }],
    traits: [],
    battleId: null,
  }) as unknown as Fleet;

/** Цепочка A…E с шагом далеко за обзором мира: A — свой и единственный опознанный. */
function base(patch: (st: GameState) => void = () => {}): GameState {
  const st = createInitialState({ seed: 'fog', version: { data: '0.1.0', manifest: '1' } });
  const planets: Record<string, Planet> = {};
  IDS.forEach((id, i) => {
    planets[id] = planet(id, i * 10_000);
  });
  planets.A!.owner = 'p1';
  const out: GameState = {
    ...st,
    time: 1000,
    planets,
    players: { p1: player('p1'), p2: player('p2') },
  };
  patch(out);
  return out;
}

async function boot(w: GameState = base()) {
  const env = { world: w, me: 'p1', net: false, contacts: [] as SignatureContact[] };
  const fog = await import('./mapFog');
  fog.initMapFog({
    world: () => env.world,
    me: () => env.me,
    net: () => env.net,
    contacts: () => env.contacts,
    sight: () => [],
  });
  return { fog, env };
}

describe('REFM-231 — зрение кадра', () => {
  it('до первого пересчёта тумана нет: видно всё', async () => {
    const { fog } = await boot();
    expect(fog.vision).toBeNull();
    expect(fog.known('E')).toBe(true);
  });

  it('пересчёт опознаёт свой мир, а не дальний, и память пишет только опознанное', async () => {
    const { fog } = await boot();
    fog.refreshVision();
    expect([fog.known('A'), fog.known('E'), fog.known(null)]).toEqual([true, false, false]);
    expect([fog.memory.has('A'), fog.memory.has('E')]).toEqual([true, false]);
  });

  it('тот же мир — то же зрение; новый мир, забвение и смена матча — пересчёт', async () => {
    const { fog, env } = await boot();
    fog.refreshVision();
    const first = fog.vision;
    fog.refreshVision();
    expect(fog.vision).toBe(first);
    env.world = { ...env.world };
    fog.refreshVision();
    const second = fog.vision;
    expect(second).not.toBe(first);
    fog.forgetVision();
    fog.refreshVision();
    expect(fog.vision).not.toBe(second);
    const third = fog.vision;
    fog.resetFogMemory();
    expect(fog.memory.has('A')).toBe(false);
    fog.refreshVision();
    expect(fog.vision).not.toBe(third);
    expect(fog.memory.has('A')).toBe(true);
  });

  it('смена своего места — тоже пересчёт', async () => {
    const { fog, env } = await boot(base((st) => (st.planets.E!.owner = 'p2')));
    fog.refreshVision();
    expect(fog.known('E')).toBe(false);
    env.me = 'p2';
    fog.refreshVision();
    expect([fog.known('E'), fog.known('A')]).toEqual([true, false]);
  });

  it('песочница с выключенным туманом снимает его только в соло', async () => {
    const { fog, env } = await boot();
    const { sandboxConfig } = await import('./sandbox');
    sandboxConfig.enabled = true;
    sandboxConfig.fog = false;
    fog.refreshVision();
    expect(fog.vision).toBeNull();
    expect(fog.known('E')).toBe(true);
    env.net = true;
    fog.refreshVision();
    expect(fog.known('E')).toBe(false);
  });

  it('в сети сигнатуры и чужие патрули берутся из проекции сервера', async () => {
    const patrols = [{ id: 'strike:1' }] as unknown as GameState['seenPatrols'];
    const { fog, env } = await boot(base((st) => (st.seenPatrols = patrols)));
    env.contacts = [{ id: 'c1' }] as unknown as SignatureContact[];
    fog.refreshVision();
    expect(fog.vision?.signatures).not.toBe(env.contacts); // соло считает сигнатуры само
    // Тот же мир, тот же игрок и те же контакты, но сеть включилась — зрение новое.
    env.net = true;
    fog.refreshVision();
    expect(fog.vision?.signatures).toBe(env.contacts);
    expect(fog.vision?.seenPatrols).toBe(patrols);
    // Новые контакты сервера — новое зрение, даже если мир прежний.
    const was = fog.vision;
    env.contacts = [];
    fog.refreshVision();
    expect(fog.vision).not.toBe(was);
  });
});

describe('REFM-231 — окна шпионажа', () => {
  const grant = (kind: 'planet' | 'fleets', target: string, until: number) => (st: GameState) => {
    st.intel = { p1: [{ kind, target, until }] };
  };

  it('живое окно по миру опознаёт его и пишет в память, истёкшее — нет', async () => {
    const live = await boot(base(grant('planet', 'E', 5000)));
    live.fog.refreshVision();
    expect(live.fog.myIntel()).toHaveLength(1);
    expect([live.fog.known('E'), live.fog.memory.has('E')]).toEqual([true, true]);
    vi.resetModules();
    const gone = await boot(base(grant('planet', 'E', 500)));
    gone.fog.refreshVision();
    expect(gone.fog.myIntel()).toHaveLength(0);
    expect(gone.fog.known('E')).toBe(false);
  });

  it('окно по флотам показывает флоты хозяина в тумане', async () => {
    const foe = fleet('f2', 'p2', 'E');
    const at = (st: GameState) => (st.fleets = { f2: foe, f1: fleet('f1', 'p1', 'A') });
    const plain = await boot(base(at));
    plain.fog.refreshVision();
    expect(plain.fog.fleetSeen(foe)).toBe(false);
    expect(plain.fog.fleetSeen(plain.env.world.fleets.f1!)).toBe(true); // свой — всегда
    vi.resetModules();
    const spied = await boot(
      base((st) => {
        at(st);
        grant('fleets', 'p2', 5000)(st);
      }),
    );
    spied.fog.refreshVision();
    expect(spied.fog.fleetSeen(foe)).toBe(true);
  });
});

describe('REFM-231 — вопросы к туману', () => {
  it('в сети флот из проекции опознан самим присутствием, в соло — по зрению', async () => {
    const foe = fleet('f2', 'p2', 'E');
    const { fog, env } = await boot(base((st) => (st.fleets = { f2: foe })));
    fog.refreshVision();
    expect(fog.fleetKnown(foe)).toBe(false);
    expect(fog.fleetNode(foe)).toBe('E');
    env.net = true;
    expect(fog.fleetKnown(foe)).toBe(true);
  });

  it('бой виден по опознанному узлу или когда в нём дерусь я', async () => {
    const sides = (owner: string) => [
      { ref: { kind: 'fleet', fleetId: 'x' }, owner, role: 'attacker' },
    ];
    const fight = (id: string, location: string, owner: string) =>
      ({ id, location, sides: sides(owner) }) as unknown as Battle;
    const mine = fight('battle:1', 'E', 'p1');
    const theirs = fight('battle:2', 'D', 'p2');
    const { fog } = await boot(
      base((st) => (st.battles = { [mine.id]: mine, [theirs.id]: theirs })),
    );
    fog.refreshVision();
    expect(fog.battleKnown(mine)).toBe(true);
    expect(fog.battleKnown(theirs)).toBe(false);
    expect(fog.battleKnown(fight('battle:3', 'A', 'p2'))).toBe(true);
  });

  it('журнал пускает чужое событие только из опознанного мира, своё — всегда', async () => {
    const { fog } = await boot();
    fog.refreshVision();
    expect(fog.admits('building.destroyed', { owner: 'p2', planetId: 'E' })).toBe(false);
    expect(fog.admits('building.destroyed', { owner: 'p2', planetId: 'A' })).toBe(true);
    expect(fog.admits('building.constructed', { owner: 'p2', planetId: 'A' })).toBe(false);
    expect(fog.admits('building.constructed', { owner: 'p1', planetId: 'E' })).toBe(true);
  });

  it('детали мира видны, если он опознан или свой', async () => {
    const { fog, env } = await boot();
    fog.refreshVision();
    const far = env.world.planets.E!;
    expect(fog.seesDetails(far)).toBe(false);
    expect(fog.seesDetails({ ...far, owner: 'p1' })).toBe(true);
    expect(fog.seesDetails(env.world.planets.A!)).toBe(true);
  });
});

describe('REFM-231 — память разведки', () => {
  it('увиденный захват пишется дверью, и память переживает сохранение', async () => {
    const { fog } = await boot();
    fog.refreshVision();
    fog.rememberScan(['E']);
    expect(fog.memory.get('E')).toBeDefined();
    const saved = fog.memory.dump();
    fog.resetFogMemory();
    expect([fog.memory.has('A'), fog.memory.has('E')]).toEqual([false, false]);
    fog.restoreFogMemory(saved);
    expect([fog.memory.has('A'), fog.memory.has('E')]).toEqual([true, true]);
  });

  it('в сети память берёт и то, что помнит сервер', async () => {
    const remembered = (st: GameState) => Object.assign(st, { remembered: ['D'] });
    const { fog, env } = await boot(base(remembered));
    env.net = true;
    fog.refreshVision();
    expect([fog.known('D'), fog.memory.has('D')]).toEqual([false, true]);
  });
});

describe('REFM-231 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const FOG = readFileSync(new URL('./mapFog.ts', import.meta.url), 'utf8');
  // Захват, который игрок видел, пишет в память разведки разбор событий (`eventFeed.ts`).
  const FEED = readFileSync(new URL('./eventFeed.ts', import.meta.url), 'utf8');
  const init = /initMapFog\(\{([\s\S]*?)\n\}\);/.exec(MAIN)?.[1] ?? '';

  it('хуки тумана — мир, своё место, сеть, контакты радара и круги обзора кадра', () => {
    for (const hook of [
      'world: () => s,',
      'me: () => ME,',
      'net: () => NET,',
      'contacts: () => netSignatures,',
      "sight: () => perWorld('sight', () => sightCircles(s, ME, data)),",
    ]) {
      expect(init, hook).toContain(hook);
    }
  });

  it('зрение и память разведки меняют только двери владельца', () => {
    expect(MAIN).not.toMatch(/^\s*vision = /m);
    // Упоминание в комментарии (в обратных кавычках) — не код.
    expect(MAIN).not.toMatch(/(?<!`)\b(visionMemo|intelFleetOwners|createScanMemory)\b(?!`)/);
    expect(MAIN).not.toMatch(/\bmemory\.(remember|clear|restore)\(/);
    expect(MAIN).not.toMatch(
      /\bfunction (computeVision|currentVision|fogVision|myIntel|fleetNode|fleetSeen|fleetKnown|fleetSeenHere|battleKnown|updateMemory|known|admits|seesDetails)\(/,
    );
    // Смена матча чистит память вместе с запомненным зрением, песочница — только зрение.
    expect(MAIN).toMatch(/resetEventFeed\(\);[^\n]*\n\s*resetFogMemory\(\);/);
    expect(MAIN).toMatch(/enforceSandbox\(s, ME, sandboxHomeId\);\n\s*forgetVision\(\);/);
    expect(FEED).toContain('rememberScan([p.planetId as string]);');
    expect(MAIN).toContain('restoreFogMemory(save.memory);');
  });

  it('модуль не тянет `main.ts`, а мост роботов находит всё, что открывает', () => {
    expect(FOG).not.toMatch(/from '\.\/main'/);
    // `prototype/fogBridge.mjs` дописывает ручки в конец модуля: имя, пропавшее отсюда,
    // уронило бы сборку робота, а не этот гейт.
    for (const decl of [
      /export let vision\b/,
      /function computeVision\(/,
      /let intelFleetOwners\b/,
      /const scans = /,
      /function updateMemory\(/,
    ]) {
      expect(FOG).toMatch(decl);
    }
  });
});
