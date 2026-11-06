/**
 * ЧУЖОЙ ВЫЛЕТ В ПОЛЁТЕ (резолюция владельца 2026-11-06): «в зоне прямой видимости их видно,
 * в зоне радара только сигнал, и им нужна своя сигнатура».
 *
 * Карта: мир p1 «A» в (0,0) с обзором 120 (общий по умолчанию) и радаром 3-го уровня на
 * 500; мир p2 «Z» в (600,0) — база вылета. Эскадра p2 летит из Z к A: на старте она вне
 * радара, на трети пути (400,0) — под радаром, но вне обзора, на 5/6 пути (100,0) — в обзоре.
 */
import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData } from '../data/schemas';
import { pairKey } from './diplomacy';
import {
  createInitialState,
  type GameState,
  type Planet,
  type Player,
  type ShuttleStrike,
} from './gameState';
import { radarSignatures, sortiesSeenBy, visibleState } from './visibility';
import { MS_PER_HOUR } from '../util/time';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    scout: { faction: 'x', stats: { attack: 2, defense: 2, speed: 6, hp: 40 } },
    interceptor: {
      faction: 'x',
      traits: ['shuttle'],
      signature: 3,
      stats: { attack: 4, defense: 3, speed: 100, hp: 10, strikeRange: 800, shuttleDamage: 22 },
    },
  },
  factions: {},
  buildings: { radar: { name: 'Radar', radarRange: 500 } },
  events: {},
});

const H = MS_PER_HOUR;

const player = (id: string): Player => ({ id, name: id, faction: 'x', status: 'active', resources: {} });

const planet = (id: string, owner: string | null, x: number, extra: Partial<Planet> = {}): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  links: [],
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  ...extra,
});

/** Вылет p2 из Z (600,0) к A (0,0) за 6 часов. Всё, что зритель видеть не должен, заполнено. */
const sortie = (over: Partial<ShuttleStrike> = {}): ShuttleStrike => ({
  id: 'strike:9',
  owner: 'p2',
  base: { kind: 'planet', id: 'Z' },
  squadronId: 'sq:p2:secret',
  units: [{ unit: 'interceptor', count: 2, modules: ['afterburner'], hp: 15 }],
  target: { kind: 'planet', id: 'A' },
  to: { x: 0, y: 0 },
  departedAt: 0,
  arrivesAt: 6 * H,
  leg: 'out',
  damage: 4,
  ...over,
});

function world(time: number, strikes: ShuttleStrike[], extra: Partial<GameState> = {}): GameState {
  const s = createInitialState({ seed: 'sorties', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    time,
    players: { p1: player('p1'), p2: player('p2'), p3: player('p3') },
    planets: {
      A: planet('A', 'p1', 0, { buildings: [{ type: 'radar', level: 3, hp: 10 }] }),
      M: planet('M', null, 300),
      Z: planet('Z', 'p2', 600),
    },
    fleets: {},
    heroes: {},
    battles: {},
    strikes,
    ...extra,
  };
}

const IN_SIGHT = 5 * H; // (100,0): в обзоре мира A
const ON_RADAR = 2 * H; // (400,0): под радаром, вне обзора
const FAR = 0; // (600,0): вне радара

describe('чужой вылет в полёте — глазами видно, радаром только сигнал', () => {
  it('В ОБЗОРЕ виден точкой, скоростью, ногой и составом — без базы, цели, эскадры и срока', () => {
    expect(sortiesSeenBy(world(IN_SIGHT, [sortie()]), 'p1', data)).toStrictEqual([
      {
        owner: 'p2',
        at: { x: 100, y: 0 },
        velocity: { x: -100 / 60, y: 0 },
        leg: 'out',
        units: [{ unit: 'interceptor', count: 2 }],
      },
    ]);
  });

  it('ВНЕ ОБЗОРА не виден; обратная нога видна так же, как прямая', () => {
    expect(sortiesSeenBy(world(ON_RADAR, [sortie()]), 'p1', data)).toEqual([]);
    // Домой: из A (0,0) к Z (600,0), через час — (100,0), в обзоре.
    const back = sortie({ leg: 'back', departedAt: 0, arrivesAt: 6 * H });
    expect(sortiesSeenBy(world(H, [back]), 'p1', data)).toMatchObject([
      { at: { x: 100, y: 0 }, velocity: { x: 100 / 60, y: 0 }, leg: 'back' },
    ]);
  });

  it('ВИСЯЩИЙ ПАТРУЛЬ сюда не входит: его видят по своим правилам (`seenPatrols`)', () => {
    const hanging = sortie({ leg: 'patrol', to: { x: 100, y: 0 }, patrol: { hours: 4, radius: 60, hold: true } });
    expect(sortiesSeenBy(world(IN_SIGHT, [hanging]), 'p1', data)).toEqual([]);
  });

  it('СВОЙ — в `strikes`, а не здесь; вылет СОЮЗНИКА виден всегда, врагу — нет', () => {
    expect(sortiesSeenBy(world(IN_SIGHT, [sortie({ owner: 'p1' })]), 'p1', data)).toEqual([]);
    // (400,0): вне обзора и p1, и p2 — союзник p1 всё равно его видит.
    const allied = world(ON_RADAR, [sortie({ owner: 'p3' })], {
      diplomacy: { [pairKey('p1', 'p3')]: 'alliance' },
    });
    expect(sortiesSeenBy(allied, 'p1', data)).toMatchObject([{ owner: 'p3', at: { x: 400, y: 0 } }]);
    expect(radarSignatures(allied, 'p1', data)).toEqual([]); // и отметкой поверх не дублируется
    expect(sortiesSeenBy(allied, 'p2', data)).toEqual([]);
  });

  it('ПОД РАДАРОМ — безымянная отметка авиации по сигнатуре машин, в обзоре и вне радара её нет', () => {
    // 2 перехватчика × сигнатура 3 = 6: размер M.
    expect(radarSignatures(world(ON_RADAR, [sortie()]), 'p1', data)).toStrictEqual([
      { location: 'M', size: 'M', position: { x: 400, y: 0 }, air: true },
    ]);
    expect(radarSignatures(world(IN_SIGHT, [sortie()]), 'p1', data)).toEqual([]);
    expect(radarSignatures(world(FAR, [sortie()]), 'p1', data)).toEqual([]);
  });

  it('НЕВИДИМЫЙ ВИСЯЩИЙ ПАТРУЛЬ под радаром — тоже отметка авиации над его точкой', () => {
    const hanging = sortie({ leg: 'patrol', to: { x: 400, y: 0 }, patrol: { hours: 4, radius: 60, hold: true } });
    expect(radarSignatures(world(ON_RADAR, [hanging]), 'p1', data)).toStrictEqual([
      { location: 'M', size: 'M', position: { x: 400, y: 0 }, air: true },
    ]);
  });

  it('ПРОЕКЦИЯ: зритель получает `seenSorties`, чужой вылет в `strikes` не попадает', () => {
    const view = visibleState(world(IN_SIGHT, [sortie()]), 'p1', data);
    expect(view.strikes).toBeUndefined();
    expect(view.seenSorties).toHaveLength(1);
    expect(JSON.stringify(view.seenSorties)).not.toMatch(/secret|afterburner|strike:9|"Z"/);
    // Под одним радаром — ни строки в `seenSorties`.
    expect(visibleState(world(ON_RADAR, [sortie()]), 'p1', data).seenSorties).toBeUndefined();
    // Хозяин видит свой вылет целиком в `strikes`, а `seenSorties` у него нет.
    const owner = visibleState(world(IN_SIGHT, [sortie()]), 'p2', data);
    expect(owner.strikes?.map((st) => st.id)).toEqual(['strike:9']);
    expect(owner.seenSorties).toBeUndefined();
  });
});
