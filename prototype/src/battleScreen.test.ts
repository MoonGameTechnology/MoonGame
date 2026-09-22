/**
 * ОКНО БОЯ — что оно обязано показать и чего показать НЕ должно.
 *
 * Проверяется вёрстка как чистая функция: `battleWindowHtml` берёт модель панели и отдаёт
 * строку, поэтому всё правило можно проверить без браузера — ровно как у остальных
 * REFM-экранов.
 */
import { describe, it, expect } from 'vitest';
import { battleWindowHtml, sideRowHtml, battleRetreats } from './battleScreen';
import '../../localization/runtime';
import { displayUnit } from './format';
import type { BattleModel } from '../../packages/client/src/matchHud';

const side = (
  owner: string,
  role: 'attacker' | 'defender',
  mine = false,
  kind: BattleModel['sides'][number]['kind'] = 'fleet',
): BattleModel['sides'][number] => ({
  owner,
  ownerName: owner.toUpperCase(),
  ownerFaction: 'x',
  kind,
  units: [{ unit: 'cruiser', count: 3 }],
  mine,
  role,
});

const battle = (sides: BattleModel['sides']): BattleModel => ({
  kind: 'battle',
  id: 'b1',
  location: 'Гелиос-III',
  phase: 'orbital',
  round: 4,
  nextRoundAt: 9000,
  sides,
  attacker: sides.find((s) => s.role === 'attacker')!,
  defender: sides.find((s) => s.role === 'defender')!,
});

describe('окно боя', () => {
  it('показывает ВСЕ стороны, а не двоих', () => {
    const html = battleWindowHtml(
      battle([side('p1', 'attacker', true), side('p2', 'defender'), side('p3', 'attacker')]),
    );
    // Считаем по `bw-who` — по одной на строку стороны. `bw-side` совпал бы и с
    // контейнером `bw-sides`, и тест зеленел бы на четырёх «сторонах» вместо трёх.
    expect(html.match(/class="bw-who"/g) ?? []).toHaveLength(3);
    for (const who of ['P1', 'P2', 'P3']) expect(html).toContain(who);
  });

  it('роль берётся У СТОРОНЫ, а не из места в списке', () => {
    // Двое атакующих подряд: вывести роль из порядка нельзя в принципе.
    const rows = [side('p1', 'attacker'), side('p2', 'attacker'), side('p3', 'defender')].map(
      sideRowHtml,
    );
    expect(rows[0]).toContain('attacker');
    expect(rows[1]).toContain('attacker');
    expect(rows[2]).toContain('defender');
  });

  it('СВОЯ сторона помечена — в свалке «где я» первый вопрос', () => {
    const mine = sideRowHtml(side('p1', 'attacker', true));
    const other = sideRowHtml(side('p2', 'attacker', false));
    expect(mine).toContain('mine');
    expect(other).not.toContain('mine');
  });

  it('силы стороны видны: состав и корпус', () => {
    const s = side('p1', 'defender');
    s.hull = { current: 120, max: 200 };
    const html = sideRowHtml(s);
    expect(html).toContain(`3× ${displayUnit('cruiser')}`);
    expect(html).toContain('120/200');
  });

  it('вид стороны назван своим словом: плацдарм — не «флот»', () => {
    const beach = sideRowHtml(side('p1', 'attacker', false, 'beachhead'));
    const fleet = sideRowHtml(side('p1', 'attacker', false, 'fleet'));
    const garrison = sideRowHtml(side('p1', 'defender', false, 'garrison'));
    // Три вида — три РАЗНЫХ подписи. До MSB-4 плацдарм на карточке был неотличим от
    // флота, и совместный штурм читался как «два флота бьют мир».
    expect(new Set([beach, fleet, garrison]).size).toBe(3);
  });

  it('таймер следующего раунда — живой узел, а не запечённое число', () => {
    expect(battleWindowHtml(battle([side('p1', 'attacker'), side('p2', 'defender')]))).toContain(
      'data-at="9000"',
    );
  });

  it('БОЙ ИСЧЕЗ, пока палец летел к экрану — честная строка, а не пустая рамка', () => {
    const html = battleWindowHtml(null);
    expect(html).toContain('bw-empty');
    expect(html).not.toContain('bw-side');
  });
});

import { newGame } from './game';
it('retreat is available only for living own ship sides, never landing or foreign forces', () => {
  const state = newGame();
  const mine = Object.values(state.fleets).find((f) => f.owner === 'p1')!;
  const foe = Object.values(state.fleets).find((f) => f.owner !== 'p1')!;
  mine.battleId = 'b';
  foe.battleId = 'b';
  state.battles.b = {
    id: 'b',
    location: mine.location!,
    phase: 'orbital',
    round: 1,
    sides: [
      { owner: mine.owner, role: 'attacker', ref: { kind: 'fleet', fleetId: mine.id } },
      { owner: foe.owner, role: 'defender', ref: { kind: 'fleet', fleetId: foe.id } },
      { owner: mine.owner, role: 'attacker', ref: { kind: 'landing', fleetId: mine.id } },
    ],
  };
  expect(battleRetreats(state, 'b', 'p1')).toEqual([mine.id]);
  mine.battleId = null;
  expect(battleRetreats(state, 'b', 'p1')).toEqual([]);
  expect(battleRetreats(state, 'missing', 'p1')).toEqual([]);
});
