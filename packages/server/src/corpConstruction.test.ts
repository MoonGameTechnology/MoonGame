import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { CorpInfrastructureResult, CorpInfrastructureView } from '@void/protocol';
import {
  MemoryAvaResultStore,
  MemoryCorpStore,
  PostgresAvaResultStore,
  PostgresCorpStore,
  migrate,
  type AvaResultStore,
  type CorpStore,
} from './store';
import { CORP_BUILDINGS, parseCorpBuildings } from './corpConstruction';

const HOUR = 3_600_000;
function view(result: CorpInfrastructureResult): CorpInfrastructureView {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.infrastructure;
}

/** `results` — where the corporation's played battles are recorded (CORP-6). */
function contract(make: () => { store: CorpStore; results: AvaResultStore }): void {
  async function setup(): Promise<{
    store: CorpStore;
    results: AvaResultStore;
    corpId: string;
    head: string;
  }> {
    const { store, results } = make();
    const head = randomUUID();
    const created = await store.createCorp(head, head, 'Head');
    if (!created.ok) throw new Error(created.code);
    return { store, results, corpId: created.corpId, head };
  }

  it('starts free headquarters, completes offline, then credits only the elapsed completed period', async () => {
    const { store, corpId, head } = await setup();
    const initial = view(await store.infrastructure(corpId, head, 0));
    expect(initial.buildings[0]?.blocked).toBe(null);
    expect(initial.buildings[1]?.blocked).toBe('E_CORP_BUILD_REQUIRES');
    expect(initial.influencePerDay).toBe(0);
    const started = view(
      await store.infrastructure(corpId, head, 0, { buildingId: 'headquarters', expectedLevel: 0 }),
    );
    expect(started.construction).toMatchObject({ level: 1, cost: 0, completesAt: HOUR });
    expect(view(await store.infrastructure(corpId, head, HOUR - 1)).buildings[0]?.level).toBe(0);
    const completed = view(await store.infrastructure(corpId, head, 25 * HOUR));
    expect(completed.construction).toBe(null);
    expect(completed.buildings[0]?.level).toBe(1);
    expect(completed.influence).toBe(24);
    expect(view(await store.infrastructure(corpId, head, 25 * HOUR)).influence).toBe(24);
    expect(view(await store.infrastructure(corpId, head, 24 * HOUR)).influence).toBe(24);
    const audit = await store.auditOf(corpId);
    expect(audit.filter((e) => e.action === 'building_complete')).toHaveLength(1);
  });

  it('retains fractional income across frequent reads', async () => {
    const { store, corpId, head } = await setup();
    await store.infrastructure(corpId, head, 0, { buildingId: 'headquarters', expectedLevel: 0 });
    for (let at = HOUR; at <= HOUR * 2; at += HOUR / 4)
      await store.infrastructure(corpId, head, at);
    expect((await store.getCorp(corpId))?.influence).toBe(1);
  });

  it('authorizes private reads and head-only spending inside the store', async () => {
    const { store, corpId, head } = await setup();
    for (const role of ['officer', 'member', 'recruit'] as const) {
      const actor = randomUUID();
      await store.addMember(corpId, actor, role, role);
      expect((await store.infrastructure(corpId, actor, 0)).ok).toBe(role !== 'recruit');
      expect(
        await store.infrastructure(corpId, actor, 0, {
          buildingId: 'headquarters',
          expectedLevel: 0,
        }),
      ).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    }
    expect(await store.infrastructure(corpId, 'outsider', 0)).toEqual({
      ok: false,
      code: 'E_FORBIDDEN',
    });
    await store.setRole(corpId, head, 'officer');
    expect(
      await store.infrastructure(corpId, head, 0, { buildingId: 'headquarters', expectedLevel: 0 }),
    ).toEqual({ ok: false, code: 'E_FORBIDDEN' });
    expect((await store.getCorp(corpId))?.influence).toBe(0);
  });

  it('rejects unknown ids, prerequisites, insufficient funds and stale levels without charging', async () => {
    const { store, corpId, head } = await setup();
    for (const buildingId of ['constructor', '__proto__', 'unknown']) {
      expect(await store.infrastructure(corpId, head, 0, { buildingId, expectedLevel: 0 })).toEqual(
        { ok: false, code: 'E_CORP_BUILDING' },
      );
    }
    expect(
      await store.infrastructure(corpId, head, 0, {
        buildingId: 'supply_center',
        expectedLevel: 0,
      }),
    ).toEqual({ ok: false, code: 'E_CORP_BUILD_REQUIRES' });
    await store.infrastructure(corpId, head, 0, { buildingId: 'headquarters', expectedLevel: 0 });
    expect(
      await store.infrastructure(corpId, head, HOUR, {
        buildingId: 'headquarters',
        expectedLevel: 0,
      }),
    ).toEqual({ ok: false, code: 'E_CORP_BUILD_LEVEL' });
    expect(
      await store.infrastructure(corpId, head, HOUR, {
        buildingId: 'supply_center',
        expectedLevel: 0,
      }),
    ).toEqual({ ok: false, code: 'E_INSUFFICIENT' });
    expect((await store.getCorp(corpId))?.influence).toBe(0);
  });

  it('serializes duplicate/concurrent orders: one queue, one debit and one audit', async () => {
    const { store, corpId, head } = await setup();
    await store.infrastructure(corpId, head, 0, { buildingId: 'headquarters', expectedLevel: 0 });
    await store.addInfluence(corpId, 100);
    const results = await Promise.all([
      store.infrastructure(corpId, head, HOUR, { buildingId: 'supply_center', expectedLevel: 0 }),
      store.infrastructure(corpId, head, HOUR, { buildingId: 'supply_center', expectedLevel: 0 }),
      store.infrastructure(corpId, head, HOUR, {
        buildingId: 'engineering_complex',
        expectedLevel: 0,
      }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await store.getCorp(corpId))?.influence).toBe(40);
    expect(
      (await store.auditOf(corpId)).filter(
        (e) => e.action === 'building_start' && e.target === 'supply_center',
      ),
    ).toHaveLength(1);
  });

  it('serializes construction spending with ordinary AvA influence spending', async () => {
    const { store, corpId, head } = await setup();
    await store.infrastructure(corpId, head, 0, { buildingId: 'headquarters', expectedLevel: 0 });
    await store.addInfluence(corpId, 100);
    const results = await Promise.all([
      store.infrastructure(corpId, head, HOUR, { buildingId: 'supply_center', expectedLevel: 0 }),
      store.spendInfluence(corpId, 100),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await store.getCorp(corpId))?.influence).toBeGreaterThanOrEqual(0);
  });

  it('applies completed engineering effects to later orders and enforces max levels', async () => {
    const { store, corpId, head } = await setup();
    await store.addInfluence(corpId, 2000);
    let now = 0;
    for (let level = 0; level < 3; level += 1) {
      const started = view(
        await store.infrastructure(corpId, head, now, {
          buildingId: 'headquarters',
          expectedLevel: level,
        }),
      );
      now = started.construction!.completesAt;
    }
    expect(
      await store.infrastructure(corpId, head, now, {
        buildingId: 'headquarters',
        expectedLevel: 3,
      }),
    ).toEqual({ ok: false, code: 'E_CORP_BUILD_MEMBERS' });
    const engineering = view(
      await store.infrastructure(corpId, head, now, {
        buildingId: 'engineering_complex',
        expectedLevel: 0,
      }),
    );
    expect(engineering.constructionReduction).toBe(0);
    const supply = view(
      await store.infrastructure(corpId, head, engineering.construction!.completesAt, {
        buildingId: 'supply_center',
        expectedLevel: 0,
      }),
    );
    expect(supply.constructionReduction).toBe(10);
    expect(supply.construction!.completesAt - supply.construction!.startedAt).toBe(3 * HOUR * 0.9);
  });

  it('orders headquarters 4 and 5 only with enough members and played battles (CORP-6)', async () => {
    const { store, results, corpId, head } = await setup();
    await store.addInfluence(corpId, 5000);
    let now = 0;
    const hq = async (level: number): Promise<CorpInfrastructureResult> =>
      store.infrastructure(corpId, head, now, { buildingId: 'headquarters', expectedLevel: level });
    for (let level = 0; level < 3; level += 1)
      now = view(await hq(level)).construction!.completesAt;
    const join = async (n: number, role: 'member' | 'recruit' = 'member'): Promise<void> => {
      for (let i = 0; i < n; i += 1) await store.addMember(corpId, randomUUID(), `m${i}`, role);
    };
    const play = async (n: number): Promise<void> => {
      for (let i = 0; i < n; i += 1) {
        const other = randomUUID();
        // Either side counts, a draw too.
        await results.record({
          matchupId: randomUUID(),
          challengerCorp: i % 2 ? corpId : other,
          targetCorp: i % 2 ? other : corpId,
          winnerCorp: i % 3 ? other : null,
          at: now,
        });
      }
    };
    expect(await hq(3)).toEqual({ ok: false, code: 'E_CORP_BUILD_MEMBERS' });
    // Recruits are applications, not members.
    await join(13);
    await join(5, 'recruit');
    expect(view(await store.infrastructure(corpId, head, now))).toMatchObject({
      members: 14,
      battles: 0,
    });
    expect(await hq(3)).toEqual({ ok: false, code: 'E_CORP_BUILD_MEMBERS' });
    await join(1);
    expect(await hq(3)).toEqual({ ok: false, code: 'E_CORP_BUILD_BATTLES' });
    // Another corporation's battle does not count.
    await results.record({
      matchupId: randomUUID(),
      challengerCorp: randomUUID(),
      targetCorp: randomUUID(),
      winnerCorp: null,
      at: now,
    });
    await play(9);
    expect(await hq(3)).toEqual({ ok: false, code: 'E_CORP_BUILD_BATTLES' });
    await play(1);
    const fourth = view(await hq(3));
    expect(fourth).toMatchObject({ members: 15, battles: 10 });
    expect(fourth.construction).toMatchObject({ level: 4, cost: 800 });
    expect(fourth.construction!.completesAt - fourth.construction!.startedAt).toBe(24 * HOUR);
    now = fourth.construction!.completesAt;

    expect(await hq(4)).toEqual({ ok: false, code: 'E_CORP_BUILD_MEMBERS' });
    await join(5);
    expect(await hq(4)).toEqual({ ok: false, code: 'E_CORP_BUILD_BATTLES' });
    await play(15);
    const fifth = view(await hq(4));
    expect(fifth.construction).toMatchObject({ level: 5, cost: 1500 });
    expect(fifth.construction!.completesAt - fifth.construction!.startedAt).toBe(48 * HOUR);
    now = fifth.construction!.completesAt;
    const top = view(await store.infrastructure(corpId, head, now));
    expect(top.buildings[0]).toMatchObject({ level: 5, next: null, blocked: 'E_CORP_BUILD_MAX' });
    expect(top.influencePerDay).toBe(120);
    expect(await hq(5)).toEqual({ ok: false, code: 'E_CORP_BUILD_MAX' });
  });

  it('deletes infrastructure on disband while retaining its audit', async () => {
    const { store, corpId, head } = await setup();
    await store.infrastructure(corpId, head, 0, { buildingId: 'headquarters', expectedLevel: 0 });
    await store.removeCorp(corpId);
    expect(await store.infrastructure(corpId, head, HOUR)).toEqual({
      ok: false,
      code: 'E_FORBIDDEN',
    });
    expect(await store.auditOf(corpId)).toHaveLength(1);
  });
}

describe('corporation infrastructure — memory', () =>
  contract(() => {
    const results = new MemoryAvaResultStore();
    return { store: new MemoryCorpStore(undefined, results), results };
  }));
describe.skipIf(!process.env.DATABASE_URL)('corporation infrastructure — postgres', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  beforeAll(() => migrate(pool));
  afterAll(() => pool.end());
  contract(() => ({
    store: new PostgresCorpStore(pool),
    results: new PostgresAvaResultStore(pool),
  }));
  it('survives a fresh store instance', async () => {
    const store = new PostgresCorpStore(pool);
    const head = randomUUID();
    const made = await store.createCorp(head, head, 'Head');
    if (!made.ok) throw new Error(made.code);
    await store.infrastructure(made.corpId, head, 0, {
      buildingId: 'headquarters',
      expectedLevel: 0,
    });
    const restored = view(
      await new PostgresCorpStore(pool).infrastructure(made.corpId, head, 2 * HOUR),
    );
    expect(restored.buildings[0]?.level).toBe(1);
    expect(restored.influence).toBe(1);
  });
});

it('validates the meta catalog before it reaches either adapter', () => {
  expect(CORP_BUILDINGS).toHaveLength(7);
  for (const value of [null, {}, { buildings: [] }, { buildings: [null] }]) {
    expect(() => parseCorpBuildings(value)).toThrow('E_CORP_CATALOG');
  }
  const broken = structuredClone(CORP_BUILDINGS);
  broken[0]!.levels[0]!.cost = -1;
  expect(() => parseCorpBuildings({ buildings: broken })).toThrow('E_CORP_CATALOG');
  for (const field of ['members', 'battles'] as const) {
    const bad = structuredClone(CORP_BUILDINGS);
    bad[0]!.levels[3]![field] = 1.5;
    expect(() => parseCorpBuildings({ buildings: bad })).toThrow('E_CORP_CATALOG');
  }
  // CORP-7: a level opens a battle of at least two a side.
  for (const maxFormat of [1, 4.5]) {
    const bad = structuredClone(CORP_BUILDINGS);
    bad.find((b) => b.id === 'operations_center')!.levels[0]!.maxFormat = maxFormat;
    expect(() => parseCorpBuildings({ buildings: bad })).toThrow('E_CORP_CATALOG');
  }
});
