import { describe, expect, it } from 'vitest';
import { grantStarterArsenal, validateStarterArsenal } from './arsenal';
import { loadDropTables, loadShippedData, loadStarterArsenal } from './scenario';
import { MemoryArsenalStore } from './store';

// ARS-2 — the starter arsenal: a fresh account is never empty, the grant is
// idempotent end to end, and the shipped set validates against the real catalogs.

const data = loadShippedData();

describe('starter arsenal (ARS-2)', () => {
  it('the SHIPPED starter set loads and validates against the shipped catalogs', () => {
    const templates = loadStarterArsenal(data);
    expect(templates.length).toBeGreaterThan(0);
    expect(validateStarterArsenal(templates, data)).toEqual([]);
    // hulls AND modules — the first Верфь visit has something in both columns
    expect(new Set(templates.map((t) => t.kind))).toEqual(new Set(['hull', 'module']));
  });

  it('a template naming content that does not ship refuses to load (fail-secure)', () => {
    expect(validateStarterArsenal([{ kind: 'hull', defId: 'ghost_ship' }], data)).toEqual([
      'E_UNKNOWN_DEF:hull:ghost_ship',
    ]);
  });

  it('grants the full set as SOULBOUND blueprints, idempotently', async () => {
    const store = new MemoryArsenalStore();
    const templates = loadStarterArsenal(data);
    await grantStarterArsenal(store, 'acc-1', templates, 42);
    await grantStarterArsenal(store, 'acc-1', templates, 999); // replayed registration
    const items = await store.listOf('acc-1');
    expect(items).toHaveLength(templates.length); // exactly once
    for (const item of items) {
      expect(item).toMatchObject({ form: 'blueprint', soulbound: true, origin: 'starter' });
      expect(item.acquiredAt).toBe(42); // the first grant won — the replay changed nothing
    }
    // registration farming mints nothing tradable: soulbound never transfers
    const first = items[0]!;
    expect(await store.transfer(first.itemId, 'acc-1', 'acc-2')).toEqual({
      ok: false,
      code: 'E_SOULBOUND',
    });
  });

  it('two accounts get independent sets (deterministic per-account item ids)', async () => {
    const store = new MemoryArsenalStore();
    const templates = loadStarterArsenal(data);
    await grantStarterArsenal(store, 'acc-a', templates, 1);
    await grantStarterArsenal(store, 'acc-b', templates, 1);
    expect(await store.listOf('acc-a')).toHaveLength(templates.length);
    expect(await store.listOf('acc-b')).toHaveLength(templates.length);
  });
});

/**
 * ДОСТИЖИМОСТЬ СОДЕРЖИМОГО (2026-09-14, найдено из живой жалобы про челноки).
 *
 * Гейт владения (`unit.build` → `E_NOT_OWNED`) кусает место, у которого есть снапшот
 * арсенала — сегодня это человеческое кресло AvA. Для такого кресла список «что можно
 * построить» = стартовый набор ∪ то, что выпало дропом. Корпус, которого нет НИ ТАМ, НИ
 * ТАМ, не построит никто и никогда: это не редкий контент, а мёртвый.
 *
 * Так и пропала ВСЯ механика челноков — `shuttle_carrier` не выдавался нигде, а из трёх
 * челноков в пуле дропа лежал один. Игрок мог построить космопорт с шестью местами под
 * челноки и не мог положить туда ничего.
 *
 * Сторож считает по ДАННЫМ и держит два разных факта:
 *  1. корабли обязаны быть достижимы — ни одного корпуса вне обоих источников;
 *  2. известные недостижимые корпуса перечислены ПОИМЁННО, чтобы список не мог вырасти
 *     молча.
 *
 * НАЗЕМКИ В ЭТОМ СПОРЕ БОЛЬШЕ НЕТ (решение владельца 2026-09-15). Гейт сузился до
 * КОРАБЛЕЙ — таков и был замысел арсенала (`docs/arsenal-roadmap.md`: «корпуса КОРАБЛЕЙ,
 * модули, фитинги героев»), — поэтому пехоту и технику снапшот не ограничивает вовсе, и
 * спрашивать с них достижимость незачем: их гейтят ЗДАНИЯ. Список сузился до `hero`, и
 * границу теперь проводит ДОМЕН юнита, а не перечисление руками: новый наземный род
 * войск попадёт под правило сам.
 */
describe('достижимость содержимого на гейтированном месте', () => {
  const reachable = (): Set<string> => {
    const starter = loadStarterArsenal(data)
      .filter((t) => t.kind === 'hull')
      .map((t) => t.defId);
    const dropped = loadDropTables(data)
      .pool.filter((e) => e.kind === 'hull')
      .map((e) => e.defId);
    return new Set([...starter, ...dropped]);
  };

  /** Кого вообще спрашивает гейт владения: корабли. Наземка идёт мимо него (см. шапку). */
  const gated = (): string[] =>
    Object.entries(data.units)
      .filter(([, u]) => u.domain !== 'ground' && u.faction !== 'swarm') // NPC organisms are never human loot.
      .map(([id]) => id);

  /** `hero` — корабль флагмана: он не строится ни на одной верфи, его СЕЕТ `hero.spawn`,
   *  поэтому в источники владения он не входит и входить не должен. */
  const KNOWN_UNREACHABLE = ['hero'];

  it('каждый КОРАБЛЬ можно получить — иначе он мёртвый контент', () => {
    const have = reachable();
    const dead = gated()
      .filter((id) => !KNOWN_UNREACHABLE.includes(id))
      .filter((id) => !have.has(id));
    expect(dead.sort()).toEqual([]);
  });

  it('наземку гейт владения не спрашивает — её не за что держать в списке', () => {
    const ground = Object.entries(data.units)
      .filter(([, u]) => u.domain === 'ground')
      .map(([id]) => id);
    expect(ground.length).toBeGreaterThan(0);
    expect(ground.filter((id) => KNOWN_UNREACHABLE.includes(id))).toEqual([]);
  });

  it('вся механика челноков достижима — и машины, и носитель', () => {
    const have = reachable();
    const shuttles = Object.entries(data.units)
      .filter(([, u]) => (u.traits ?? []).includes('shuttle'))
      .map(([id]) => id);
    expect(shuttles.length).toBeGreaterThan(0);
    expect(shuttles.filter((id) => !have.has(id))).toEqual([]);
    // Носителя мало «где-то иметь»: без него ангар существует только у порта.
    const carriers = Object.entries(data.units)
      .filter(([, u]) => (u.stats.shuttleBay ?? 0) > 0)
      .map(([id]) => id);
    expect(carriers.length).toBeGreaterThan(0);
    expect(carriers.filter((id) => !have.has(id))).toEqual([]);
  });

  // YARD-1 уточнил ПРИЧИНУ, но не правило: космопорта на старте больше нет, игрок его
  // строит. Чертёж челнока в наборе нужен ровно затем, чтобы построенный порт было чем
  // наполнить — иначе игрок платит за здание, в которое нечего положить.
  it('хотя бы один челнок есть С ПЕРВОЙ СЕКУНДЫ — иначе построенный порт нечем наполнить', () => {
    const starter = new Set(
      loadStarterArsenal(data)
        .filter((t) => t.kind === 'hull')
        .map((t) => t.defId),
    );
    const day1 = [...starter].filter((id) => (data.units[id]?.traits ?? []).includes('shuttle'));
    expect(day1.length).toBeGreaterThan(0);
  });

  it('список известных недостижимых не растёт молча', () => {
    const have = reachable();
    expect(KNOWN_UNREACHABLE.filter((id) => !(id in data.units))).toEqual([]);
    expect(KNOWN_UNREACHABLE.filter((id) => have.has(id))).toEqual([]);
  });
});
