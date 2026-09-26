/**
 * Левиафан — только у матёрого Роя (PVR-4.7, резолюция владельца 2026-09-24: «С 10-й
 * волной каждой главы», босс сильного Роя).
 *
 * Та же форма, что у сторожей темпа и силы ветерана (`runTravelSpeed.test.ts`,
 * `runVeteranPower.test.ts`), и по той же причине: правило ставит ХОСТ, а не режим.
 *
 * 1. **Ядро прототипа получает флаг из `ctx`**, и на шипнутой главе босс выходит из улья
 *    с десятой волной — а без флага не выходит.
 * 2. **Включает его только дверь забега, и только для сильного Роя.** `main.ts` в vitest
 *    не поднять, поэтому стык держит статическая проверка.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { advance, aiOrders, ctx, setMatchMode, setMatchPveBoss, setMatchTravelSpeed } from './game';
import { data } from './gameData';
import { pveModeId, pveState } from '../../packages/client/src/gameData';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import type { Action, GameState } from '../../packages/shared-core/src/index';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const HOUR = 3_600_000;

afterEach(() => {
  setMatchPveBoss(false);
  setMatchMode(undefined);
  setMatchTravelSpeed(1);
});

/** Глава I без полевого ИИ: волны встают в улье и стоят — ровно то, что нужно проверить. */
function afterLastWave(boss: boolean): GameState {
  setMatchMode(pveModeId(0));
  setMatchTravelSpeed(RUN_TRAVEL_SPEED);
  setMatchPveBoss(boss);
  let s = pveState(data, 0);
  const total = data.modes[pveModeId(0)!]!.pve!;
  const lastWaveHour = total.waves * total.waveIntervalHours;
  for (let hour = 1; hour <= lastWaveHour + 1; hour++) s = advance(s, hour * HOUR).state;
  return s;
}

describe('ядро прототипа зовёт Левиафана только по флагу хоста', () => {
  it('без флага в конфиге его нет — песочница и слабый Рой играют без босса', () => {
    expect(ctx(0).config?.pveBoss).toBeUndefined();
    const s = afterLastWave(false);
    expect(s.pve?.waveNumber).toBe(s.pve?.totalWaves);
    expect(s.pve?.boss).toBeUndefined();
  });

  it('с флагом Левиафан выходит из улья главы I вместе с десятой волной', () => {
    setMatchPveBoss(true);
    expect(ctx(0).config?.pveBoss).toBe(true);
    const s = afterLastWave(true);
    const boss = s.pve!.boss!;
    expect(boss.hero).toBe('leviathan');
    const fleet = s.fleets[s.heroes![boss.heroId]!.fleetId!]!;
    expect(fleet.location).toBe(s.fleets[`pve:wave:${s.pve!.waveNumber}`]!.location);
    expect(fleet.units[0]).toMatchObject({
      unit: 'swarm_leviathan',
      count: 1,
      modules: ['leviathan_brood'],
    });
    expect(s.heroes![boss.heroId]!.alive).toBe(true);
  });
});

describe('Левиафана зовёт только дверь забега и только для сильного Роя', () => {
  it('`setRunActive` зовёт его вместе с забегом, по сложности забега', () => {
    const body = /function setRunActive\(on: boolean\): void \{([\s\S]*?)\n\}/.exec(SRC)?.[1];
    expect(body, 'функция setRunActive не найдена — сторож проверял бы пустоту').toBeTruthy();
    expect(body).toContain("setMatchPveBoss(on && pveDifficulty === 'strong')");
  });

  it('больше никто в `main.ts` босса не трогает', () => {
    expect(SRC.match(/\bsetMatchPveBoss\(/g) ?? []).toHaveLength(1);
  });
});

/** Левиафан стоит над домом игрока, флот не в бою; рядом — волна, которую бот сливает с
 *  ним, когда осады нет. Ровно то место, где начинается «Поглощение мира». */
function bossOverHome(): { s: GameState; heroId: string; fleetId: string; ai: string } {
  const s = structuredClone(afterLastWave(true));
  const heroId = s.pve!.boss!.heroId;
  const fleetId = s.heroes![heroId]!.fleetId!;
  const ai = s.pve!.npcPlayerId;
  const park = { location: 'home_a', movement: null, battleId: null, orbit: 'near' as const };
  Object.assign(s.fleets[fleetId]!, park, { bombarding: true });
  s.heroes![heroId]!.location = 'home_a';
  Object.assign(s.fleets.p3_1!, park);
  return { s, heroId, fleetId, ai };
}
/** Осада, идущая над домом игрока с этой минуты. */
function besieged(s: GameState, heroId: string): GameState {
  const next = structuredClone(s);
  next.heroes![heroId]!.siege = {
    target: 'home_a',
    victim: 'p1',
    since: s.time,
    until: s.time + 4 * HOUR,
  };
  return next;
}
const naming = (actions: Action[], id: string): Action[] =>
  actions.filter((a) => {
    const p = a.payload as { fleetId?: unknown; from?: unknown; into?: unknown; heroId?: unknown };
    return [p.fleetId, p.from, p.into, p.heroId].includes(id);
  });

describe('ИИ Роя ведёт осаду Левиафана (PVR-4.7)', () => {
  it('флот Левиафана бомбардирует мир игрока — Рой начинает «Поглощение мира», второе поверх идущего — нет', () => {
    const { s, heroId, ai } = bossOverHome();
    const devours = (st: GameState): unknown[] =>
      naming(aiOrders(st, ai, 'expand', 'strong'), heroId)
        .filter((a) => a.type === 'hero.ability')
        .map((a) => a.payload)
        .filter((p) => (p as { abilityId?: string }).abilityId === 'devour');
    expect(devours(s)).toEqual([{ heroId, abilityId: 'devour', target: 'home_a' }]);
    expect(devours(besieged(s, heroId))).toEqual([]);
    // Без огня осаду не начинают: ядро отбило бы её (`E_NOT_BOMBARDING`).
    const quiet = structuredClone(s);
    quiet.fleets[s.heroes![heroId]!.fleetId!]!.bombarding = false;
    expect(devours(quiet)).toEqual([]);
  });

  it('флот, ведущий осаду, бот не трогает: слияние с волной сорвало бы её самому Рою', () => {
    const { s, heroId, fleetId, ai } = bossOverHome();
    // Сторож проверки: без осады бот сливает флот Левиафана с подошедшей волной.
    expect(naming(aiOrders(s, ai, 'expand', 'strong'), fleetId).map((a) => a.type)).toContain(
      'fleet.merge',
    );
    expect(naming(aiOrders(besieged(s, heroId), ai, 'expand', 'strong'), fleetId)).toEqual([]);
  });

  it('навыкам ростера бот Левиафана не учит — набор у босса свой', () => {
    const { s, heroId, ai } = bossOverHome();
    s.players[ai]!.resources = {
      ...s.players[ai]!.resources,
      microelectronics: 5000,
      credits: 5000,
      energy: 5000,
      metal: 5000,
    };
    const learns = (st: GameState): Action[] =>
      naming(aiOrders(st, ai, 'expand', 'strong'), heroId).filter(
        (a) => a.type === 'hero.skill.unlock',
      );
    expect(learns(s)).toEqual([]);
    // Сторож проверки: тот же герой, будь он не боссом, учит общий узел дерева — ядро такой
    // приказ примет, поэтому держит его только правило бота.
    const plain = structuredClone(s);
    plain.heroes![heroId]!.archetype = 'commander';
    expect(learns(plain)).toHaveLength(1);
  });
});
