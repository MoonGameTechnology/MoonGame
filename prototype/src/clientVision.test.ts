// RULES-5 — сторож «карта видит ровно то, что видит ядро».
//
// Клиент рисовал туман по СВОЕЙ копии правила, и копия была беднее ядра на три пункта.
// Тест держит каждый из них на живом каталоге прототипа: если правило снова начнут
// выводить вручную, любая из трёх проверок покажет это до плейтеста, а не на нём.
//
// Проверяется прямая функция ядра (`sensorCoverage`) — та самая, к которой клиент
// теперь и обращается. Это не тавтология: до правки эти три случая карта НЕ учитывала,
// и сторож фиксирует, что источник правды один.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildingLevel,
  createInitialState,
  sensorCoverage,
  setStance,
  type GameState,
  type Planet,
  type Player,
} from '../../packages/shared-core/src/index';
import { data } from './prototypeData';

/** Здание с радаром берём из каталога — через тот же аксессор, что и ядро. */
const RADAR_BUILDING = Object.keys(data.buildings).find(
  (id) => buildingLevel(data.buildings[id]!, 1).radarRange > 0,
)!;
const RADAR_L1 = buildingLevel(data.buildings[RADAR_BUILDING]!, 1).radarRange;
const RADAR_TECH = Object.keys(data.technologies).find(
  (id) => (data.technologies[id]?.effects.radarRangeBonus ?? 0) > 0,
)!;

// Геометрия подобрана под каталог: радар опознаёт на половину своей дальности, поэтому
// `FAR` стоит ЗА кромкой обычного радара, но В пределах раздвинутой технологией. Так
// «теха расширяет карту» проверяется наблюдаемым результатом, а не пересчётом формулы.
const REACH = RADAR_L1 / 2;
const FAR = Math.round(REACH * 1.05); // за кромкой обычного, внутри +15 %
const XS = [0, 40, 80, FAR, FAR + 200];
const IDS = ['A', 'B', 'C', 'D', 'E'] as const;

const world = (id: string, x: number, links: string[]): Planet => ({
  id,
  owner: null,
  kind: 'planet',
  position: { x, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  links,
});

const player = (id: string, patch: Partial<Player> = {}): Player =>
  ({ id, name: id, faction: 'azure', status: 'active', resources: {}, ...patch }) as Player;

/** Цепочка A—B—C—D—E; A — единственный свой мир. */
function base(patch: (st: GameState) => void = () => {}): GameState {
  const st = createInitialState({ seed: 'cv', version: { data: '0.1.0', manifest: '1' } });
  const planets: Record<string, Planet> = {};
  IDS.forEach((id, i) => {
    planets[id] = world(
      id,
      XS[i]!,
      [IDS[i - 1], IDS[i + 1]].filter((x): x is (typeof IDS)[number] => x !== undefined),
    );
  });
  planets.A!.owner = 'p1';
  const out: GameState = { ...st, time: 1000, planets, players: { p1: player('p1'), p2: player('p2') } };
  patch(out);
  return out;
}

const withRadar = (st: GameState): void => {
  st.planets.A!.buildings = [{ type: RADAR_BUILDING, level: 1, hp: 100 }];
};
const see = (st: GameState, who = 'p1'): Set<string> => sensorCoverage(st, who, data).identify;

describe('RULES-5 — три правила, которых у клиентской копии не было', () => {
  it('дальность радара растёт от исследованной технологии', () => {
    const plain = base(withRadar);
    const teched = base((st) => {
      withRadar(st);
      st.players.p1 = player('p1', { technologies: { completed: [RADAR_TECH] } });
    });
    expect(see(plain).has('D')).toBe(false); // мир за кромкой обычного радара
    expect(see(teched).has('D')).toBe(true); // теха раздвинула кольцо — мир опознан
  });

  it('разведка союзника сводится в общий блок зрения', () => {
    const alone = base((st) => {
      st.planets.E!.owner = 'p2'; // далёкий мир союзника — сам по себе p1 его не видит
    });
    expect(see(alone).has('E')).toBe(false);
    const allied = base((st) => {
      st.planets.E!.owner = 'p2';
      setStance(st, 'p1', 'p2', 'alliance');
    });
    expect(see(allied).has('E')).toBe(true);
  });

  it('активный «скан» героя подсвечивает зону вокруг цели', () => {
    const scanning = base((st) => {
      st.heroes = {
        h1: {
          id: 'h1',
          owner: 'p1',
          alive: true,
          location: 'A',
          activeReveals: [{ center: 'E', radius: 30, until: st.time + 1000 }],
        },
      } as unknown as GameState['heroes'];
    });
    expect(see(base()).has('E')).toBe(false);
    expect(see(scanning).has('E')).toBe(true);
  });
});

describe('RULES-5 — карта спрашивает ядро, а не выводит правило заново', () => {
  it('computeVision зовёт sensorCoverage и не пересчитывает кольца сам', () => {
    // Проверки выше держат САМО правило; эта — то, что клиент к нему подключён.
    // Без неё сторож остался бы тавтологией: ядро можно чинить сколько угодно, а карта
    // продолжала бы рисовать по своей копии — именно так расхождение и прожило до сих пор.
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('function computeVision('));
    const fn = body.slice(0, body.indexOf('\n}\n') + 3);
    expect(fn).toContain('sensorCoverage(s, ME, data)');
    for (const reDerived of ['planetRadar(', 'fleetRadar(', 'withinRadius', 'floodHops(']) {
      expect(fn).not.toContain(reDerived);
    }
  });
});

describe('RULES-5 — блэкаут пережил переезд', () => {
  it('неоплаченная энергия сужает опознание', () => {
    const paid = base(withRadar);
    const unpaid = base((st) => {
      withRadar(st);
      st.players.p1 = player('p1', { arrears: ['energy'] } as Partial<Player>);
    });
    expect(see(unpaid).size).toBeLessThan(see(paid).size);
  });
});
