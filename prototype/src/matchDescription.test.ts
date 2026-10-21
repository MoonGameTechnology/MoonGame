import { describe, expect, it } from 'vitest';
import { t } from '../../localization/runtime';
import type { MatchRow } from './matchBrowser';
import { matchDescriptionHtml } from './matchDescription';

const match: MatchRow = {
  matchId: 'match-123',
  mapId: 'team-2v2',
  modeId: 'team_2v2',
  kind: 'pvp',
  rules: {
    timeScale: 4,
    victory: { scoreLimit: 2200, dominationPercent: 0.6, coalitionFactor: 0.7 },
  },
  days: 2,
  players: { seated: 3, capacity: 4 },
  status: 'ongoing',
  entryOpen: true,
  entryClosesInMs: 2 * 3_600_000,
};

describe('match description', () => {
  it('shows pinned base rules and coalition scaling, rather than promising a solo threshold to a team', () => {
    const html = matchDescriptionHtml(match, 'Team map');
    expect(html).toContain(t('browser.description.score', { n: 2200 }));
    expect(html).toContain(t('browser.description.coalition', { p: 70 }));
    expect(html).toContain(t('browser.description.domination', { p: 60 }));
    expect(html).toContain('×4');
    expect(html).toContain(t('browser.players', { s: 3, c: 4 }));
  });

  it('does not invent victory conditions or an entry window for older servers', () => {
    const html = matchDescriptionHtml(
      {
        ...match,
        rules: {},
        kind: undefined,
        modeId: undefined,
        entryOpen: undefined,
        entryClosesInMs: undefined,
      },
      'Old map',
    );
    expect(html).toContain(t('browser.description.unknown'));
    expect(html).not.toContain(t('browser.description.score', { n: 600 }));
    expect(html).not.toContain(t('browser.description.entry-open'));
  });

  it('shows PvE objectives without the unrelated PvP score and domination races', () => {
    const html = matchDescriptionHtml({ ...match, kind: 'pve', modeId: 'pve_waves' }, 'PvE');
    expect(html).toContain(t('browser.description.pve'));
    expect(html).not.toContain(t('browser.description.score', { n: 2200 }));
    expect(html).not.toContain(t('browser.description.domination', { p: 60 }));
  });

  it('a closed window or ended match cannot promise admission', () => {
    for (const changed of [{ entryOpen: false }, { status: 'ended' }]) {
      const html = matchDescriptionHtml({ ...match, ...changed }, 'Map');
      expect(html).toContain(t('acc.join-closed'));
      expect(html).not.toContain(t('browser.description.entry-open'));
    }
  });

  it('escapes untrusted map names, mode ids and match numbers', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const html = matchDescriptionHtml({ ...match, modeId: payload, matchId: payload }, payload);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
