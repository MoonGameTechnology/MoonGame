import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode, setMatchTravelSpeed } from './game';
import { data } from './gameData';
import { COMIC_TASK_TRIGGERS } from './comicArt';
import { extractionNeedMs, getStance, type GameState } from '../../packages/shared-core/src/index';
import { pveModeId, pveState } from '../../packages/client/src/gameData';
import { chapterChain, extractionCandidates, type ChapterStep } from '../../decisions/chapterChain';
import { comicTaskDue, type ComicRegistry } from '../../decisions/chapterComics';
import { extractionStart, moveFleet } from '../../decisions/actions';
import { runAiSeats } from '../../decisions/runAiSeats';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';

/**
 * ГЛАВА IV ЧЕРЕЗ ДВЕРЬ (PVR-7.6) — сквозной путь игрока по главной цепочке: связь → союз →
 * архив → извлечение → доставка → победа. Мир открывает список глав клиента (`pveState`),
 * режим — тот, что ставит забег, и на каждом шаге решение панели задач (`chapterChain`)
 * должно видеть ровно то, что сделало ядро: иначе игрок читает одну главу, а играет другую.
 *
 * Бои здесь не играются: архив «очищен» правкой состояния, а носитель ставится у входа —
 * прямой путь домой идёт через внутреннюю дугу Роя, и первый же бой снимает приказ
 * движения. Пробиться ли и какой дорогой — вопрос баланса, а замеры владелец отложил.
 * Отдельные правила исхода держит `chapterFourExtraction.test.ts`, союзника —
 * `chapterFourAlly*.test.ts`.
 */

const HOUR = 3_600_000;
const CHAPTER = 3;

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

const needMs = (s: GameState): number =>
  extractionNeedMs(s, {
    now: s.time,
    data,
    config: { timeScale: 1, modeId: pveModeId(CHAPTER), travelSpeedFactor: RUN_TRAVEL_SPEED },
  });
const chain = (s: GameState): ChapterStep[] => chapterChain(s, 'p1', needMs(s))!;
const activeStep = (s: GameState): string | undefined => chain(s).find((st) => st.active)?.id;
const doneKeys = (s: GameState): string[] =>
  chain(s)
    .filter((st) => st.done)
    .map((st) => st.key);

function flyTo(s: GameState, fleetId: string, to: string, maxHours = 24): GameState {
  const sent = order(s, moveFleet('p1', fleetId, to), s.time);
  expect(sent.error).toBeUndefined();
  let cur = sent.state;
  for (let q = 1; q <= maxHours * 4; q++) {
    cur = advance(cur, s.time + (q * HOUR) / 4).state;
    const f = cur.fleets[fleetId];
    if (cur.match.status === 'ended' || (f && f.location === to && !f.movement)) return cur;
  }
  throw new Error(`${fleetId} не долетел до ${to}`);
}

describe('глава IV через дверь: главная цепочка шаг за шагом', () => {
  it('дверь ведёт в сценарий: цепочка из четырёх шагов, союзник — житель, а не место', () => {
    const s = start();
    expect(chain(s).map((st) => st.id)).toEqual(['contact', 'archive', 'extract', 'deliver']);
    expect(activeStep(s)).toBe('contact');
    expect(s.players.ally).toMatchObject({ npc: 'neutral', ai: true });
    // Бот ведёт и Рой, и союзника; игрок — только себя.
    expect([...runAiSeats(s, 'p1', 'weak').keys()].sort()).toEqual(['ally', 'swarm']);
  });

  it('связь → союз → архив → извлечение → доставка → победа; панель и комикс идут следом', () => {
    const fakeComic: ComicRegistry = { 'pve-4': { task: [{ image: 'встреча.webp' }] } };
    const comicDue = (s: GameState) =>
      comicTaskDue({ comicsSeen: [] }, fakeComic, COMIC_TASK_TRIGGERS, 'pve-4', doneKeys(s));

    let s = start();
    expect(comicDue(s)).toBeNull();

    // 1. Связь: флот игрока долетает до точки встречи.
    s = flyTo(s, 'p1_1', 'rendezvous');
    expect(getStance(s, 'p1', 'ally')).toBe('alliance');
    expect(activeStep(s)).toBe('archive');
    // Комикс встречи офицеров (§6.8) положен ровно с этого шага.
    expect(comicDue(s)).not.toBeNull();

    // 2. Архив очищен — штурм не играется (см. шапку).
    s = {
      ...s,
      planets: { ...s.planets, archive: { ...s.planets.archive!, owner: 'p1', garrison: [] } },
      fleets: { ...s.fleets, p1_1: { ...s.fleets.p1_1!, location: 'archive', movement: null } },
    };
    expect(activeStep(s)).toBe('extract');
    expect(extractionCandidates(s, 'p1')).toEqual(['p1_1']);

    // 3. Извлечение: доля работы растёт в панели, готовый накопитель едет на флоте.
    const sent = order(s, extractionStart('p1', 'p1_1'), s.time);
    expect(sent.error).toBeUndefined();
    const half = advance(sent.state, sent.state.time + needMs(s) / 2).state;
    expect(chain(half).find((st) => st.id === 'extract')!.progress).toBeCloseTo(0.5, 1);
    s = advance(half, sent.state.time + needMs(s) + HOUR).state;
    expect(s.extraction?.carrier).toBe('p1_1');
    expect(activeStep(s)).toBe('deliver');
    // Шаг «вывод» ведёт камеру к носителю, а кнопка извлечения гаснет.
    expect(chain(s).find((st) => st.id === 'deliver')!.target).toBe('archive');
    expect(extractionCandidates(s, 'p1')).toEqual([]);

    // 4. Доставка: носитель у входа (см. шапку) — «вывод» ведёт камеру за ним, а последний
    // переход в зону вывода заканчивает главу победой.
    s = { ...s, fleets: { ...s.fleets, p1_1: { ...s.fleets.p1_1!, location: 'approach' } } };
    expect(chain(s).find((st) => st.id === 'deliver')!.target).toBe('approach');
    s = flyTo(s, 'p1_1', 'staging');
    expect({ status: s.match.status, reason: s.match.reason, winner: s.match.winner }).toEqual({
      status: 'ended',
      reason: 'pve-extracted',
      winner: 'p1',
    });
    expect(chain(s).every((st) => st.done && !st.active)).toBe(true);
  });
});
