/**
 * КРЕПОСТЬ ДОСТИЖИМА НА ХОСТЕ, ГДЕ ИГРАЮТ (FORT-0.2) — приёмка кирпича.
 *
 * Смысл кирпича был не в новой механике, а в том, что СТАРАЯ не могла сработать ни разу:
 * `stationModule` лежал в ядре, был в серверном `DEV_MODULES` и покрыт семью тестами — а в
 * `MODULES` прототипа, то есть на хосте, где реально играют, его не было. Действие
 * `station.deploy` просто не существовало, и никакой тест ядра этого не видел.
 *
 * Поэтому тест здесь НЕ про правило (оно проверено в `station.test.ts` и в
 * `decisions/fortressRaise.test.ts`), а про ПРОВОДКУ: прогоняет действие через ядро
 * ПРОТОТИПА и требует, чтобы узел действительно стал крепостью. Уберите модуль из
 * `MODULES` — тест краснеет, а больше ни один.
 */
import { describe, expect, it } from 'vitest';
import { kernel, MODULES } from './protoKernel';
import { deployStation } from '../../decisions/actions';
import { data } from './gameData';
import { createInitialState, type GameState, type Planet } from '../../packages/shared-core/src/index';

function world(kind: string, owner: string | null, metal = 500): GameState {
  const base = createInitialState({ seed: 'fort', version: { data: '0.1.0', manifest: '1' } });
  const node: Planet = {
    id: 'N', owner, position: { x: 0, y: 0 }, kind,
    resources: {}, buildings: [], garrison: [], traits: [],
  };
  return {
    ...base,
    players: {
      p1: {
        id: 'p1', name: 'p1', faction: 'ember', status: 'active', resources: { metal },
        // FORT-5.1: крепость теперь за технологией (решение владельца 12). Тест ПРО
        // ПРОВОДКУ, а не про дерево — сам гейт проверяет `data/fortressTech.test.ts`, —
        // поэтому ветка считается пройденной, и в фокусе остаётся то, ради чего кирпич:
        // доходит ли действие до ядра прототипа вообще.
        technologies: { completed: ['orbital_defense_grid', 'void_fortification'] },
      },
    },
    planets: { N: node },
  };
}

describe('FORT-0.2 — космическая крепость на ядре ПРОТОТИПА', () => {
  it('модуль станции есть в MODULES прототипа', () => {
    expect(MODULES.map((m) => m.id)).toContain('station');
  });

  it('своя туманность становится крепостью — ровно то, ради чего кирпич', () => {
    // Туманность `buildable: false`: до крепости на ней нельзя было возвести ничего.
    const r = kernel.applyAction(world('nebula', 'p1'), deployStation('p1', 'N'), { now: 0, data });
    expect(r.ok, r.ok ? '' : `отказ ${r.code}`).toBe(true);
    if (!r.ok) return;
    expect(r.state.planets.N?.kind).toBe('void_station');
    expect(r.state.players.p1?.resources.metal).toBe(500 - 120);
  });

  it('на планете крепость не ставится — решение владельца держится и здесь', () => {
    const r = kernel.applyAction(world('planet', 'p1'), deployStation('p1', 'N'), { now: 0, data });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_NOT_STATIONABLE');
  });

  it('на чужой территории — отказ', () => {
    const r = kernel.applyAction(world('nebula', 'p2'), deployStation('p1', 'N'), { now: 0, data });
    expect(r.ok).toBe(false);
  });

  it('на построенной крепости МОЖНО строить — в этом и была цель', () => {
    // Проверяем не флаг, а ростер шипнутых данных: крепость обязана что-то принимать,
    // иначе механика превращает местность в такую же бесполезную местность.
    const roster = data.sectorKinds.void_station?.allowedBuildings ?? [];
    expect(roster.length).toBeGreaterThan(0);
    expect(data.sectorKinds.void_station?.buildable).toBe(true);
  });
});
