/**
 * ОКНО БОЯ — что оно обязано показать и чего показать НЕ должно.
 *
 * Проверяется вёрстка как чистая функция: `battleWindowHtml` берёт модель панели и отдаёт
 * строку, поэтому всё правило можно проверить без браузера — ровно как у остальных
 * REFM-экранов.
 */
import { describe, it, expect } from 'vitest';
import {
  battleEndedHtml,
  battleHeadHtml,
  battleWindowHtml,
  sideRowHtml,
  battleRetreats,
} from './battleScreen';
import { t } from '../../localization/runtime';
import { displayUnit, esc, fmtHrs } from './format';
import { engageForecastCard } from '../../decisions/engageForecast';
import type { BattleForecast, ForecastSide } from '../../decisions/battleForecast';
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
  ref: kind === 'fleet' || kind === 'landing' ? { kind, fleetId: `${owner}-1` }
    : kind === 'garrison' ? { kind, planetId: 'P' } : { kind, planetId: 'P', owner },
  ...(role === 'attacker' ? { nextAttackAt: 9000, attackStartedAt: 0 } : {}),
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
      (sd) => sideRowHtml(sd),
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

  it('надбавка за пережитые бои названа числом и подписью (PERK-3.3)', () => {
    // До этого кирпича множитель менял урон и не был показан НИГДЕ: игрок читал его как
    // разброс. Строка обязана назвать величину, а подпись — откуда она взялась.
    const sd = side('p1', 'attacker', true);
    sd.veteran = 1.16;
    const html = sideRowHtml(sd);
    expect(html).toContain('bw-vet');
    expect(html).toContain('+16%');
    expect(html).toContain(t('battle.win.veteran', { n: 16 }));
    // Подпись доступна не только мышью: у значка есть и `aria-label`.
    expect(html).toContain('aria-label="' + t('battle.win.veteran', { n: 16 }));
  });

  it('корпус ветерана доходит до строки вместе с уроном (VET-6)', () => {
    // В забеге выслуга даёт и прочность: подпись обязана назвать обе половины, иначе
    // игрок снова прочтёт половину надбавки как разброс.
    const sd = side('p1', 'attacker', true);
    sd.veteran = 1.16;
    sd.veteranHull = 0.16;
    const html = sideRowHtml(sd);
    expect(html).toContain('+16%');
    expect(html).toContain(t('battle.win.veteran-both', { n: 16, h: 16 }));
  });

  it('у необстрелянной стороны строка не меняется НИ НА СИМВОЛ', () => {
    // Тот же уговор, что у медалей в составе (VET-5): «надбавки нет» отдельным
    // сообщением не пишется — это верно для большинства сторон, и место оно отбирало бы
    // у самого расклада.
    const plain = side('p2', 'defender');
    const zero = { ...side('p2', 'defender'), veteran: 1 };
    const rounded = { ...side('p2', 'defender'), veteran: 1.004 };
    expect(sideRowHtml(zero)).toBe(sideRowHtml(plain));
    expect(sideRowHtml(rounded)).toBe(sideRowHtml(plain));
  });

  it('силы стороны видны: состав и корпус', () => {
    const s = side('p1', 'defender');
    s.hull = { current: 120, max: 200 };
    const html = sideRowHtml(s);
    expect(html).toContain(`<b>3×</b> ${displayUnit('cruiser')}`);
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

  it('шкала корпуса светофором и словом: цвет не единственный носитель смысла', () => {
    const s = side('p1', 'defender');
    s.hull = { current: 40, max: 200 };
    const html = sideRowHtml(s);
    expect(html).toContain('tone-low');
    expect(html).toContain('width:20%');
    expect(html).toContain(t('battle.win.tone.low'));
  });

  it('полоса остатка сил — доли цветами владельцев; без корпуса полосы нет', () => {
    const a = side('p1', 'attacker', true);
    const b = side('p2', 'defender');
    a.hull = { current: 300, max: 300 };
    b.hull = { current: 100, max: 300 };
    const color = (o: string | null): string => (o === 'p1' ? '#00ffff' : '#ff0000');
    const html = battleWindowHtml(battle([a, b]), [], { color });
    expect(html).toContain('bw-bal');
    expect(html).toContain('flex:0.7500;background:#00ffff');
    expect(html).toContain('P2 25%');
    expect(
      battleWindowHtml(battle([side('p1', 'attacker'), side('p2', 'defender')])),
    ).not.toContain('bw-bal');
  });

  it('свой флот в бою назван позывным и показывает авто-отход', () => {
    const html = battleWindowHtml(
      battle([side('p1', 'attacker', true), side('p2', 'defender')]),
      ['p1-1'],
      {
        fleetName: () => 'ПАЛАДИН 2',
        autoRetreatAt: () => 0.3,
        placeName: () => 'Комета',
      },
    );
    expect(html).toContain('ПАЛАДИН 2');
    expect(html).toContain(t('battle.win.auto.on', { n: 30 }));
    expect(html).toContain('data-battle-retreat="p1-1"');
  });

  // Заказ владельца 2026-09-28: место, фаза и число сторон стояли карточкой над полосой
  // сил и съедали её высоту — теперь они в шапке окна, а в теле их нет.
  it('где бой, фаза и число сторон — в шапке окна, не отдельной карточкой в теле', () => {
    const m = battle([side('p1', 'attacker', true), side('p2', 'defender'), side('p3', 'attacker')]);
    const head = battleHeadHtml(m, { placeName: () => 'Комета' });
    expect(head).toContain(t('battle.win.at', { w: 'Комета' }));
    expect(head).toContain(t('battle.win.phase.orbit'));
    expect(head).toContain(t('battle.win.sides', { n: 3 }));
    expect(head).not.toContain('ground');
    const ground = battleHeadHtml({ ...m, phase: 'ground' });
    expect(ground).toContain(t('battle.win.phase.ground'));
    expect(ground).toContain('bw-phase ground');
    const body = battleWindowHtml(m, [], { placeName: () => 'Комета' });
    expect(body).not.toContain('Комета');
    expect(body).not.toContain(t('battle.win.phase.orbit'));
    // Нет боя — шапка просто «Бой», без места и фазы.
    expect(battleHeadHtml(null)).toBe(`<b>${t('battle.win.head')}</b>`);
  });

  it('БОЙ ИСЧЕЗ, пока палец летел к экрану — честная строка, а не пустая рамка', () => {
    const html = battleWindowHtml(null);
    expect(html).toContain('bw-empty');
    expect(html).not.toContain('bw-side');
  });
  // Решение владельца 2026-09-25: бой у планеты при осаде длится раунд-два, и окно тут же
  // пустело — «открылось и сразу закрылось». Теперь оно держит итог до закрытия.
  it('БОЙ КОНЧИЛСЯ при открытом окне — итог и последний снимок сторон, без отсчёта и отхода', () => {
    const last = battle([side('p1', 'attacker', true), side('p2', 'defender')]);
    const html = battleEndedHtml(last, '⚔ бой завершён · Застава — отбились · потери: 2');
    expect(html).toContain('bw-ended');
    expect(html).toContain(t('battle.win.ended'));
    expect(html).toContain('отбились');
    expect(html.match(/class="bw-who"/g) ?? []).toHaveLength(2); // стороны на месте
    expect(html).not.toContain('pn-timer'); // раундов больше не будет
    expect(html).not.toContain('data-battle-retreat'); // отходить не из чего
    expect(html).not.toContain('bw-empty');
  });

  it('итог есть, снимка нет (окно открыли на последнем раунде) — одна строка итога', () => {
    const html = battleEndedHtml(null, 'отбились');
    expect(html).toContain('bw-ended');
    expect(html).not.toContain('bw-side');
  });
});

describe('прогноз и правила в окне боя (UIX-6.2)', () => {
  const card: BattleForecast = {
    kind: 'card',
    card: engageForecastCard({
      outcome: 'attacker',
      roundsEst: 3,
      attacker: { damageFraction: 0.2 },
      defender: { damageFraction: 1 },
    }),
  };

  it('прогноз — словом, сроком и потерями; цвет лишь дублирует слово', () => {
    const html = battleWindowHtml(
      battle([side('p1', 'attacker', true), side('p2', 'defender')]),
      [],
      { forecast: () => card },
    );
    expect(html).toContain('bw-forecast positive');
    expect(html).toContain(t('engage.forecast.win'));
    expect(html).toContain(esc(t('engage.forecast.line', { h: fmtHrs(3), own: 20, foe: 100 })));
    // Прогноз стоит над колонками сторон, а не теряется под ними.
    expect(html.indexOf('bw-forecast')).toBeLessThan(html.indexOf('bw-columns'));
  });

  it('в прогноз идёт текущий состав стороны — стеки с остатком корпуса', () => {
    const a = side('p1', 'attacker', true);
    a.stacks = [{ unit: 'cruiser', count: 3, hp: 50 }];
    let seen: readonly ForecastSide[] = [];
    battleWindowHtml(battle([a, side('p2', 'defender')]), [], {
      forecast: (sides) => ((seen = sides), null),
    });
    expect(seen).toEqual([
      { mine: true, role: 'attacker', units: [{ unit: 'cruiser', count: 3, hp: 50 }] },
      { mine: false, role: 'defender', units: [{ unit: 'cruiser', count: 3 }] },
    ]);
  });

  it('сторон больше двух — честная строка «прогноза нет»; без прогноза — ни строки', () => {
    const m = battle([side('p1', 'attacker', true), side('p2', 'defender'), side('p3', 'attacker')]);
    expect(battleWindowHtml(m, [], { forecast: () => ({ kind: 'many' }) })).toContain(
      t('battle.win.forecast-many'),
    );
    expect(battleWindowHtml(m, [], { forecast: () => null })).not.toContain('bw-forecast');
    expect(battleWindowHtml(m)).not.toContain('bw-forecast');
  });

  it('кончившийся бой прогноза не показывает', () => {
    const last = battle([side('p1', 'attacker', true), side('p2', 'defender')]);
    expect(battleEndedHtml(last, 'отбились', { forecast: () => card })).not.toContain(
      'bw-forecast',
    );
  });

  it('на виду одна строка цены отхода, правила — под «?»', () => {
    const m = battle([side('p1', 'attacker', true), side('p2', 'defender')]);
    const closed = battleWindowHtml(m, ['p1-1']);
    expect(closed).toContain(t('battle.win.retreat-cost'));
    expect(closed).toContain('data-battle-rules aria-expanded="false"');
    expect(closed).not.toContain(esc(t('battle.win.retreat-rules')));
    expect(closed).not.toContain(esc(t('battle.win.rule')));
    const open = battleWindowHtml(m, ['p1-1'], {}, { rules: true });
    expect(open).toContain('data-battle-rules aria-expanded="true"');
    expect(open).toContain(esc(t('battle.win.retreat-rules')));
    expect(open).toContain(esc(t('battle.win.rule')));
  });

  it('на земле на виду «не отступают», под «?» — только правила раундов', () => {
    const m = {
      ...battle([side('p1', 'attacker', true, 'beachhead'), side('p2', 'defender', false, 'garrison')]),
      phase: 'ground' as const,
    };
    const open = battleWindowHtml(m, [], {}, { rules: true });
    expect(open).toContain(t('battle.win.ground-retreat'));
    expect(open).not.toContain(t('battle.win.retreat-cost'));
    expect(open).not.toContain(esc(t('battle.win.retreat-rules')));
    expect(open).toContain(esc(t('battle.win.rule')));
  });

  it('в чужом бою приказов нет — под «?» только правила боя', () => {
    const html = battleWindowHtml(battle([side('p2', 'attacker'), side('p3', 'defender')]));
    expect(html).toContain(t('battle.win.rules'));
    expect(html).not.toContain(t('battle.win.retreat-cost'));
    expect(html).not.toContain('bw-orders');
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

it('uses the configured own color, fixed blue allies, and never gives allies commands', () => {
  const mine = side('p1', 'defender', true);
  const ally = { ...side('p3', 'attacker'), relation: 'ally' as const };
  const html = battleWindowHtml(battle([mine, ally, side('p2', 'attacker')]), ['p1-1'], { color: () => '#c67dff' });
  expect(html).toContain('--own:#c67dff');
  expect(html).toContain('--own:#4a8cff');
  expect(html.match(/data-battle-attack=/g)).toHaveLength(1);
  expect(html.match(/class="pn-timer"/g)).toHaveLength(2); // only the two attackers
  expect(html.indexOf('P3')).toBeLessThan(html.indexOf(t('battle.win.opponents')));
  expect(sideRowHtml(mine)).toContain('--own:#3ad17a');
});

it('folding many distinct stacks preserves damage, effects and orders', () => {
  const mine = { ...side('p1', 'defender', true), key: 'own' };
  mine.units = Array.from({ length: 23 }, () => ({ unit: 'cruiser', count: 1 }));
  mine.readout = { attack: 432, defense: { min: 123, max: 123 }, modifiers: [
    { source: 'sector', hook: 'combat.mitigation', direction: 'incoming', value: -0.15, beneficial: false, against: 'p2' },
  ] };
  let requested = -1;
  const view = { tiles: (_: unknown, limit: number) => { requested = limit; return '<b class="real-tiles"></b>'; } };
  const folded = sideRowHtml(mine, view, { expanded: new Set(), retreats: ['p1-1'] });
  expect(folded).toContain('432');
  expect(folded).toContain('123');
  expect(folded).toContain('data-battle-effects');
  expect(folded).toContain('data-battle-attack');
  expect(folded).not.toContain('real-tiles');
  expect(requested).toBe(-1);
  const expanded = sideRowHtml(mine, view, { expanded: new Set(['own']), effects: new Set(['own']) });
  expect(requested).toBe(16);
  expect(expanded).toContain(t('battle.win.more', { n: 7 }));
  expect(expanded).toContain('debuff');
  expect(expanded).toContain('−15');
  sideRowHtml(mine, view, { fullComposition: new Set(['own']) });
  expect(requested).toBe(Infinity);
});
