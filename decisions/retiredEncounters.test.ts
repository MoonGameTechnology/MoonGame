import { describe, expect, it } from 'vitest';
import { pveChapter, pveState, shippedGameData } from '../packages/client/src/gameData';
import type { MapObjective } from '../packages/shared-core/src/index';
import { pirateEncounter } from './pirateEncounter';
import { retireDoneEncounters } from './retiredEncounters';

const data = shippedGameData();
const chapterOne = () => pveChapter(0);

function run() {
  const state = pveState(data, 0);
  state.pve = { waveNumber: 1, totalWaves: 10, npcPlayerId: 'p3' };
  return state;
}

describe('встреча, закрытая задачей, не возвращается (решение владельца 2026-09-25)', () => {
  // «Штурм логова пиратов тоже одноразовая миссия: если выполнил на этой карте, уже не
  // появится — по нашей системе заданий».
  it('логово пиратов взято в прошлом заходе — пиратов на карте нет, карточки «Первый бой» нет', () => {
    const start = run();
    expect(pirateEncounter(start, 'p1')).not.toBeNull(); // первый заход — встреча есть
    const s = retireDoneEncounters(start, chapterOne().objectives, ['mission.pirate-den']);
    expect(s.planets.pirate_den!.owner).toBeNull();
    expect(s.planets.pirate_den!.garrison).toEqual([]);
    expect(Object.values(s.fleets).some((f) => f.owner === 'pirates')).toBe(false);
    expect(s.players.pirates).toBeUndefined();
    expect(Object.keys(s.diplomacy ?? {}).some((pair) => pair.split('|').includes('pirates'))).toBe(
      false,
    );
    expect(pirateEncounter(s, 'p1')).toBeNull();
  });

  it('задача не выполнена — карта та же, байт в байт', () => {
    const start = run();
    const before = JSON.stringify(start);
    expect(JSON.stringify(retireDoneEncounters(start, chapterOne().objectives, []))).toBe(before);
    expect(
      JSON.stringify(retireDoneEncounters(start, chapterOne().objectives, ['mission.recon'])),
    ).toBe(before);
  });

  it('вход не меняется: результат — новый мир', () => {
    const start = run();
    const before = JSON.stringify(start);
    retireDoneEncounters(start, chapterOne().objectives, ['mission.pirate-den']);
    expect(JSON.stringify(start)).toBe(before);
  });

  it('цель не у NPC (свой мир, Рой, ничья) не трогается — списывается только встреча', () => {
    const start = run();
    const own: MapObjective = { id: 'x.own', kind: 'control', targets: ['home_a'], reward: 1 };
    const s = retireDoneEncounters(start, [own], ['x.own']);
    expect(s.planets.home_a!.owner).toBe(start.planets.home_a!.owner);
    expect(JSON.stringify(s)).toBe(JSON.stringify(start));
  });

  it('списывается только задача захвата: снос или разведка той же провинции не в счёт', () => {
    const start = run();
    const scout: MapObjective = {
      id: 'x.scout',
      kind: 'beacon',
      targets: ['pirate_den'],
      reward: 1,
      count: 1,
    };
    expect(retireDoneEncounters(start, [scout], ['x.scout']).planets.pirate_den!.owner).toBe(
      'pirates',
    );
  });
});
