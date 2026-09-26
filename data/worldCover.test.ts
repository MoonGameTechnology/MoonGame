/**
 * ЗАЩИТА ПОСТРОЕК МИРА (решение владельца 2026-09-26): «Крепость на планетах даёт снижение
 * получаемого урона. Как и каждое здание. Максимум 90% — если построены все здания и
 * максимальная крепость; при разрушении здания бонус начинает уменьшаться». Резолюция:
 * форт 15/30/45% по уровню, каждая другая целая постройка +5%, потолок 90%, срезает и штурм,
 * и обстрел с орбиты.
 *
 * Сторожим по шипнутым данным и через настоящий хук урона (`hookedDamage`): число, которое
 * видит игрок, и число, которое срезает бой, — одно.
 */
import { describe, expect, it } from 'vitest';
import {
  constructionModule,
  createInitialState,
  createKernel,
  worldDamageReduction,
  type BuildingInstance,
  type GameState,
} from '../packages/shared-core/src/index';
import type { GameModule } from '../packages/shared-core/src/kernel/module';
import { hookedDamage } from '../packages/shared-core/src/util/combat';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const fort = (level: number): BuildingInstance => ({ type: 'fort', level, hp: 100 });
const plain = (type: string, hp = 10): BuildingInstance => ({ type, level: 1, hp });
/** Девять обычных построек — столько нужно рядом с фортом III до потолка. */
const NINE = ['mine', 'farm', 'refinery', 'tax_office', 'power_plant', 'fabricator', 'hospital', 'barracks', 'radar'];
const cover = (buildings: BuildingInstance[]): number => worldDamageReduction({ buildings }, data);

describe('защита построек мира — форт 15/30/45%, прочие по 5%, потолок 90%', () => {
  it('форт даёт свою долю по уровню, обычная постройка — 5%', () => {
    expect(cover([fort(1)])).toBeCloseTo(0.15);
    expect(cover([fort(2)])).toBeCloseTo(0.3);
    expect(cover([fort(3)])).toBeCloseTo(0.45);
    expect(cover([plain('mine')])).toBeCloseTo(0.05);
    expect(cover(NINE.map((t) => plain(t)))).toBeCloseTo(0.45);
  });

  it('форт III и девять построек — 90%; больше построек потолок не пробивают', () => {
    expect(cover([fort(3), ...NINE.map((t) => plain(t))])).toBeCloseTo(0.9);
    expect(cover([fort(3), ...NINE.map((t) => plain(t)), plain('factory'), plain('shipyard')])).toBeCloseTo(0.9);
  });

  it('снесённая постройка перестаёт прикрывать — доля падает по одной', () => {
    const full = [fort(3), ...NINE.map((t) => plain(t))];
    expect(cover(full.slice(0, -1))).toBeCloseTo(0.85);
    expect(cover([fort(3), plain('mine', 0)])).toBeCloseTo(0.45); // hp 0 — уже не постройка
    expect(cover([])).toBe(0);
  });

  it('бой срезает ровно эту долю — и при штурме, и при обстреле; флаку по флоту — нет', () => {
    const probe: GameModule = {
      id: 'cover-probe',
      version: '1.0.0',
      setup(api) {
        api.onAction('probe.damage', (action, h) => {
          const phase = (action.payload as { phase: string }).phase;
          h.emit('probe.result', {
            dmg: hookedDamage(h, 100, { phase, location: 'A', attacker: 'p2', defender: 'p1' }),
          });
        });
      },
    };
    const kernel = createKernel([constructionModule, probe]);
    const world = (buildings: BuildingInstance[]): GameState => {
      const s = createInitialState({ seed: 'cover', version: { data: data.version, manifest: '1' } });
      return {
        ...s,
        players: {
          p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} },
          p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
        },
        planets: {
          A: {
            id: 'A', owner: 'p1', kind: 'planet', position: { x: 0, y: 0 }, links: [],
            resources: {}, buildings, garrison: [], traits: [],
          },
        },
      };
    };
    const damage = (buildings: BuildingInstance[], phase: string): number => {
      const r = kernel.applyAction(
        world(buildings),
        { id: `p:${phase}`, type: 'probe.damage', playerId: 'p1', payload: { phase }, issuedAt: 0 },
        { now: 0, data },
      );
      if (!r.ok) throw new Error(r.code);
      return (r.events.find((e) => e.type === 'probe.result')!.payload as { dmg: number }).dmg;
    };
    const full = [fort(3), ...NINE.map((t) => plain(t))];
    expect(damage(full, 'ground')).toBeCloseTo(10, 5);
    expect(damage(full, 'bombard')).toBeCloseTo(10, 5);
    expect(damage([fort(1)], 'ground')).toBeCloseTo(85, 5);
    expect(damage(full, 'orbital')).toBe(100); // флак мира бьёт по флоту — его мир не прикрывает
  });
});
