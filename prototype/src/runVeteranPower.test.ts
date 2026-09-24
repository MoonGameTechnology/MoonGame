/**
 * Сила ветерана — только в забеге (VET-6, резолюция владельца 2026-09-24: «в сетевой
 * только награда, а в Sector Zero — урон, корпус и выплата»).
 *
 * Та же форма, что у сторожа темпа (`runTravelSpeed.test.ts`), и по той же причине:
 * правило ставит ХОСТ, а не режим, поэтому держат его две половины.
 *
 * 1. **Ядро прототипа получает флаг из `ctx`.** Без забега конфиг его не несёт, и
 *    правило ветерана отвечает «надбавки нет» — песочница играет по сетевым правилам.
 * 2. **Включает его только дверь забега.** `main.ts` в vitest не поднять, поэтому стык
 *    держит статическая проверка: `setMatchVeteranPower` зовут только внутри
 *    `setRunActive`. Иначе сила ветерана пережила бы выход из забега и утекла в песочницу.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { ctx, setMatchVeteranPower } from './game';
import { data } from './gameData';
import {
  createInitialState,
  veteranFactor,
  veteranHull,
  type Battle,
  type GameState,
} from '../../packages/shared-core/src/index';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

afterEach(() => setMatchVeteranPower(false));

/** Бой, где у p1 четыре пережитых боя на юнит. */
function veteranBattle(): { state: GameState; battle: Battle } {
  const state = createInitialState({ seed: 'vet', version: { data: data.version, manifest: '1' } });
  state.fleets.f1 = {
    id: 'f1',
    owner: 'p1',
    location: 'x',
    movement: null,
    traits: [],
    units: [{ unit: 'cruiser', count: 3, battles: 4 }],
  };
  const battle: Battle = {
    id: 'b1',
    location: 'x',
    phase: 'orbital',
    round: 0,
    sides: [{ ref: { kind: 'fleet', fleetId: 'f1' }, owner: 'p1', role: 'attacker' }],
  };
  state.battles.b1 = battle;
  return { state, battle };
}

describe('ядро прототипа получает силу ветерана только в забеге', () => {
  it('без забега — сетевые правила: флага нет, надбавки нет', () => {
    expect(ctx(0).config?.veteranPower).toBeUndefined();
    const { state, battle } = veteranBattle();
    expect(veteranFactor(state, battle, 'p1', data, ctx(0).config)).toBe(1);
    expect(veteranHull(state, battle, 'p1', data, ctx(0).config)).toBe(0);
  });

  it('в забеге ветеран бьёт сильнее и держит больше — по ставкам шипнутых данных', () => {
    setMatchVeteranPower(true);
    expect(ctx(0).config?.veteranPower).toBe(true);
    const { state, battle } = veteranBattle();
    const config = ctx(0).config;
    expect(veteranFactor(state, battle, 'p1', data, config)).toBeCloseTo(
      1 + data.veteran.damagePerBattle * 4,
      9,
    );
    expect(veteranHull(state, battle, 'p1', data, config)).toBeCloseTo(data.veteran.hullPerBattle * 4, 9);
  });
});

describe('силу ветерана включает только дверь забега', () => {
  it('`setRunActive` включает её вместе с забегом и снимает вместе с ним', () => {
    const body = /function setRunActive\(on: boolean\): void \{([\s\S]*?)\n\}/.exec(SRC)?.[1];
    expect(body, 'функция setRunActive не найдена — сторож проверял бы пустоту').toBeTruthy();
    expect(body).toContain('setMatchVeteranPower(on)');
  });

  it('больше никто в `main.ts` силу ветерана не трогает', () => {
    const calls = SRC.match(/\bsetMatchVeteranPower\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });
});
