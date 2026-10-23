import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  corpLevelNews,
  corpMedalNews,
  newsEventOf,
  parseAnnouncementDraft,
} from './corpNews';
import { parseMedalCatalog } from './medalCatalog';
import {
  MemoryAvaFeedStore,
  MemoryCorpStore,
  PostgresAvaFeedStore,
  PostgresCorpStore,
  migrate,
  type AvaFeedStore,
  type CorpAuditEntry,
  type CorpStore,
} from './store';

// CORP-1 — what the public news feed says about a corporation, and the admin's
// announcements: facts with ids derived from the fact, never a sentence.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function complete(target: string, level: string, at = 5): CorpAuditEntry {
  return { corpId: 'c', at, actor: 'system', action: 'building_complete', target, detail: level };
}

describe('corpLevelNews', () => {
  it('a completed headquarters of level 2 and up is the corporation reaching that level', () => {
    expect(corpLevelNews('c', 'Corp', [complete('headquarters', '2', 7)])).toEqual([
      { id: 'level:c:2', at: 7, kind: 'level', corpId: 'c', corpName: 'Corp', level: 2 },
    ]);
  });

  it('level 1, other buildings, other actions and a broken level are not news', () => {
    const audit: CorpAuditEntry[] = [
      complete('headquarters', '1'),
      complete('supply_center', '2'),
      complete('headquarters', 'two'),
      { corpId: 'c', at: 5, actor: 'head', action: 'building_start', target: 'headquarters', detail: '2' },
    ];
    expect(corpLevelNews('c', 'Corp', audit)).toEqual([]);
  });
});

describe('corpMedalNews', () => {
  const catalog = parseMedalCatalog({
    medals: {
      first: { name: 'n', description: 'd', scope: 'corp', grant: 'manual', condition: { type: 'corp_wins', count: 1 } },
      vet: { name: 'n', description: 'd', scope: 'corp', grant: 'manual', condition: { type: 'corp_matches', count: 2 } },
      mine: { name: 'n', description: 'd', scope: 'account', grant: 'auto', condition: { type: 'corp_matches', count: 1 } },
    },
  });
  const corp = { corpId: 'c', name: 'Corp' };
  const ids = (stats: { matches: number; wins: number }, won: boolean): string[] =>
    corpMedalNews(corp, stats, won, catalog, 9).map((e) => e.medalId ?? '');

  it('announces the corp medals whose condition this settlement reached', () => {
    expect(corpMedalNews(corp, { matches: 1, wins: 1 }, true, catalog, 9)).toEqual([
      { id: 'medal:c:first', at: 9, kind: 'medal', corpId: 'c', corpName: 'Corp', medalId: 'first' },
    ]);
    expect(ids({ matches: 2, wins: 1 }, false)).toEqual(['vet']);
  });

  it('a record already past the condition is not announced again, and a loss reaches no win medal', () => {
    expect(ids({ matches: 3, wins: 2 }, true)).toEqual([]);
    // One win from an earlier battle, this one lost: the win medal was announced back then.
    expect(ids({ matches: 1, wins: 1 }, false)).toEqual([]);
  });

  it('a medal of the account scope is not corporation news', () => {
    expect(ids({ matches: 1, wins: 0 }, false)).not.toContain('mine');
  });
});

describe('newsEventOf', () => {
  it('words nothing: a stored row becomes the same fact on the wire', () => {
    expect(
      newsEventOf({ id: 'f', at: 1, kind: 'founded', corpId: 'c', corpName: 'Corp' }),
    ).toEqual({ id: 'f', at: 1, kind: 'founded', corp: { id: 'c', name: 'Corp' } });
    expect(
      newsEventOf({ id: 'l', at: 2, kind: 'level', corpId: 'c', corpName: 'Corp', level: 3 }),
    ).toEqual({ id: 'l', at: 2, kind: 'level', corp: { id: 'c', name: 'Corp' }, level: 3 });
    expect(
      newsEventOf({ id: 'm', at: 3, kind: 'medal', corpId: 'c', corpName: 'Corp', medalId: 'first' }),
    ).toEqual({ id: 'm', at: 3, kind: 'medal', corp: { id: 'c', name: 'Corp' }, medalId: 'first' });
    const battle = { challengerCorp: 'a', challengerName: 'A', targetCorp: 'b', targetName: 'B' };
    expect(newsEventOf({ id: 's', at: 4, kind: 'matchup', ...battle })).toEqual({
      id: 's',
      at: 4,
      kind: 'matchup',
      challenger: { id: 'a', name: 'A' },
      target: { id: 'b', name: 'B' },
    });
    expect(newsEventOf({ id: 'r', at: 5, kind: 'result', ...battle, winnerCorp: null })).toEqual({
      id: 'r',
      at: 5,
      kind: 'result',
      challenger: { id: 'a', name: 'A' },
      target: { id: 'b', name: 'B' },
      winner: null,
    });
  });

  it('leaves out a row it cannot read rather than guess at it', () => {
    expect(newsEventOf({ id: 'l', at: 2, kind: 'level', corpId: 'c', corpName: 'Corp' })).toBe(null);
    expect(newsEventOf({ id: 'm', at: 3, kind: 'medal', corpId: 'c', corpName: 'Corp' })).toBe(null);
  });
});

describe('parseAnnouncementDraft', () => {
  const NOW = 1_000;
  const draft = { kind: 'tech', title: { ru: 'Техработы', en: 'Maintenance' } };

  it('takes an exact shape: a kind, a Russian title, optional English, body, pin and period', () => {
    expect(parseAnnouncementDraft(draft, NOW)).toEqual({
      kind: 'tech',
      pinned: false,
      until: null,
      title: { ru: 'Техработы', en: 'Maintenance' },
      body: { ru: '', en: '' },
    });
    expect(
      parseAnnouncementDraft(
        {
          kind: 'event',
          pinned: true,
          until: NOW + 1,
          title: { ru: '  Турнир  ' },
          body: { ru: 'Строка 1\nСтрока 2', en: '' },
        },
        NOW,
      ),
    ).toEqual({
      kind: 'event',
      pinned: true,
      until: NOW + 1,
      title: { ru: 'Турнир', en: '' },
      body: { ru: 'Строка 1\nСтрока 2', en: '' },
    });
  });

  it('refuses anything else (fail-secure)', () => {
    const refused: unknown[] = [
      null,
      'text',
      [],
      { ...draft, author: 'boss' }, // unknown key
      { ...draft, kind: 'ad' },
      { ...draft, kind: undefined },
      { ...draft, title: { en: 'Only English' } }, // Russian is the source
      { ...draft, title: { ru: '   ' } },
      { ...draft, title: { ru: 'x'.repeat(121) } },
      { ...draft, title: { ru: 'Two\nlines' } },
      { ...draft, title: { ru: 'Tab\there' } },
      { ...draft, title: { ru: 'ok', de: 'Wartung' } },
      { ...draft, title: { ru: 42 } },
      { ...draft, body: { ru: 'x'.repeat(601) } },
      { ...draft, body: 'plain' },
      { ...draft, pinned: 'yes' },
      { ...draft, until: NOW }, // already over
      { ...draft, until: NOW + 0.5 },
      { ...draft, until: '2026-10-21' },
    ];
    for (const raw of refused) expect(parseAnnouncementDraft(raw, NOW)).toBe(null);
  });
});

// The facts are written by the corp store, in the transaction that makes them true: one
// contract for both adapters. The moments are a year ahead of the clock so these rows top
// the shared Postgres feed whatever earlier runs left in it.
function corpFactsContract(name: string, make: () => { store: CorpStore; feed: AvaFeedStore }): void {
  describe(`corporation facts in the feed — ${name}`, () => {
    it('founding is news once; a headquarters of level 2 is news, level 1 is not', async () => {
      const { store, feed } = make();
      const head = randomUUID();
      const T = Date.now() + 365 * DAY;
      const created = await store.createCorp(head, head, 'Head', T);
      if (!created.ok) throw new Error(created.code);
      const corpId = created.corpId;
      await store.infrastructure(corpId, head, T, { buildingId: 'headquarters', expectedLevel: 0 });
      await store.addInfluence(corpId, 120);
      // Level 1 completes here (free, one hour), level 2 starts (six hours).
      await store.infrastructure(corpId, head, T + HOUR, {
        buildingId: 'headquarters',
        expectedLevel: 1,
      });
      await store.infrastructure(corpId, head, T + 8 * HOUR); // level 2 completed at T + 7h
      await store.infrastructure(corpId, head, T + 9 * HOUR); // nothing new
      const ours = (await feed.recent(50, T + 10 * HOUR)).filter(
        (e) => 'corpId' in e && e.corpId === corpId,
      );
      expect(ours).toEqual([
        { id: `level:${corpId}:2`, at: T + 7 * HOUR, kind: 'level', corpId, corpName: head, level: 2 },
        { id: `founded:${corpId}`, at: T, kind: 'founded', corpId, corpName: head },
      ]);
    });

    it('a refused founding is no news', async () => {
      const { store, feed } = make();
      const head = randomUUID();
      const T = Date.now() + 366 * DAY;
      const created = await store.createCorp(head, head, 'Head', T);
      if (!created.ok) throw new Error(created.code);
      // The head already leads a corporation; the second name is taken by the first.
      expect((await store.createCorp(randomUUID(), head, 'Head', T + 1)).ok).toBe(false);
      expect((await store.createCorp(head.toUpperCase(), randomUUID(), 'Other', T + 2)).ok).toBe(false);
      const founded = (await feed.recent(50, T + 3, ['founded'])).filter(
        (e) => e.at > T - 1 && e.at < T + 3,
      );
      expect(founded.map((e) => e.id)).toEqual([`founded:${created.corpId}`]);
    });
  });
}

corpFactsContract('memory', () => {
  const feed = new MemoryAvaFeedStore();
  return { store: new MemoryCorpStore(feed), feed };
});

describe.skipIf(!process.env.DATABASE_URL)('corporation facts — postgres', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  beforeAll(() => migrate(pool));
  afterAll(() => pool.end());
  corpFactsContract('postgres', () => ({
    store: new PostgresCorpStore(pool),
    feed: new PostgresAvaFeedStore(pool),
  }));
});
