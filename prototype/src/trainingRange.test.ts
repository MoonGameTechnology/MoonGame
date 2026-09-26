import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode } from './game';
import { data } from './gameData';
import { trainingModeId, trainingObjectives, trainingState } from '../../packages/client/src/gameData';
import { missionRows } from '../../decisions/missionView';
import { freshSectorZeroProgress, prepareSectorZeroRun } from '../../decisions/sectorZeroProgress';
import { readFileSync } from 'node:fs';
import { pairKey, type GameState } from '../../packages/shared-core/src/index';

/**
 * Исход УЧЕБНОГО ПОЛИГОНА (`docs/sector-zero-map-concepts.md` §14.9) через настоящее ядро
 * хоста: операция кончается взятием миров учебного противника, а не гонкой очков или
 * долей карты, и дополнительные задачи победу не определяют.
 */

const HOUR = 3_600_000;

function start(): GameState {
  setMatchMode(trainingModeId());
  return advance(trainingState(data), 1).state;
}
/** Мир с провинциями `ids`, отданными игроку, — как после их захвата. */
function take(s: GameState, ids: readonly string[]): GameState {
  const next = structuredClone(s);
  for (const id of ids) {
    next.planets[id]!.owner = 'p1';
    next.planets[id]!.garrison = [];
  }
  return next;
}

describe('учебный полигон: исход', () => {
  afterEach(() => setMatchMode(undefined));

  it('пассивный мир не кончается сам: противник не ходит, волн нет', () => {
    const s = advance(start(), 48 * HOUR).state;
    expect(s.match.status).not.toBe('ended');
  });

  it('всё, кроме миров противника, — ещё не победа (ни доля карты, ни очки)', () => {
    const s = advance(take(start(), ['neutral', 'asteroid_pass', 'station']), 2 * HOUR).state;
    expect(s.match.status).not.toBe('ended');
  });

  it('взяты пост и планета-цель — победа игрока, даже без маяка и разведки', () => {
    const s = advance(take(start(), ['outpost', 'target']), 2 * HOUR).state;
    expect({ status: s.match.status, winner: s.match.winner }).toEqual({ status: 'ended', winner: 'p1' });
    const rows = missionRows(trainingObjectives(), s, 'p1');
    expect(rows.find((r) => r.id === 'mission.training-beacon')?.complete).toBe(false);
  });

  it('маяк засчитывается владением станцией, разведка — счётчиком опознанного', () => {
    const s = advance(take(start(), ['station']), 2 * HOUR).state;
    const rows = missionRows(trainingObjectives(), s, 'p1');
    expect(rows.find((r) => r.id === 'mission.training-beacon')?.complete).toBe(true);
    const recon = rows.find((r) => r.id === 'mission.training-recon')!;
    expect(recon.total).toBe(7);
    expect(recon.done).toBeGreaterThan(0);
    expect(recon.done).toBeLessThan(7);
  });
});

describe('учебный полигон: противник — враг с первой минуты', () => {
  afterEach(() => setMatchMode(undefined));

  // Карта полигона без команд, а свободная карта без команд стартует в МИРЕ
  // (`seedTeamDiplomacy`): без войны флот не входит в провинцию противника
  // (`E_NO_RIGHT_OF_WAY`), и полигон нечему учить. Найдено аудитом механик (AUDM).
  it('игрок и учебный противник воюют сразу', () => {
    expect(start().diplomacy?.[pairKey('p1', 'p2')]).toBe('war');
  });

  it('приказ идти на передовой пост ядро принимает', () => {
    const s = start();
    const r = order(
      s,
      { id: 't:p1:1', type: 'fleet.move', playerId: 'p1', payload: { fleetId: 'p1_1', to: 'outpost' }, issuedAt: s.time },
      s.time,
    );
    expect(r.error).toBeUndefined();
  });
});

describe('учебный полигон: герой экспедиции', () => {
  afterEach(() => setMatchMode(undefined));

  // Полигон учит тому, с чем идти в главу I: тот же герой, арсенал и оснащение кораблей,
  // что выдаёт забегу `prepareSectorZeroRun`. Без этого на полигоне не было героя вовсе —
  // и учить его способностям было нечем (найдено аудитом механик, AUDM).
  it('выбранный герой выходит флагманом из базы и может идти в бой', () => {
    setMatchMode(trainingModeId());
    const prepared = prepareSectorZeroRun(trainingState(data), freshSectorZeroProgress(data), data);
    const s = advance(prepared, 1).state;
    const hero = Object.values(s.heroes ?? {}).find((h) => h.owner === 'p1');
    expect(hero?.alive).toBe(true);
    expect(s.fleets[hero!.fleetId!]?.location).toBe('base');
    const r = order(
      s,
      { id: 't:p1:2', type: 'fleet.move', playerId: 'p1', payload: { fleetId: hero!.fleetId!, to: 'outpost' }, issuedAt: s.time },
      s.time,
    );
    expect(r.error).toBeUndefined();
  });

  it('кнопка «Обучение» готовит мир тем же правилом, что и главы', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const body = /function startTraining\(\)[^{]*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
    expect(body).toContain('prepareSectorZeroRun(trainingState(data), sectorProgress, data)');
  });
});
