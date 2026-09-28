import { describe, expect, it } from 'vitest';
import type { Fleet, HookTrace } from '../packages/shared-core/src/index';
import { ru } from '../localization/ru';
import { en } from '../localization/en';
import {
  fleetStatMods,
  fleetStatQueries,
  LIMP_SOURCE,
  OTHER_SOURCE_KEY,
  pctText,
  STAT_SOURCE_KEYS,
  statSourceKey,
} from './statModifiers';

const fleet = (over: Partial<Fleet> = {}): Fleet =>
  ({ id: 'f1', owner: 'p1', location: 'lethe', movement: null, units: [], ...over }) as Fleet;

/** Ответ ядра: пять конвейеров в порядке `fleetStatQueries`. */
function traces(parts: {
  seq?: HookTrace['steps'];
  par?: HookTrace['steps'];
  speed?: { base: number; steps: HookTrace['steps'] };
  hit?: HookTrace['steps'];
  pool?: HookTrace['steps'];
}): HookTrace[] {
  const pipe = (name: string, base: number, steps: HookTrace['steps'] = []): HookTrace => ({
    name,
    base,
    value: steps.length ? (steps[steps.length - 1]!.after as number) : base,
    steps,
  });
  return [
    pipe('combat.damage', 1, parts.seq),
    pipe('combat.damage.parallel', 0, parts.par),
    pipe('fleet.speed', parts.speed?.base ?? 40, parts.speed?.steps),
    pipe('combat.damage', 1, parts.hit),
    pipe('combat.mitigation', 0, parts.pool),
  ];
}

describe('statModifiers — что спросить у ядра', () => {
  it('на стоянке: выстрел приписан узлу, ход — без узла прибытия (правило 6)', () => {
    const q = fleetStatQueries(fleet(), 40);
    expect(q.map((x) => x.name)).toEqual([
      'combat.damage',
      'combat.damage.parallel',
      'fleet.speed',
      'combat.damage',
      'combat.mitigation',
    ]);
    expect(q[0]!.args).toEqual({
      phase: 'orbital',
      location: 'lethe',
      attacker: 'p1',
      defender: null,
      attackerFleet: 'f1',
    });
    expect(q[2]).toEqual({ name: 'fleet.speed', base: 40, args: { fleetId: 'f1', from: 'lethe' } });
    // Под огнём наш флот — защищающийся, стрелок неизвестен.
    expect(q[4]!.args).toEqual({ phase: 'orbital', location: 'lethe', attacker: null, defender: 'p1' });
  });

  it('в пути: узла нет, ход — по текущему переходу', () => {
    const moving = fleet({
      location: null,
      movement: { from: 'a', to: 'b' } as Fleet['movement'],
    });
    const q = fleetStatQueries(moving, 30);
    expect((q[0]!.args as { location: string }).location).toBe('');
    expect(q[2]!.args).toEqual({ fleetId: 'f1', from: 'a', to: 'b' });
  });

  it('в бою в запросы уходит бой — по нему считают выслуга и ветераны', () => {
    const q = fleetStatQueries(fleet({ battleId: 'b7' }), 40);
    for (const query of [q[0], q[1], q[3], q[4]])
      expect((query!.args as { battleId?: string }).battleId).toBe('b7');
  });
});

describe('statModifiers — разбор ответа', () => {
  it('атака и защита: последовательная группа множится, массовая — очками (правило 2)', () => {
    const mods = fleetStatMods(
      traces({
        seq: [{ module: 'hero', before: 1, after: 1.05 }],
        par: [{ module: 'faction', before: 0, after: 0.1 }],
      }),
      40,
    )!;
    expect(mods.fire.factor).toBeCloseTo(1.05 * 1.1);
    expect(mods.fire.tone).toBe('buff');
    expect(mods.fire.sources.map((s) => s.source)).toEqual(['hero', 'faction']);
    expect(mods.fire.sources[0]!.pct).toBeCloseTo(5);
    expect(mods.fire.sources[1]!.pct).toBeCloseTo(10);
  });

  it('дебафы перевесили — красный, хотя бафы есть (правило 5)', () => {
    const mods = fleetStatMods(
      traces({
        seq: [
          { module: 'hero', before: 1, after: 1.05 },
          { module: 'sector', before: 1.05, after: 0.84 },
        ],
      }),
      40,
    )!;
    expect(mods.fire.factor).toBeCloseTo(0.84);
    expect(mods.fire.tone).toBe('debuff');
  });

  it('без надбавок — нейтрально и пустой список', () => {
    const mods = fleetStatMods(traces({}), 40)!;
    expect(mods.fire).toMatchObject({ factor: 1, tone: 'neutral', sources: [] });
    expect(mods.speed).toMatchObject({ value: 40, factor: 1, tone: 'neutral', sources: [] });
    expect(mods.incoming).toMatchObject({ factor: 1, tone: 'neutral', sources: [] });
  });

  it('хромота — строка дебафа от номинального хода (правило 4)', () => {
    const mods = fleetStatMods(
      traces({ speed: { base: 20, steps: [{ module: 'forced-march', before: 20, after: 30 }] } }),
      40,
    )!;
    expect(mods.speed.base).toBe(40);
    expect(mods.speed.value).toBe(30);
    expect(mods.speed.tone).toBe('debuff');
    expect(mods.speed.sources).toEqual([
      { source: LIMP_SOURCE, pct: -50 },
      { source: 'forced-march', pct: 50 },
    ]);
  });

  it('корпус: меньше урона — зелёный, вклад пула показан как одиночный (правило 3)', () => {
    const mods = fleetStatMods(
      traces({ pool: [{ module: 'sector', before: 0, after: 0.15 }] }),
      40,
    )!;
    expect(mods.incoming.factor).toBeCloseTo(1 / 1.15);
    expect(mods.incoming.tone).toBe('buff');
    expect(mods.incoming.sources[0]!.pct).toBeCloseTo((1 / 1.15 - 1) * 100);
  });

  it('корпус: множитель на сторону под огнём тоже в счёт; больше урона — красный', () => {
    const mods = fleetStatMods(
      traces({ hit: [{ module: 'heroEffects', before: 1, after: 1.2 }] }),
      40,
    )!;
    expect(mods.incoming.factor).toBeCloseTo(1.2);
    expect(mods.incoming.tone).toBe('debuff');
  });

  it('дробь от округления не красит число (порог правила 5)', () => {
    const mods = fleetStatMods(
      traces({ seq: [{ module: 'hero', before: 1, after: 1.001 }] }),
      40,
    )!;
    expect(mods.fire.tone).toBe('neutral');
  });

  it('ядро не ответило — нет и разбора, вместо выдуманной окраски', () => {
    expect(fleetStatMods(null, 40)).toBeNull();
    expect(fleetStatMods(traces({}).slice(0, 3), 40)).toBeNull();
  });
});

describe('statModifiers — подписи', () => {
  it('известный модуль — свой ключ, незнакомый — «прочее», а не пропуск', () => {
    expect(statSourceKey('faction')).toBe('stat.src.faction');
    expect(statSourceKey('new-module')).toBe(OTHER_SOURCE_KEY);
    expect(statSourceKey('__proto__')).toBe(OTHER_SOURCE_KEY);
  });

  it('каждая подпись заведена в обеих локалях', () => {
    const missing = STAT_SOURCE_KEYS.filter((k) => !(k in ru) || !(k in en));
    expect(missing).toEqual([]);
  });

  it('проценты: знак, типографский минус, дробь до процента', () => {
    expect(pctText(10)).toBe('+10%');
    expect(pctText(-13.04)).toBe('−13%');
    expect(pctText(0.5)).toBe('+0.5%');
    expect(pctText(0.01)).toBe('0%');
  });
});
