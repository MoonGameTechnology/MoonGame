import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { createInitialState, type GameState } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context } from '../action/types';
import { hookedDamage } from '../util/combat';
import { DAMAGE_SCOPE_PHASES, technologyModule } from './technology';

/**
 * BAL-6 — урон ветки идёт только своему каналу огня (решение владельца 2026-10-07).
 *
 * До правки боевые техи складывались в КАЖДЫЙ удар владельца: ракетная ветка усиливала
 * крейсеры так же, как пехоту, и ветки отличались только ценой. Замер selfplay с ботом,
 * ведущим одну ветку за матч, показал это прямо: все доктрины выигрывали 46–56%.
 */

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  buildings: {},
  factions: {},
  events: {},
  technologies: {
    guns: { name: 'Guns', branch: 'space', damageScope: 'space', effects: { combatDamageBonus: 0.5 } },
    drill: { name: 'Drill', branch: 'ground', damageScope: 'ground', effects: { combatDamageBonus: 0.25 } },
    boon: { name: 'Boon', branch: 'command', grantOnly: true, effects: { combatDamageBonus: 0.1 } },
  },
});

/** 100 урона по каналу `phase` от игрока с техами `techs`. */
function fire(phase: string, techs: string[]): number {
  const probe: GameModule = {
    id: 'scope-probe',
    version: '1.0.0',
    setup(api) {
      api.onAction('fire', (_a, h) => {
        h.emit('probe.dealt', {
          dealt: hookedDamage(h, 100, { phase, location: 'A', attacker: 'p1', defender: 'p2' }),
        });
      });
    },
  };
  const kernel = createKernel([probe, technologyModule]);
  const state: GameState = createInitialState({
    seed: 'scope',
    version: { data: '0.1.0', manifest: '1' },
  });
  state.players.p1 = {
    id: 'p1',
    name: 'p1',
    faction: 'x',
    status: 'active',
    resources: {},
    technologies: { completed: techs },
  };
  const action: Action = { id: 's:p1:1', type: 'fire', playerId: 'p1', payload: {}, issuedAt: 0 };
  const ctx: Context = { now: 0, data };
  const r = kernel.applyAction(state, action, ctx);
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return (r.events.find((e) => e.type === 'probe.dealt')?.payload as { dealt: number }).dealt;
}

describe('урон ветки идёт только своему каналу огня (BAL-6)', () => {
  it('космический тех бьёт на орбите и при обстреле, но не в наземном бою', () => {
    expect(fire('orbital', ['guns'])).toBeCloseTo(150, 9);
    expect(fire('bombard', ['guns'])).toBeCloseTo(150, 9);
    expect(fire('ground', ['guns'])).toBe(100);
  });

  it('наземный тех бьёт только в наземном бою', () => {
    expect(fire('ground', ['drill'])).toBeCloseTo(125, 9);
    expect(fire('orbital', ['drill'])).toBe(100);
    expect(fire('shuttle', ['drill'])).toBe(100);
  });

  it('тех без области (награда мета-прокачки) по-прежнему бьёт во всех каналах', () => {
    expect(fire('orbital', ['boon'])).toBeCloseTo(110, 9);
    expect(fire('missile', ['boon'])).toBeCloseTo(110, 9);
  });

  it('в своём канале техи складываются, чужие не вмешиваются', () => {
    expect(fire('ground', ['guns', 'drill', 'boon'])).toBeCloseTo(135, 9);
  });
});

describe('каждый канал огня принадлежит ровно одной области (BAL-6)', () => {
  // Каналы — это `phase:` в аргументах хука урона, их ставит сам канал. Новый канал без
  // области молча лишил бы свои удары ВСЕХ боевых техов — ровно такой дрейф и сторожит
  // `damageHookScope.test.ts` для самого хука.
  const root = new URL('../', import.meta.url);
  const phases = new Set<string>();
  for (const name of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    for (const m of readFileSync(new URL(name, root), 'utf8').matchAll(/\bphase: '([A-Za-z]+)'/g))
      phases.add(m[1]!);
  }

  it('сканер нашёл каналы', () => {
    expect([...phases]).toEqual(expect.arrayContaining(['orbital', 'ground', 'missile']));
  });

  it.each([...phases].sort())('канал %s', (phase) => {
    const owners = Object.entries(DAMAGE_SCOPE_PHASES).filter(([, list]) => list.includes(phase));
    expect(owners.map(([scope]) => scope)).toHaveLength(1);
  });

  it('в таблице нет канала, которого нет в коде', () => {
    for (const list of Object.values(DAMAGE_SCOPE_PHASES))
      for (const phase of list) expect(phases.has(phase)).toBe(true);
  });
});

describe('боевой тех дерева усиливает канал своей ветки (BAL-6)', () => {
  const shipped = JSON.parse(
    readFileSync(new URL('../../../../data/technologies.json', import.meta.url), 'utf8'),
  ) as Record<
    string,
    { branch?: string; damageScope?: string; grantOnly?: boolean; effects?: { combatDamageBonus?: number } }
  >;
  const combat = Object.entries(shipped).filter(([, d]) => (d.effects?.combatDamageBonus ?? 0) !== 0);

  it.each(combat.filter(([, d]) => !d.grantOnly).map(([id, d]) => [id, d] as const))(
    '%s',
    (_id, d) => {
      expect(d.damageScope).toBe(d.branch);
    },
  );

  it('награды мета-прокачки остаются без области', () => {
    for (const [, d] of combat.filter(([, x]) => x.grantOnly)) expect(d.damageScope).toBeUndefined();
  });
});
