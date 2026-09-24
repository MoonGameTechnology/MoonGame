/**
 * Органы Роя на настоящей карте (решение владельца 2026-09-24: «у людей почему-то есть
 * ресурс биомасса» → «при захвате не-роем наземные юниты сражаются с постройками»).
 * Правило держит ядро (`modules/infestation.test.ts`); здесь — что на карте главы II мир
 * Роя, доставшийся человеку, биомассы ему не даёт, а гарнизон вычищает его органы.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { advance, data, setMatchMode } from './game';
import { incomeBreakdown } from './economy';
import { pveState } from '../../packages/client/src/gameData';
import type { GameState } from '../../packages/shared-core/src/index';

const HOUR = 3_600_000;
const infected = (st: GameState, id: string) =>
  st.planets[id]!.buildings.filter((b) => data.buildings[b.type]?.traits.includes('infected'));

/** Гнездо главы II (улей 25 + яма 15 + центр данных 30 + синапс 20 — узел сети Роя) — у
 *  игрока, в гарнизоне 4 ополченца (урон 4 в час). */
function takenNest(): GameState {
  setMatchMode(undefined); // без волн: проверяется зачистка, а не штурм Роя
  const st = pveState(data, 1);
  st.planets.nest!.owner = 'p1';
  st.planets.nest!.garrison = [{ unit: 'militia', count: 4 }];
  return st;
}

describe('мир Роя у человека: органы не работают и вычищаются гарнизоном', () => {
  it('на старте в гнезде четыре органа — улей, яма, центр данных и синапс', () => {
    expect(
      infected(takenNest(), 'nest')
        .map((b) => b.type)
        .sort(),
    ).toEqual(['biomass_pit', 'swarm_datacenter', 'swarm_hive', 'swarm_synapse']);
  });

  it('биомассы игрок не получает ни в казне, ни в строке дохода', () => {
    const st = takenNest();
    const before = st.players.p1!.resources.biomass ?? 0;
    const after = advance(st, st.time + 5 * HOUR).state;
    expect(after.players.p1!.resources.biomass ?? 0).toBe(before);
    expect(incomeBreakdown(after, 'p1').biomass?.production ?? 0).toBe(0);
  });

  it('за 22,5 часа 4 ополченца (4 в час) вычищают 90 прочности — все органы снесены', () => {
    const st = takenNest();
    const half = advance(st, st.time + 5 * HOUR).state;
    expect(infected(half, 'nest').reduce((sum, b) => sum + b.hp, 0)).toBeCloseTo(70);
    const done = advance(half, half.time + 17.5 * HOUR + 1).state;
    expect(infected(done, 'nest')).toEqual([]);
  });
});

/** Аргументы вызова `name(` начиная с позиции `at` — до парной скобки. */
function callArgs(src: string, at: number, name: string): string {
  let depth = 0;
  for (let i = at + name.length; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(at + name.length + 1, i);
  }
  throw new Error(`незакрытый вызов ${name}`);
}

describe('проводка: ворота стройки клиента спрашивают, КТО строит', () => {
  // Параметр `eatsBiomass` обязателен, поэтому забытый вызов ловит typecheck. Литерал
  // `false` на его месте typecheck пропустит, а для Роя он спрячет его же органы.
  it('каждый вызов canBuildHere / buildsAnything в main.ts передаёт feedsOnBiomass(s, ME, data)', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    const calls = [...src.matchAll(/\b(canBuildHere|buildsAnything)\(/g)].map((m) =>
      callArgs(src, m.index!, m[1]!),
    );
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const args of calls) expect(args.trimEnd()).toMatch(/,\s*feedsOnBiomass\(s, ME, data\)$/);
  });

  it('снос-зачистка (`cleared`) идёт в журнал своей строкой, а не «разрушено»', () => {
    const src = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(src).toContain("tellBuild(p.cleared === true ? 'cleared' : 'destroyed', p)");
  });
});
