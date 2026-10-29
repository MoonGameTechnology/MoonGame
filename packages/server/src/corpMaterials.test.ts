import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import Fastify from 'fastify';
import type { CorpBuildOrder } from '@void/protocol';
import {
  MemoryArsenalStore,
  MemoryDropStore,
  MemoryCorpStore,
  PostgresCorpStore,
  migrate,
  type CorpStore,
} from './store';
import {
  MemoryMetaEconomyStore,
  PostgresMetaEconomyStore,
  type MetaEconomyStore,
} from './metaEconomyStore';
import { MemoryMetaMarket, PostgresMetaMarket, type MetaMarket } from './metaMarket';
import { loadShippedData, loadDropTables } from './scenario';
import { loadMetaEconomyCatalog } from './metaEconomyCatalog';
import { MetaEconomy } from './metaEconomy';
import { CorpMaterials } from './corpMaterials';
import { registerCorpMaterialsApi } from './corpMaterialsApi';
import { registerCorpApi } from './corpApi';
import { CorpService } from './corpService';
import { CORP_BUILDINGS } from './corpConstruction';

const data = loadShippedData(),
  catalog = loadMetaEconomyCatalog(data);
const database = process.env.DATABASE_URL;
for (const adapter of ['memory', 'postgres'] as const) {
  describe.skipIf(adapter === 'postgres' && !database)(
    `corporation material transactions · ${adapter}`,
    () => {
      let pool: Pool | undefined;
      beforeAll(async () => {
        if (adapter === 'postgres') {
          pool = new Pool({ connectionString: database, max: 6 });
          await migrate(pool);
        }
      });
      afterAll(async () => {
        await pool?.end();
      });
      async function setup() {
        const arsenal = new MemoryArsenalStore(),
          drops = new MemoryDropStore();
        const market: MetaMarket = pool
          ? new PostgresMetaMarket(pool, () => 7_200_000, 500)
          : new MemoryMetaMarket(arsenal, () => 7_200_000, 500);
        const store: MetaEconomyStore = pool
          ? new PostgresMetaEconomyStore(pool)
          : new MemoryMetaEconomyStore(arsenal, drops, market as MemoryMetaMarket);
        (market as MemoryMetaMarket | PostgresMetaMarket).setEconomy(store);
        const corps: CorpStore = pool ? new PostgresCorpStore(pool) : new MemoryCorpStore();
        const head = randomUUID(),
          member = randomUUID(),
          officer = randomUUID(),
          recruit = randomUUID();
        const created = await corps.createCorp(`Materials ${head}`, head, 'Head', 0);
        if (!created.ok) throw Error(created.code);
        const corpId = created.corpId;
        await corps.addMember(corpId, member, 'Member', 'member');
        await corps.addMember(corpId, officer, 'Officer', 'officer');
        await corps.addMember(corpId, recruit, 'Recruit', 'recruit');
        await corps.infrastructure(corpId, head, 0, {
          buildingId: 'headquarters',
          expectedLevel: 0,
        });
        await corps.infrastructure(corpId, head, 7_200_000);
        await corps.addInfluence(corpId, 1000);
        const service = new CorpMaterials({ store, catalog, corps, now: () => 7_200_000 });
        const economy = new MetaEconomy({
          store,
          catalog,
          dropTables: loadDropTables(data),
          now: () => 7_200_000,
        });
        const reward = (accountId = member) =>
          economy.settle({
            matchId: randomUUID(),
            accountId,
            kind: 'final',
            place: 1,
            participation: true,
            occurredAt: 7_200_000,
          });
        const contribute = (id: string, n: number, actor = member, request = randomUUID()) =>
          service.contribute(actor, request, id, n);
        async function fund() {
          await reward();
          await contribute('construction_blocks', 8);
          await contribute('engineering_kits', 3);
        }
        async function order(requestId = randomUUID()): Promise<CorpBuildOrder> {
          const view = await corps.infrastructure(corpId, head, 7_200_000);
          if (!view.ok) throw Error(view.code);
          const b = view.infrastructure.buildings.find((b) => b.id === 'supply_center')!;
          return { requestId, buildingId: b.id, expectedLevel: b.level, price: b.next!.price };
        }
        const stock = () => service.view(member);
        return {
          pool,
          store,
          corps,
          market,
          head,
          member,
          officer,
          recruit,
          corpId,
          service,
          reward,
          contribute,
          fund,
          order,
          stock,
        };
      }
      it('earns battle materials, trades one on auction, contributes and builds once', async () => {
        const s = await setup();
        await s.reward(s.head);
        const lot = await s.market.listMaterials(
          s.head,
          'Head',
          'construction_blocks',
          8,
          20,
          randomUUID(),
        );
        expect(lot.ok).toBe(true);
        if (!lot.ok) throw Error('fixture');
        expect((await s.market.buyMaterial(s.member, lot.listing.id, randomUUID())).ok).toBe(true);
        expect(await s.contribute('construction_blocks', 8)).toEqual({ ok: true });
        await s.reward();
        expect(await s.contribute('engineering_kits', 3)).toEqual({ ok: true });
        const order = await s.order();
        const before = (await s.corps.getCorp(s.corpId))!.influence;
        expect(await s.service.build(s.head, order)).toEqual({ ok: true });
        expect(await s.service.build(s.head, order)).toEqual({ ok: true });
        expect((await s.corps.getCorp(s.corpId))!.influence).toBe(before - 60);
        expect(
          (await s.stock())!.materials
            .filter((m) => m.id !== 'command_cores')
            .every((r) => r.available === 0 && r.reserved === 0),
        ).toBe(true);
        const view = await s.corps.infrastructure(s.corpId, s.head, 7_200_000);
        expect(view).toMatchObject({
          ok: true,
          infrastructure: { construction: { buildingId: 'supply_center', level: 1 } },
        });
        expect(
          (await s.corps.auditOf(s.corpId)).filter(
            (a) => a.action === 'building_start' && a.target === 'supply_center',
          ),
        ).toHaveLength(1);
      });
      it('accepts member/officer/head contributions, denies recruits/outsiders and preserves stock after departure', async () => {
        const s = await setup();
        for (const actor of [s.member, s.officer, s.head]) {
          await s.reward(actor);
          expect(await s.contribute('command_cores', 1, actor)).toEqual({ ok: true });
        }
        for (const actor of [s.recruit, randomUUID()]) {
          expect(await s.service.view(actor)).toBeNull();
          expect(await s.contribute('command_cores', 1, actor)).toEqual({
            ok: false,
            code: 'E_FORBIDDEN',
          });
        }
        await s.corps.swapHead(s.corpId, s.head, s.officer);
        await s.corps.removeMember(s.corpId, s.member);
        expect(
          (await s.service.view(s.officer))!.materials.find((r) => r.id === 'command_cores')!
            .available,
        ).toBe(3);
        expect(
          JSON.stringify((await s.store.read(`corp:${s.corpId}`)).corpMaterials),
        ).not.toContain(s.member);
      });
      it('rejects bad quantities, wrong category, insufficient or bound stock and conflicting replay', async () => {
        const s = await setup();
        await s.reward();
        for (const n of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
          expect((await s.contribute('command_cores', n)).ok).toBe(false);
        for (const id of ['__proto__', 'constructor', 'ferroalloys', 'unknown'])
          expect((await s.contribute(id, 1)).ok).toBe(false);
        await s.store.transaction([s.member], async (tx) => {
          tx.account(s.member)
            .materials.filter((l) => l.materialId === 'command_cores')
            .forEach((l) => {
              l.soulbound = true;
            });
        });
        expect(await s.contribute('command_cores', 1)).toEqual({
          ok: false,
          code: 'E_INSUFFICIENT',
        });
        const request = randomUUID();
        expect(await s.contribute('construction_blocks', 3, s.member, request)).toEqual({
          ok: true,
        });
        expect(await s.contribute('construction_blocks', 3, s.member, request)).toEqual({
          ok: true,
        });
        expect(await s.contribute('construction_blocks', 4, s.member, request)).toEqual({
          ok: false,
          code: 'E_IDEMPOTENCY_CONFLICT',
        });
        expect(
          (await s.stock())!.materials.find((r) => r.id === 'construction_blocks')!.available,
        ).toBe(3);
      });
      it('serializes contribution against auction and competing donations without creating stock', async () => {
        const s = await setup();
        await s.reward();
        const results = await Promise.all([
          s.contribute('construction_blocks', 10),
          s.market.listMaterials(s.member, 'Member', 'construction_blocks', 10, 5, randomUUID()),
          s.contribute('construction_blocks', 10),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        const own = (await s.store.read(s.member)).materials
          .filter((l) => l.materialId === 'construction_blocks')
          .reduce((n, l) => n + l.quantity, 0);
        const bank = (await s.stock())!.materials.find(
          (r) => r.id === 'construction_blocks',
        )!.available;
        const listed = (await s.market.materialListings())
          .filter((l) => l.sellerId === s.member)
          .reduce((n, l) => n + l.quantity, 0);
        expect(own + bank + listed).toBe(15);
      });
      it('denies hidden old-client payment, changed prices, non-heads and insufficient shared funds', async () => {
        const s = await setup();
        const order = await s.order();
        expect(await s.service.build(s.head, { ...order, price: undefined })).toEqual({
          ok: false,
          code: 'E_CORP_PRICE',
        });
        expect(await s.service.build(s.head, { ...order, price: 'a'.repeat(64) })).toEqual({
          ok: false,
          code: 'E_CORP_PRICE',
        });
        expect(await s.service.build(s.head, order)).toEqual({
          ok: false,
          code: 'E_CORP_MATERIALS',
        });
        for (const actor of [s.member, s.officer, s.recruit])
          expect(await s.service.build(actor, order)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
        expect(
          await new CorpService({ store: s.corps }).infrastructure(
            { accountId: s.head, login: 'Head' },
            s.corpId,
            order,
          ),
        ).toEqual({ ok: false, code: 'E_CORP_PRICE' });
        expect((await s.stock())!.pending).toBe(false);
      });
      it('recovers a lost reply after commit across restart and concurrent sweep without double debit', async () => {
        const s = await setup();
        await s.fund();
        const order = await s.order();
        const flaky = new CorpMaterials({
          store: s.store,
          catalog,
          now: () => 7_200_000,
          corps: {
            membershipOf: s.corps.membershipOf.bind(s.corps),
            prepareBuild: s.corps.prepareBuild.bind(s.corps),
            commitBuild: async (id, at) => {
              await s.corps.commitBuild(id, at);
              throw Error('reply lost');
            },
          },
        });
        expect(await flaky.build(s.head, order)).toEqual({
          ok: false,
          code: 'E_CORP_PAYMENT_PENDING',
        });
        const pending = await s.stock();
        expect(pending!.pending).toBe(true);
        expect(pending!.materials.find((r) => r.id === 'construction_blocks')).toMatchObject({
          available: 0,
          reserved: 8,
        });
        const restarted = new CorpMaterials({ store: s.store, catalog, corps: s.corps });
        await Promise.all([
          restarted.sweep(),
          s.service.reconcile(s.corpId),
          s.service.reconcile(s.corpId),
        ]);
        expect((await s.stock())!.pending).toBe(false);
        expect(await s.service.build(s.head, order)).toEqual({ ok: true });
        expect(
          (await s.corps.auditOf(s.corpId)).filter(
            (a) => a.action === 'building_start' && a.target === 'supply_center',
          ),
        ).toHaveLength(1);
      });
      it('retains reservation on unknown status, including missing receipt, and eventually confirms', async () => {
        const s = await setup();
        await s.fund();
        const unknown = new CorpMaterials({
          store: s.store,
          catalog,
          corps: {
            membershipOf: s.corps.membershipOf.bind(s.corps),
            prepareBuild: s.corps.prepareBuild.bind(s.corps),
            commitBuild: async () => ({ state: 'unknown' }),
          },
        });
        expect(await unknown.build(s.head, await s.order())).toEqual({
          ok: false,
          code: 'E_CORP_PAYMENT_PENDING',
        });
        await unknown.sweep();
        expect((await s.stock())!.pending).toBe(true);
        expect(
          (await s.stock())!.materials.find((r) => r.id === 'construction_blocks'),
        ).toMatchObject({ available: 0, reserved: 8 });
        await s.service.reconcile(s.corpId);
        expect((await s.stock())!.pending).toBe(false);
      });
      it('refunds a cached rejection once after head transfer, never later builds from that refunded ticket', async () => {
        const s = await setup();
        await s.fund();
        const order = await s.order();
        const transfer = new CorpMaterials({
          store: s.store,
          catalog,
          corps: {
            membershipOf: s.corps.membershipOf.bind(s.corps),
            prepareBuild: s.corps.prepareBuild.bind(s.corps),
            commitBuild: async (id, at) => {
              await s.corps.swapHead(s.corpId, s.head, s.officer);
              return s.corps.commitBuild(id, at);
            },
          },
        });
        expect(await transfer.build(s.head, order)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
        await s.corps.swapHead(s.corpId, s.officer, s.head);
        expect(await s.service.build(s.head, order)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
        await s.service.reconcile(s.corpId);
        const bank = (await s.stock())!;
        expect(bank.materials.find((r) => r.id === 'construction_blocks')!.available).toBe(8);
        expect(bank.history.filter((r) => r.kind === 'refund')).toHaveLength(1);
        expect(
          (await s.corps.auditOf(s.corpId)).filter(
            (a) => a.action === 'building_start' && a.target === 'supply_center',
          ),
        ).toHaveLength(0);
      });
      it('erasing/rejoining membership cannot authorize an old prepared ticket', async () => {
        const s = await setup();
        const order = await s.order();
        const prepared = await s.corps.prepareBuild(s.corpId, s.head, 7_200_000, order);
        expect(prepared.ok).toBe(true);
        if (!prepared.ok) throw Error('fixture');
        await s.corps.removeMember(s.corpId, s.head);
        await s.corps.addMember(s.corpId, s.head, 'Head', 'head');
        expect(await s.corps.commitBuild(prepared.ticket.id, 7_200_000)).toEqual({
          state: 'rejected',
          code: 'E_FORBIDDEN',
        });
        if (pool) {
          const saved = (
            await pool.query('SELECT head_membership,ticket FROM corp_build_payments WHERE id=$1', [
              prepared.ticket.id,
            ])
          ).rows[0];
          expect(saved.head_membership).toBeNull();
          expect(JSON.stringify(saved.ticket)).not.toContain(s.head);
        }
      });
      it('rejects changed quote at commit, refunds and retains terminal rejection', async () => {
        const s = await setup();
        await s.fund();
        const order = await s.order();
        const level = CORP_BUILDINGS.find((b) => b.id === 'supply_center')!.levels[0]!;
        let ticket = '';
        const changed = new CorpMaterials({
          store: s.store,
          catalog,
          corps: {
            membershipOf: s.corps.membershipOf.bind(s.corps),
            prepareBuild: s.corps.prepareBuild.bind(s.corps),
            commitBuild: async (id, at) => {
              ticket = id;
              level.cost++;
              try {
                return await s.corps.commitBuild(id, at);
              } finally {
                level.cost--;
              }
            },
          },
        });
        expect(await changed.build(s.head, order)).toEqual({ ok: false, code: 'E_CORP_PRICE' });
        expect(await s.corps.commitBuild(ticket, 7_200_000)).toEqual({
          state: 'rejected',
          code: 'E_CORP_PRICE',
        });
        expect(
          (await s.stock())!.materials.find((r) => r.id === 'construction_blocks')!.available,
        ).toBe(8);
      });
      it('competing construction commands spend one tier of material and influence', async () => {
        const s = await setup();
        await s.fund();
        const results = await Promise.all([
          s.service.build(s.head, await s.order()),
          s.service.build(s.head, await s.order()),
        ]);
        expect(results.filter((r) => r.ok)).toHaveLength(1);
        expect(
          (await s.stock())!.materials.find((r) => r.id === 'construction_blocks')!.available,
        ).toBe(0);
      });
      it('disband while payment is reserved refunds once and an old ticket cannot recreate the corporation', async () => {
        const s = await setup();
        await s.fund();
        const order = await s.order();
        let ticket = '';
        const disband = new CorpMaterials({
          store: s.store,
          catalog,
          corps: {
            membershipOf: s.corps.membershipOf.bind(s.corps),
            prepareBuild: s.corps.prepareBuild.bind(s.corps),
            commitBuild: async (id, at) => {
              ticket = id;
              await s.corps.removeCorp(s.corpId);
              return s.corps.commitBuild(id, at);
            },
          },
        });
        expect(await disband.build(s.head, order)).toEqual({ ok: false, code: 'E_FORBIDDEN' });
        expect(await s.corps.commitBuild(ticket, 7_200_000)).toEqual({
          state: 'rejected',
          code: 'E_FORBIDDEN',
        });
        expect((await s.store.read(`corp:${s.corpId}`)).corpMaterials).toMatchObject({
          available: { construction_blocks: 8, engineering_kits: 3 },
        });
        expect(await s.corps.getCorp(s.corpId)).toBeNull();
      });
      it('recovery cursor reaches reservations beyond the first hundred unknown receipts', async () => {
        const s = await setup(),
          ids = Array.from({ length: 101 }, (_, i) => `${randomUUID()}-${i}`);
        const seen = new Set<string>();
        try {
          for (const id of ids)
            await s.store.transaction([`corp:${id}`], async (tx) => {
              tx.account(`corp:${id}`).corpMaterials = {
                available: {},
                history: [],
                pending: {
                  id,
                  corpId: id,
                  order: { buildingId: 'supply_center', expectedLevel: 0 },
                  materials: {},
                },
              };
            });
          const recovery = new CorpMaterials({
            store: s.store,
            catalog,
            corps: {
              membershipOf: s.corps.membershipOf.bind(s.corps),
              prepareBuild: s.corps.prepareBuild.bind(s.corps),
              commitBuild: async (id) => {
                seen.add(id);
                return { state: 'unknown' };
              },
            },
          });
          await recovery.sweep();
          expect(seen.size).toBe(100);
          await recovery.sweep();
          expect(ids.every((id) => seen.has(id))).toBe(true);
        } finally {
          for (const id of ids)
            await s.store.transaction([`corp:${id}`], async (tx) => {
              delete tx.account(`corp:${id}`).corpMaterials;
            });
        }
      });
      it('HTTP session gate and closed envelopes forbid forged corp/identity/payment fields', async () => {
        const s = await setup();
        await s.fund();
        const app = Fastify();
        const identify = async (r: { headers: Record<string, unknown> }) =>
          r.headers.authorization === 'Bearer fixture'
            ? { accountId: s.head, login: 'Head' }
            : null;
        registerCorpMaterialsApi(app, s.service, identify);
        registerCorpApi(app, { service: new CorpService({ store: s.corps }), identify });
        try {
          expect((await app.inject({ url: '/meta-economy/corp-materials' })).statusCode).toBe(401);
          const headers = { authorization: 'Bearer fixture' },
            payload = await s.order();
          for (const extra of [
            { corpId: s.corpId },
            { accountId: s.head },
            { paid: true },
            { materials: {} },
            { ticket: 'forged' },
          ]) {
            expect(
              (
                await app.inject({
                  method: 'POST',
                  url: '/meta-economy/corp-materials/build',
                  headers,
                  payload: { ...payload, ...extra },
                })
              ).statusCode,
            ).toBe(400);
          }
          expect(
            (
              await app.inject({
                method: 'POST',
                url: `/corps/${s.corpId}/build`,
                headers,
                payload: {
                  buildingId: payload.buildingId,
                  expectedLevel: payload.expectedLevel,
                  paid: true,
                },
              })
            ).statusCode,
          ).toBe(400);
          expect(
            (
              await app.inject({
                method: 'POST',
                url: `/corps/${s.corpId}/build`,
                headers,
                payload: { buildingId: payload.buildingId, expectedLevel: payload.expectedLevel },
              })
            ).json(),
          ).toEqual({ error: 'E_CORP_PRICE' });
          expect(
            (
              await app.inject({
                method: 'POST',
                url: '/meta-economy/corp-materials/build',
                headers,
                payload,
              })
            ).statusCode,
          ).toBe(200);
        } finally {
          await app.close();
        }
      });
    },
  );
}

describe.skipIf(!database)(
  'corporation construction across separate databases and signed HTTP',
  () => {
    it('Game holds resources while Corp atomically commits queue and receipt in its own database', async () => {
      const { createCorporationServer } = await import('./corporationServer');
      const { corporateRemote } = await import('./corporateRemote');
      const gameDb = new Pool({ connectionString: database });
      const name = `corp_material_peer_${randomUUID().replaceAll('-', '')}`;
      const peerUrl = new URL(database!);
      peerUrl.pathname = `/${name}`;
      let peerDb: Pool | undefined, app: ReturnType<typeof createCorporationServer> | undefined;
      try {
        await gameDb.query(`CREATE DATABASE "${name}"`);
        peerDb = new Pool({ connectionString: peerUrl.toString() });
        await migrate(peerDb);
        const local = new PostgresCorpStore(peerDb),
          head = randomUUID();
        const created = await local.createCorp(`Remote ${head}`, head, 'Remote');
        if (!created.ok) throw Error('fixture');
        const id = created.corpId;
        await local.infrastructure(id, head, 0, { buildingId: 'headquarters', expectedLevel: 0 });
        await local.infrastructure(id, head, 7_200_000);
        await local.addInfluence(id, 1000);
        const secret = randomUUID() + randomUUID();
        app = createCorporationServer(peerDb, secret);
        const endpoint = { url: await app.listen({ host: '127.0.0.1', port: 0 }), key: secret };
        const remote = corporateRemote<CorpStore>(endpoint, 'corpStore');
        const store = new PostgresMetaEconomyStore(gameDb);
        const service = new CorpMaterials({ store, catalog, corps: remote, now: () => 7_200_000 });
        await store.transaction([head], async (tx) => {
          for (const [materialId, quantity] of [
            ['construction_blocks', 8],
            ['engineering_kits', 3],
          ] as const)
            tx.account(head).materials.push({
              lotId: randomUUID(),
              materialId,
              quantity,
              soulbound: false,
              source: 'match',
              sourceId: 'fixture',
              acquiredAt: 1,
            });
        });
        for (const [materialId, quantity] of [
          ['construction_blocks', 8],
          ['engineering_kits', 3],
        ] as const)
          expect(await service.contribute(head, randomUUID(), materialId, quantity)).toEqual({
            ok: true,
          });
        const view = await local.infrastructure(id, head, 7_200_000);
        if (!view.ok) throw Error('fixture');
        const order = {
          requestId: randomUUID(),
          buildingId: 'supply_center',
          expectedLevel: 0,
          price: view.infrastructure.buildings.find((b) => b.id === 'supply_center')!.next!.price,
        };
        expect(await service.build(head, order)).toEqual({ ok: true });
        expect(await service.build(head, order)).toEqual({ ok: true });
        expect(
          (await peerDb.query('SELECT result FROM corp_build_payments WHERE corp_id=$1', [id]))
            .rows,
        ).toEqual([{ result: { state: 'applied' } }]);
        expect(
          (
            await gameDb.query(
              'SELECT count(*)::int AS n FROM corp_build_payments WHERE corp_id=$1',
              [id],
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (
            await peerDb.query(
              'SELECT count(*)::int AS n FROM meta_economy_accounts WHERE account_id=$1',
              [`corp:${id}`],
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (await service.view(head))!.materials.find((r) => r.id === 'construction_blocks')!
            .available,
        ).toBe(0);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/internal/corpStore/commitBuild',
              payload: { args: ['forged', 1] },
            })
          ).statusCode,
        ).toBe(401);
      } finally {
        await app?.close();
        await peerDb?.end();
        await gameDb.query(`DROP DATABASE IF EXISTS "${name}"`);
        await gameDb.end();
      }
    });
  },
);
