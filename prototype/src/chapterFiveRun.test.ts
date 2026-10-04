import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode, setMatchTravelSpeed, setMatchVeteranPower } from './game';
import { data } from './gameData';
import { initSoloDrivers } from './soloDrivers';
import { pveChapter, pveModeId, pveState } from '../../packages/client/src/gameData';
import {
  getStance,
  swarmNet,
  type Action,
  type DomainEvent,
  type GameState,
} from '../../packages/shared-core/src/index';
import { chapterChain } from '../../decisions/chapterChain';
import { comicsTriggered, storyFacts } from '../../decisions/chapterComics';
import { CHAPTER_COMICS, COMIC_TRIGGERS } from './comicArt';
import { captiveCandidates } from '../../decisions/captive';
import { allyPanelView } from '../../decisions/allyPanel';
import { objectiveProgress, type MissionObjective } from '../../decisions/missionObjectives';
import {
  allyOrder,
  assaultFleet,
  captiveLoad,
  loadArmy,
  mergeFleet,
  moveFleet,
} from '../../decisions/actions';
import { runAiSeats } from '../../decisions/runAiSeats';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';

/**
 * ГЛАВА V ЧЕРЕЗ ДВЕРЬ — «Разорванная сеть» (`docs/sector-zero-map-concepts.md` §7) сквозным
 * прогоном через настоящие драйверы хоста: Рой и прикомандированный союзник ходят своими
 * ботами, игрок — короткими сценариями приказов. Геометрию карты и сети держит
 * `data/pveFifthMission.test.ts`, правила — тесты модулей; здесь — то, что видно только в
 * живом забеге: Рой не разбирает свою сеть сам, удар по ретранслятору действительно
 * отрезает очаг, Рой чинит сеть за свои средства, пленного можно взять и довезти, а три
 * очага, потерянные Роем, заканчивают главу контрактом операции, как в главе VI (PVR-9.3).
 *
 * Рука теста одна и названа там, где есть: в сценарии пленного игрок «уже нанял» одного
 * тяжёлого пехотинца — казармы и найм здесь не играются. Победа по очагам проверяется
 * передачей миров: штурм трёх укреплённых миров — вопрос баланса, а не сценария.
 */

const HOUR = 3_600_000;
const CHAPTER = 4;
const objective = (id: string): MissionObjective =>
  pveChapter(CHAPTER).objectives.find((o) => o.id === id)! as MissionObjective;

/** Сцены комикса, которые хозяин поставил бы в очередь: засчитанные задачи и факты мира. */
function scenes(s: GameState): string[] {
  const done = pveChapter(CHAPTER)
    .objectives.filter((o) => objectiveProgress(o as MissionObjective, s, 'p1').complete)
    .map((o) => o.id);
  const complete = [...done, ...storyFacts(s)];
  return comicsTriggered({ comicsSeen: [] }, CHAPTER_COMICS, COMIC_TRIGGERS, 'pve-5', complete);
}

afterEach(() => {
  setMatchMode(undefined);
  setMatchTravelSpeed(1);
  setMatchVeteranPower(false);
});

interface Run {
  state: GameState;
  events: DomainEvent[];
}

/**
 * Забег главы V: правила хоста, первый шаг часов (заводит волны и сеть), потом каждые
 * четверть часа — `script` игрока, каждый час — боты. `script` возвращает `true`, когда
 * сценарий окончен.
 */
function play(
  hours: number,
  script: (s: GameState, apply: (a: Action) => void) => boolean | void,
  prepare: (s: GameState) => GameState = (s) => s,
): Run {
  setMatchMode(pveModeId(CHAPTER));
  setMatchTravelSpeed(RUN_TRAVEL_SPEED);
  setMatchVeteranPower(true);
  const events: DomainEvent[] = [];
  let s = advance(prepare(pveState(data, CHAPTER)), 1).state;
  const apply = (a: Action): void => {
    const out = order(s, a, s.time);
    if (out.error) return;
    s = out.state;
    events.push(...out.events);
  };
  const drivers = initSoloDrivers({
    state: () => s,
    me: () => 'p1',
    aiSeats: () => runAiSeats(s, 'p1', 'weak'),
    applyLocal: apply,
    playerOrder: apply,
    autoAssault: () => false,
    patrols: () => new Map(),
    known: () => true,
  });
  for (let q = 1; q <= hours * 4; q++) {
    const step = advance(s, 1 + (q * HOUR) / 4);
    s = step.state;
    events.push(...step.events);
    if (s.match.status === 'ended' || script(s, apply) === true) break;
    if (q % 4 === 0) {
      drivers.runAI();
      drivers.autoEngage();
      drivers.checkFleetClashes();
    }
  }
  return { state: s, events };
}

const relaysAt = (s: GameState): Record<string, string | null> =>
  Object.fromEntries(
    Object.values(s.fleets)
      .filter(
        (f) => f.owner === 'swarm' && f.units.some((u) => u.unit === 'swarm_relay' && u.count > 0),
      )
      .map((f) => [f.id, f.location]),
  );
const westLinked = (s: GameState): boolean => {
  const view = swarmNet(s, data, 'swarm', s.time);
  return view.partOf.get('planet:focus_west') === view.partOf.get('planet:focus_center');
};

describe('глава V через дверь: «Разорванная сеть»', () => {
  it('дверь ведёт в сценарий: союзник на связи с первой минуты, цепочка «звено → очаги»', () => {
    const { state: s } = play(0, () => true);
    // Цепочка операции главы VI без шагов, которых нет в контракте: доков, эвакуации и
    // главных сил у главы V нет.
    expect(chapterChain(s, 'p1', 0, data)!.map((st) => [st.id, st.active])).toEqual([
      ['link', true],
      ['production', false],
    ]);
    // Синий союзник, общий обзор и «Связь с союзником» — без встречи (§7.2).
    expect(getStance(s, 'p1', 'ally')).toBe('alliance');
    expect(allyPanelView(s, 'p1', data)).toMatchObject({ ally: 'ally', alive: true });
    // Ботами ходят Рой и союзник; Завет — житель без своего бота.
    expect([...runAiSeats(s, 'p1', 'weak').keys()].sort()).toEqual(['ally', 'swarm']);
    expect(s.captive).toEqual({ hideout: 'hideout', zone: 'staging' });
  });

  it('Рой не разбирает свою сеть сам: сутки без игрока — ни один очаг не отрезан', () => {
    const { state: s } = play(36, () => {});
    // Ретрансляторы раскладки стоят на местах; разрыв — только дело рук противника.
    expect(relaysAt(s)).toMatchObject({
      relay_west: 'w_link',
      relay_gate: 'c_gate',
      relay_north: 'c_north',
    });
    expect(s.swarmNet?.cut ?? []).not.toContain('focus_west');
    expect(s.swarmNet?.cut ?? []).not.toContain('focus_east');
    expect(storyFacts(s)).not.toContain('net.cut');
    expect(scenes(s)).not.toContain('network');
    expect(objectiveProgress(objective('mission.break-net'), s, 'p1').complete).toBe(false);
  });

  it('удар по Жиле отрезает западный очаг; Рой чинит сеть за свои средства, разрыв засчитан', () => {
    let cutAt: number | undefined;
    let cutState: GameState | undefined;
    const { state: s, events } = play(36, (cur, apply) => {
      if (cur.time < 2 * HOUR && cur.fleets.p1_2) {
        apply(mergeFleet('p1', 'p1_2', 'p1_1'));
        apply(moveFleet('p1', 'p1_1', 'w_link'));
      }
      if (cutAt === undefined && (cur.swarmNet?.cut ?? []).includes('focus_west')) {
        cutAt = cur.time;
        cutState = cur;
        apply(moveFleet('p1', 'p1_1', 'staging'));
      }
    });
    expect(cutAt, 'ретранслятор Жилы не пал').toBeDefined();
    // Звено найдено в бою, разрыв засчитан задаче и сцене.
    expect(chapterChain(cutState!, 'p1', 0, data)![0]).toMatchObject({ id: 'link', done: true });
    expect(objectiveProgress(objective('mission.break-net'), cutState!, 'p1').complete).toBe(true);
    expect(scenes(cutState!)).toContain('network');
    expect(westLinked(cutState!)).toBe(false);
    // Починка: к концу прогона запад снова на связи, а факт разрыва остался.
    expect(westLinked(s)).toBe(true);
    expect(objectiveProgress(objective('mission.break-net'), s, 'p1').complete).toBe(true);
    // Бесплатного узла нет: каждый ретранслятор Роя сверх раскладки построен на верфи.
    const built = events.filter(
      (e) =>
        e.type === 'unit.built' &&
        (e.payload as { owner?: string; unit?: string }).owner === 'swarm' &&
        (e.payload as { unit?: string }).unit === 'swarm_relay',
    ).length;
    const extra = Object.keys(relaysAt(s)).filter(
      (id) => !['relay_west', 'relay_gate', 'relay_north'].includes(id),
    ).length;
    expect(extra).toBeLessThanOrEqual(built);
  });

  it('пленный: штурм достаточным десантом, погрузка, доставка — задача и сцена', () => {
    let phase: 'load' | 'fly' | 'assault' | 'carry' | 'done' = 'load';
    let offered: string[] = [];
    const { state: s } = play(
      30,
      (cur, apply) => {
        const f = cur.fleets.p1_1;
        if (phase === 'load') {
          apply(mergeFleet('p1', 'p1_2', 'p1_1'));
          apply(loadArmy('p1', 'p1_1', 'heavy_infantry', 5));
          apply(loadArmy('p1', 'p1_1', 'militia', 2));
          phase = 'fly';
        } else if (phase === 'fly' && f && !f.loading?.length) {
          apply(moveFleet('p1', 'p1_1', 'hideout'));
          phase = 'assault';
        } else if (phase === 'assault' && f?.location === 'hideout' && !f.movement) {
          if (cur.captive?.takenBy === 'p1') {
            offered = captiveCandidates(cur, 'p1');
            apply(captiveLoad('p1', 'p1_1'));
            apply(moveFleet('p1', 'p1_1', 'staging'));
            phase = 'carry';
          } else if ((f.landing ?? []).length > 0) apply(assaultFleet('p1', 'p1_1'));
        } else if (phase === 'carry' && cur.captive?.deliveredAt !== undefined) phase = 'done';
        return phase === 'done';
      },
      // Рука теста: один нанятый тяжёлый пехотинец (казармы и найм не играются).
      (s0) => {
        s0.planets.staging!.garrison = s0.planets.staging!.garrison.map((g) =>
          g.unit === 'heavy_infantry' ? { ...g, count: g.count + 1 } : g,
        );
        return s0;
      },
    );
    expect(phase).toBe('done');
    // Кнопка «Принять на борт» предлагала флот у убежища.
    expect(offered).toEqual(['p1_1']);
    expect(s.captive).toMatchObject({ takenBy: 'p1', carrier: 'p1_1' });
    expect(objectiveProgress(objective('mission.voice-of-unity'), s, 'p1')).toMatchObject({
      done: 3,
      complete: true,
      failed: false,
    });
    expect(scenes(s)).toContain('captive');
  });

  it('пленный через союзника: приказ «Атаковать» убежище — союзник берёт его и сам довозит', () => {
    let ordered = false;
    const { state: s } = play(40, (cur, apply) => {
      if (!ordered) {
        apply(allyOrder('p1', 'ally', 'attack', { planet: 'hideout' }));
        ordered = true;
      }
      return cur.captive?.deliveredAt !== undefined || cur.captive?.lostAt !== undefined;
    });
    // Корабли союзника ждали исхода боя на земле и приняли пленного сразу (PVR-9.5).
    expect(s.captive).toMatchObject({ takenBy: 'ally', carrier: expect.any(String) });
    expect(s.captive?.lostAt).toBeUndefined();
    expect(s.captive?.deliveredAt).toBeDefined();
    // Успех союзника засчитан игроку: задача и сцена.
    expect(objectiveProgress(objective('mission.voice-of-unity'), s, 'p1')).toMatchObject({
      done: 3,
      complete: true,
    });
    expect(scenes(s)).toContain('captive');
  });

  it('Рой потерял три очага — глава выиграна контрактом операции, а не волнами', () => {
    const { state: s } = play(
      2,
      () => {},
      (s0) => {
        // Передача миров вместо трёх штурмов (см. шапку): западный и центральный —
        // игроку, восточный — союзнику. Союзный контроль равноправен своему (§7.5).
        for (const [id, owner] of [
          ['focus_west', 'p1'],
          ['focus_center', 'p1'],
          ['focus_east', 'ally'],
        ] as const) {
          s0.planets[id] = { ...s0.planets[id]!, owner, garrison: [] };
        }
        return s0;
      },
    );
    expect({ status: s.match.status, reason: s.match.reason, winner: s.match.winner }).toEqual({
      status: 'ended',
      reason: 'pve-operation',
      winner: 'p1',
    });
  });
});
