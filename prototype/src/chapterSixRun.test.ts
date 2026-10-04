import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode, setMatchTravelSpeed } from './game';
import { data } from './gameData';
import { CHAPTER_COMICS, COMIC_TRIGGERS } from './comicArt';
import { getStance, type GameState } from '../../packages/shared-core/src/index';
import { pveModeId, pveState } from '../../packages/client/src/gameData';
import { chapterChain, type ChapterStep } from '../../decisions/chapterChain';
import { comicId, comicsTriggered } from '../../decisions/chapterComics';
import { moveFleet } from '../../decisions/actions';
import { runAiSeats } from '../../decisions/runAiSeats';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';

/**
 * ГЛАВА VI ЧЕРЕЗ ДВЕРЬ (PVR-8.7) — сквозной путь игрока по главной цепочке: союз → доки →
 * эвакуация → очаги и главные силы → победа. Мир открывает список глав клиента (`pveState`),
 * режим — тот, что ставит забег, и на каждом шаге панель задач (`chapterChain`) и сцены комикса
 * должны видеть ровно то, что сделало ядро: иначе игрок читает одну главу, а играет другую.
 *
 * Бои здесь не играются: флот ставится у доков, транспорты — у базы, очаги «взяты» и
 * соединения «разбиты» правкой состояния, как в `chapterSixOperation.test.ts`. Какой дорогой и
 * каким составом пробиться — вопрос баланса (§8.11: числа — эскиз до плейтеста).
 */

const HOUR = 3_600_000;
const CHAPTER = 5;
const DOCKS = 'quarantine_docks';
const SITES = ['complex', 'north_foundry', 'west_foundry'];
const FORCES = ['swarm_guard', 'swarm_host', 'swarm_reserve'];

afterEach(() => {
  setMatchMode(undefined);
  setMatchTravelSpeed(1);
});

function start(): GameState {
  setMatchMode(pveModeId(CHAPTER));
  setMatchTravelSpeed(RUN_TRAVEL_SPEED);
  // Первый шаг часов заводит PvE-штурм (`state.pve`), как в настоящем забеге.
  return advance(pveState(data, CHAPTER), 1).state;
}

const chain = (s: GameState): ChapterStep[] => chapterChain(s, 'p1', 0, data)!;
const step = (s: GameState, id: string): ChapterStep => chain(s).find((st) => st.id === id)!;
const activeStep = (s: GameState): string | undefined => chain(s).find((st) => st.active)?.id;
/** Сцены комикса к показу — тем же путём, что `playTaskComic`, с подключённым артом. */
const scenes = (s: GameState, seen: string[]): string[] =>
  comicsTriggered(
    { comicsSeen: seen },
    CHAPTER_COMICS,
    COMIC_TRIGGERS,
    'pve-6',
    chain(s)
      .filter((st) => st.done)
      .map((st) => st.key),
  );

/** Поставить флот игрока в провинцию — бой по дороге здесь не играется (см. шапку). */
function placed(s: GameState, fleetId: string, at: string): GameState {
  return {
    ...s,
    fleets: { ...s.fleets, [fleetId]: { ...s.fleets[fleetId]!, location: at, movement: null } },
  };
}

/** Довести флот игрока до узла шагами по четверти часа. Флот, слившийся на месте с другим
 *  своим флотом (автослияние), тоже долетел. */
function flyTo(s: GameState, fleetId: string, to: string, maxHours = 24): GameState {
  const sent = order(s, moveFleet('p1', fleetId, to), s.time);
  expect(sent.error).toBeUndefined();
  let cur = sent.state;
  for (let q = 1; q <= maxHours * 4; q++) {
    cur = advance(cur, s.time + (q * HOUR) / 4).state;
    const f = cur.fleets[fleetId];
    if (cur.match.status === 'ended' || !f || (f.location === to && !f.movement)) return cur;
  }
  throw new Error(`${fleetId} не долетел до ${to}`);
}

describe('глава VI через дверь: главная цепочка шаг за шагом', () => {
  it('дверь ведёт в сценарий: союз с первой минуты, цепочка из четырёх шагов', () => {
    const s = start();
    expect(s.mapId).toBe('pve-6');
    expect(chain(s).map((st) => st.id)).toEqual(['docks', 'evacuate', 'production', 'forces']);
    expect(activeStep(s)).toBe('docks');
    // Повторного знакомства нет (§8.3): союз и общий обзор — с нулевой минуты.
    expect(getStance(s, 'p1', 'ally')).toBe('alliance');
    expect(s.players.ally).toMatchObject({ npc: 'neutral', ai: true });
    // Бот ведёт и Рой, и союзника; игрок — только себя.
    expect([...runAiSeats(s, 'p1', 'weak').keys()].sort()).toEqual(['ally', 'swarm']);
  });

  it('доки → эвакуация → очаги и главные силы → победа; панель и сцены идут следом', () => {
    let s = start();
    const seen: string[] = [];
    expect(scenes(s, seen)).toEqual([]);

    // 1. Доки: флот игрока долетает до доков — сведения о них, транспорты выходят к игроку,
    // и в этот кадр встаёт «Последний приют». Пришедший флот сливается с транспортами
    // (автослияние): дальше конвой идёт одним флотом с охраной.
    s = flyTo(placed(s, 'p1_2', 'cold_moorings'), 'p1_2', DOCKS);
    expect(s.missionFacts?.found?.p1).toContain(DOCKS);
    expect(s.fleets.p1_2).toBeUndefined();
    expect(s.fleets.p1_evac).toMatchObject({ owner: 'p1', location: DOCKS });
    expect(s.fleets.p1_evac!.units).toEqual(
      expect.arrayContaining([
        { unit: 'evac_transport', count: 4 },
        { unit: 'cruiser', count: 2 },
      ]),
    );
    expect(activeStep(s)).toBe('evacuate');
    expect(scenes(s, seen)).toEqual(['refuge']);
    seen.push(comicId('pve-6', 'refuge'));

    // 2. Эвакуация: шаг ведёт к базе, последний переход доводит людей — «Мы пришли за людьми».
    expect(step(s, 'evacuate').target).toBe('forward_base');
    const gate = [...(s.planets.forward_base!.links ?? [])].sort()[0]!;
    s = flyTo(placed(s, 'p1_evac', gate), 'p1_evac', 'forward_base');
    expect(s.missionFacts?.evacuated?.p1).toBe(4);
    expect(step(s, 'evacuate').done).toBe(true);
    expect(activeStep(s)).toBe('production');
    expect(scenes(s, seen)).toEqual(['rescued']);
    seen.push(comicId('pve-6', 'rescued'));
    // Доставка — не победа: два других результата ещё впереди.
    expect(s.match.status).toBe('ongoing');

    // 3. Очаги взяты (см. шапку): производство подавлено, глава идёт дальше.
    const planets = { ...s.planets };
    for (const id of SITES) planets[id] = { ...planets[id]!, owner: 'p1', garrison: [] };
    s = advance({ ...s, planets }, s.time + HOUR).state;
    expect(step(s, 'production').done).toBe(true);
    expect(activeStep(s)).toBe('forces');
    expect(s.match.status).toBe('ongoing');

    // 4. Главные соединения разбиты — контракт выполнен: победа, вся цепочка закрыта.
    const fleets = { ...s.fleets };
    for (const id of FORCES) delete fleets[id];
    s = advance({ ...s, fleets }, s.time + HOUR).state;
    expect(s.match).toMatchObject({ status: 'ended', reason: 'pve-operation', winner: 'p1' });
    expect(chain(s).every((st) => st.done && !st.active)).toBe(true);
    expect(scenes(s, seen)).toEqual([]);
  });
});
