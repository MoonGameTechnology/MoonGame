/**
 * Окно боя рядами (заказ владельца 2026-11-17): что видно на схеме, какие стрелки, какие
 * приказы внизу и что говорит табло. Проверяется вёрсткой как чистой функцией.
 */
import { describe, expect, it } from 'vitest';
import { battleSheetHtml, battleWindowArrows, battleWindowHtml } from './battleScreen';
import { t } from '../../localization/runtime';
import { esc } from './format';
import type { BattleModel } from '../../packages/client/src/matchHud';

type Side = BattleModel['sides'][number];

const side = (
  owner: string | null,
  role: 'attacker' | 'defender',
  extra: Partial<Side> = {},
): Side => {
  const id = `${owner ?? 'x'}-${extra.key ?? '1'}`;
  return {
    owner,
    ownerName: (owner ?? 'n').toUpperCase(),
    ownerFaction: 'x',
    kind: 'fleet',
    units: [{ unit: 'cruiser', count: 3 }],
    mine: false,
    role,
    key: id,
    ref: { kind: 'fleet', fleetId: id },
    ...(role === 'attacker' ? { nextAttackAt: 9000, attackStartedAt: 0 } : {}),
    ...extra,
    ...(extra.key ? { key: id } : {}),
  };
};
const mine = (role: 'attacker' | 'defender', extra: Partial<Side> = {}): Side =>
  side('p1', role, { mine: true, relation: 'own', ...extra });
const ally = (role: 'attacker' | 'defender', extra: Partial<Side> = {}): Side =>
  side('p3', role, { relation: 'ally', ...extra });

const battle = (sides: Side[], phase: 'orbital' | 'ground' = 'orbital'): BattleModel => ({
  kind: 'battle',
  id: 'b1',
  location: 'L',
  phase,
  round: 2,
  nextRoundAt: 9000,
  sides,
  attacker: sides.find((s) => s.role === 'attacker') ?? sides[0]!,
  defender: sides.find((s) => s.role === 'defender') ?? sides[0]!,
});

/** Враждуют все, кроме меня с союзником p3 и p4 с нами обоими. */
const hostile = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (a === b) return false;
  const pair = [a, b].sort().join('|');
  return !['p1|p3', 'p1|p4', 'p3|p4'].includes(pair);
};

describe('ряды схемы', () => {
  it('противники — сверху, свои и союзник — снизу, между рядами зазор для стрелок', () => {
    const html = battleWindowHtml(
      battle([side('p2', 'attacker'), mine('attacker'), ally('defender')]),
      [],
      { hostile },
    );
    const gap = html.indexOf('bw-gap');
    expect(html.indexOf('data-battle-side="p2-1"')).toBeLessThan(gap);
    expect(html.indexOf('data-battle-side="p1-1"')).toBeGreaterThan(gap);
    expect(html.indexOf('data-battle-side="p3-1"')).toBeGreaterThan(gap);
    // Своя плитка подписана «Вы» не только цветом.
    expect(html).toContain(`<em class="bw-ft-you">${t('battle.win.you')}</em>`);
  });

  it('больше восьми сторон в ряду — хвост в плитке «+N», раскрытый ряд — целиком', () => {
    const foes = Array.from({ length: 11 }, (_, i) => side('p2', 'defender', { key: `${i}` }));
    const m = battle([mine('attacker'), ...foes]);
    const folded = battleWindowHtml(m, [], { hostile });
    expect(folded).toContain('data-battle-lane="theirs"');
    expect(folded).toContain('<b>+4</b>');
    expect(folded.match(/data-battle-side=/g)).toHaveLength(1 + 7);
    const open = battleWindowHtml(m, [], { hostile }, { openLanes: new Set(['theirs']) });
    expect(open.match(/data-battle-side=/g)).toHaveLength(12);
    expect(open).toContain(esc(t('battle.win.fold')));
  });

  it('у плитки флота с героем — его лик; у гарнизона чужой державы — её имя', () => {
    const icon = (s: Side): string => (s.owner === 'p1' ? '<i class="face"></i>' : '');
    const garrison = side('p2', 'defender', {
      kind: 'garrison',
      ref: { kind: 'garrison', planetId: 'L' },
      ownerName: 'P2',
    });
    const html = battleWindowHtml(battle([mine('attacker'), garrison], 'ground'), [], {
      icon,
      hostile,
    });
    expect(html).toContain('<span class="bw-ft-ic"><i class="face"></i></span>');
    expect(html).toContain('<b class="bw-ft-name">P2</b>');
  });

  it('заряд остатка залпа на своём флоте — значок с уроном', () => {
    const html = battleWindowHtml(battle([mine('attacker'), side('p2', 'defender')]), [], {
      hostile,
      charge: (id) => (id === 'p1-1' ? { damage: 9.4, until: 1 } : null),
    });
    expect(html.match(/bw-ft-charge/g)).toHaveLength(1);
    expect(html).toContain(esc(t('battle.win.charge', { n: 9, m: 5 })));
  });
});

describe('стрелки: только наши залпы', () => {
  it('я атакую двоих — две стрелки, каждой половина; куда бьёт враг, не видно', () => {
    const arrows = battleWindowArrows(
      battle([mine('attacker'), side('p2', 'attacker'), side('p2', 'defender', { key: '2' })]),
      { hostile },
    );
    expect(arrows.map((a) => [a.from, a.to, a.of, a.reply])).toEqual([
      ['p1-1', 'p2-1', 2, false],
      ['p1-1', 'p2-2', 2, false],
    ]);
  });

  it('на меня напали — видно только мой ответ; фильтр «Ответ» его прячет', () => {
    const m = battle([side('p2', 'attacker'), mine('defender')]);
    expect(battleWindowArrows(m, { hostile }).map((a) => [a.from, a.reply])).toEqual([
      ['p1-1', true],
    ]);
    expect(battleWindowArrows(m, { hostile }, { replies: false })).toEqual([]);
  });

  it('фильтр «Мои» убирает стрелки союзника; в чужом бою стрелок нет', () => {
    const m = battle([mine('attacker'), ally('attacker'), side('p2', 'defender')]);
    expect(battleWindowArrows(m, { hostile })).toHaveLength(2);
    expect(battleWindowArrows(m, { hostile }, { arrows: 'mine' }).map((a) => a.from)).toEqual([
      'p1-1',
    ]);
    const html = battleWindowHtml(m, [], { hostile });
    expect(html).toContain('data-battle-arrows="mine"');
    expect(
      battleWindowArrows(battle([side('p2', 'attacker'), side('p5', 'defender')]), { hostile }),
    ).toEqual([]);
  });

  it('стрелки в свёрнутую сторону сливаются в одну стрелку к «+N»', () => {
    const foes = Array.from({ length: 11 }, (_, i) => side('p2', 'defender', { key: `${i}` }));
    const arrows = battleWindowArrows(battle([mine('attacker'), ...foes]), { hostile });
    const toGroup = arrows.filter((a) => a.to === 'lane:theirs');
    expect(toGroup).toHaveLength(1);
    expect(toGroup[0]!.n).toBe(4);
    expect(arrows).toHaveLength(7 + 1);
  });
});

describe('приказы внизу', () => {
  it('свой флот один — он выделен сразу: «Отступить» и «Подробнее»', () => {
    const html = battleWindowHtml(battle([mine('attacker'), side('p2', 'defender')]), ['p1-1'], {
      hostile,
    });
    expect(html).toContain('data-battle-retreat="p1-1"');
    expect(html).toContain('data-battle-info="p1-1"');
    expect(html).not.toContain('data-battle-attack-all');
    expect(html).toContain(esc(t('battle.win.one-target')));
  });

  it('обороняюсь — есть «В атаку»; отступить нельзя — кнопка серая', () => {
    const html = battleWindowHtml(battle([mine('defender'), side('p2', 'attacker')]), [], {
      hostile,
    });
    expect(html).toMatch(/data-battle-attack="p1-1"/);
    expect(html).toMatch(/data-battle-retreat="p1-1" disabled/);
  });

  it('своих флотов два и ни один не выбран — общие приказы и подсказка', () => {
    const m = battle([mine('attacker'), mine('defender', { key: '2' }), side('p2', 'attacker')]);
    const html = battleWindowHtml(m, ['p1-1', 'p1-2'], { hostile });
    expect(html).toContain('data-battle-attack-all');
    expect(html).toContain('data-battle-retreat-all');
    expect(html).toContain(esc(t('battle.win.pick-own')));
    const picked = battleWindowHtml(m, ['p1-1', 'p1-2'], { hostile }, { sel: 'p1-2' });
    expect(picked).toContain('data-battle-attack="p1-2"');
    expect(picked).toContain('data-battle-unselect');
    expect(picked).toContain('bw-ft me pick');
  });

  it('наземные войска не отступают: кнопки отхода нет; в кончившемся бою приказов нет', () => {
    const beach = mine('attacker', {
      kind: 'beachhead',
      ref: { kind: 'beachhead', planetId: 'L', owner: 'p1' },
    });
    const garrison = side('p2', 'defender', {
      kind: 'garrison',
      ref: { kind: 'garrison', planetId: 'L' },
    });
    const html = battleWindowHtml(battle([beach, garrison], 'ground'), [], { hostile });
    expect(html).not.toContain('data-battle-retreat=');
    expect(html).toContain('data-battle-info');
    const ended = battleWindowHtml(battle([beach, garrison]), [], { hostile }, { ended: true });
    expect(ended).not.toContain('bw-orders');
  });
});

describe('лист стороны', () => {
  it('свой атакующий — по кому бьёт и какой долей; враг — «не видно»', () => {
    const m = battle([
      mine('attacker'),
      side('p2', 'attacker'),
      side('p2', 'defender', { key: '2' }),
    ]);
    const own = battleSheetHtml(m, { hostile }, { sheet: 'p1-1' });
    expect(own).toContain('class="bw-who"');
    expect(own).toContain(esc(t('battle.win.hits', { list: 'p2-1 (½), p2-2 (½)' })));
    expect(battleSheetHtml(m, { hostile }, { sheet: 'p2-1' })).toContain(
      esc(t('battle.win.aim-hidden')),
    );
    expect(battleSheetHtml(m, { hostile }, {})).toBe('');
  });
});

describe('строки табло', () => {
  it('перегруз линии державы назван числами (MSB-11)', () => {
    const big = mine('attacker', { units: [{ unit: 'frigate', count: 15 }] });
    const second = mine('defender', { key: '2', units: [{ unit: 'cruiser', count: 10 }] });
    const html = battleWindowHtml(battle([big, second, side('p2', 'defender')]), [], {
      hostile,
    });
    expect(html).toContain(esc(t('battle.win.overload', { n: 25, cap: 10, pct: 40 })));
    expect(
      battleWindowHtml(battle([mine('attacker'), side('p2', 'defender')]), [], { hostile }),
    ).not.toContain('bw-note warn');
  });

  it('два плацдарма — кому достанется мир: первому высадившемуся', () => {
    const beach = (owner: string, extra: Partial<Side>): Side =>
      side(owner, 'attacker', {
        kind: 'beachhead',
        ref: { kind: 'beachhead', planetId: 'L', owner },
        ...extra,
      });
    const m = battle(
      [
        beach('p1', { mine: true, relation: 'own' }),
        beach('p3', { relation: 'ally' }),
        side('p2', 'defender', { kind: 'garrison', ref: { kind: 'garrison', planetId: 'L' } }),
      ],
      'ground',
    );
    const ownerName = (o: string | null): string => (o === 'p3' ? 'Северный союз' : String(o));
    const html = battleWindowHtml(m, [], {
      hostile,
      ownerName,
      landingOrder: () => ['p3', 'p1'],
    });
    expect(html).toContain(esc(t('battle.win.heir', { name: 'Северный союз' })));
    // Один плацдарм — вопроса, кому достанется мир, нет.
    expect(
      battleWindowHtml({ ...m, sides: [m.sides[0]!, m.sides[2]!] }, [], { hostile, ownerName }),
    ).not.toContain('class="bw-note"');
  });

  it('осада своего мира — строка с живым отсчётом; в чужом бою — «вы не участвуете»', () => {
    const m = battle([mine('attacker'), side('p2', 'defender')]);
    const html = battleWindowHtml(m, [], {
      hostile,
      placeName: () => 'Немея',
      siege: () => ({ archetype: 'leviathan', until: 12345 }),
    });
    expect(html).toContain('class="bw-alert"');
    expect(html).toContain('<b class="pn-timer" data-at="12345">');
    expect(html).toContain('Немея');
    const watch = battleWindowHtml(battle([side('p2', 'attacker'), side('p5', 'defender')]), [], {
      hostile,
    });
    expect(watch).toContain(esc(t('battle.win.watch')));
    expect(watch).not.toContain('bw-orders');
  });
});
