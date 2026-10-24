import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { RAID, RAID_DELAY_MS } from '../../decisions/trainingScenario';
import { trainingModeId, trainingState } from '../../packages/client/src/gameData';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { advance, order, setMatchMode } from './game';
import { data } from './gameData';
import {
  forceIntroduced,
  resetTrainingScenario,
  tickTrainingScenario,
  type ScenarioTour,
  type TrainingScenarioHost,
} from './trainingScenario';

// TRN-3 · проводка сценария полигона: что он делает с миром в кадре игры. Мир — настоящий
// мир карты `training-1` через ядро хоста; тур, лента и табло — подделки.

beforeAll(() => setLocale('ru'));
afterEach(() => setMatchMode(undefined));

function rig() {
  setMatchMode(trainingModeId());
  let s: GameState = advance(trainingState(data), 1).state;
  const tour: { active: boolean; stage: string | undefined; holdsClock: boolean } = {
    active: true,
    stage: 'prep',
    holdsClock: false,
  };
  const notes: string[] = [];
  const orders: Action[] = [];
  const board = { hidden: true, textContent: '' } as unknown as HTMLElement;
  const host: TrainingScenarioHost = {
    world: () => s,
    setWorld: (next) => {
      s = next;
    },
    order: (state, action) => {
      orders.push(action);
      return order(state, action, state.time).state;
    },
    me: () => 'p1',
    tour: () => tour as ScenarioTour,
    note: (text) => notes.push(text),
    board: () => board,
  };
  resetTrainingScenario(s.time);
  const tick = (gameMs = 0): void => {
    if (gameMs > 0) s = advance(s, s.time + gameMs).state;
    tickTrainingScenario(host);
  };
  return { world: () => s, setWorld: host.setWorld, tour, notes, orders, board, tick };
}

describe('TRN-3 · сценарий полигона в кадре игры', () => {
  it('силы входят с этапами: на «Бою» патруль, на «Отходе» охрана цели', () => {
    const r = rig();
    r.tick();
    expect(r.world().fleets.p2_patrol).toBeUndefined();
    expect(forceIntroduced('p2_patrol')).toBe(false);
    r.tour.stage = 'battle';
    r.tick();
    expect(r.world().fleets.p2_patrol?.owner).toBe('p2');
    expect(forceIntroduced('p2_patrol')).toBe(true);
    expect(r.world().fleets.p2_guard).toBeUndefined();
    r.tour.stage = 'retreat';
    r.tick();
    expect(r.world().fleets.p2_guard?.location).toBe('target');
  });

  it('контратака: объявлена, отсчитывает игровое время, выходит на пост', () => {
    const r = rig();
    r.tour.stage = 'fortify';
    r.tour.holdsClock = true; // игрок ищет кнопку — тур держит часы
    r.tick();
    expect(r.notes.at(-1)).toContain('контратаку');
    expect(r.board.hidden).toBe(false);
    expect(r.board.textContent).toContain('Отсчёт ждёт');
    r.tour.holdsClock = false;
    r.tick(RAID_DELAY_MS / 2);
    expect(r.board.textContent).toMatch(/^Контратака не позже чем через \d+:\d\d$/);
    r.tick(RAID_DELAY_MS / 2);
    expect(r.world().fleets[RAID.id]).toMatchObject({ owner: 'p2' });
    expect(r.orders.at(-1)).toMatchObject({ type: 'fleet.move', playerId: 'p2', payload: { fleetId: RAID.id, to: 'outpost' } });
    expect(r.world().fleets[RAID.id]?.movement).not.toBeNull();
    expect(r.board.hidden).toBe(true);
  });

  it('контратака выходит, как только на посту игрока встала ПКО, не дожидаясь отсчёта', () => {
    const r = rig();
    r.tour.stage = 'fortify';
    r.tick();
    r.tick(RAID_DELAY_MS / 10);
    expect(r.world().fleets[RAID.id]).toBeUndefined(); // пост ещё не укреплён — идёт отсчёт
    const built = structuredClone(r.world());
    built.planets.outpost!.owner = 'p1';
    built.planets.outpost!.buildings.push({ type: 'orbital_aa', level: 1, hp: 100 });
    r.setWorld(built);
    r.tick();
    expect(r.orders.at(-1)).toMatchObject({ type: 'fleet.move', playerId: 'p2', payload: { fleetId: RAID.id, to: 'outpost' } });
    expect(r.notes.at(-1)).toBe('Контратака началась: 3 фрегата идут на пост.');
    expect(r.board.hidden).toBe(true);
  });

  it('исход: контратака разбита и цель у игрока — победа; до этого взятые миры ничего не кончают', () => {
    const r = rig();
    r.tour.stage = 'fortify';
    r.tick();
    r.tick(RAID_DELAY_MS);
    const s = structuredClone(r.world());
    for (const id of ['outpost', 'target']) s.planets[id]!.owner = 'p1';
    r.setWorld(s);
    r.tick();
    expect(r.world().match.status).not.toBe('ended'); // контратака ещё жива
    const beaten = structuredClone(r.world());
    delete beaten.fleets[RAID.id];
    r.setWorld(beaten);
    r.tick();
    expect(r.notes).toContain('Контратака отбита.');
    expect(r.world().match).toMatchObject({ status: 'ended', winner: 'p1', reason: 'training-held' });
  });

  it('тур кончился (пропущен) — сценарий доигрывается: все силы и контратака', () => {
    const r = rig();
    r.tour.stage = 'prep';
    r.tick();
    r.tour.active = false;
    r.tour.stage = undefined;
    r.tick();
    expect(forceIntroduced('p2_patrol')).toBe(true);
    expect(forceIntroduced('p2_guard')).toBe(true);
    expect(r.board.hidden).toBe(false); // объявлена: тура нет — часы никто не держит
    expect(r.board.textContent).not.toContain('Отсчёт ждёт');
  });
});
