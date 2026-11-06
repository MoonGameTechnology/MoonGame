import { afterEach, describe, expect, it, vi } from 'vitest';
import { t, tData } from '../../localization/runtime';
import type { MatchRow } from './matchBrowser';
import { isMatchDescriptionOpen, matchDescriptionHtml, openMatchDescription } from './matchDescription';
import { fmtJoinWindow } from './matchRow';

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
  it('describes capital capture without score, domination or a score-based deadline', () => {
    const html = matchDescriptionHtml({ ...match, modeId: 'capital_2v2', rules: {
      victory: { ...match.rules.victory, capitalCapture: true, endsAt: 1000 },
    } }, 'Team map');
    expect(html).toContain(t('browser.description.capitals'));
    expect(html).toContain(t('browser.description.no-deadline'));
    expect(html).not.toContain(t('browser.description.score', { n: 2200 }));
    expect(html).not.toContain(t('browser.description.domination', { p: 60 }));
  });
  it('shows pinned base rules and coalition scaling, rather than promising a solo threshold to a team', () => {
    const html = matchDescriptionHtml(match, 'Team map');
    expect(html).toContain(t('browser.description.score', { n: 2200 }));
    expect(html).toContain(t('browser.description.coalition', { p: 70 }));
    expect(html).toContain(t('browser.description.domination', { p: 60 }));
    expect(html).toContain('×4');
    expect(html).toContain(t('browser.description.seats', { s: 3, c: 4 }));
  });

  it('the title is the map name, and no row repeats it (UIX-10.4)', () => {
    const html = matchDescriptionHtml(match, 'Team map');
    expect(html).toContain('<h2 id="match-description-title">Team map</h2>');
    // «Двое на двое» under «2 на 2» only restated the map's format.
    expect(html).not.toContain(tData('team_2v2'));
    expect(html).not.toContain(t('browser.description.mode'));
    // A running match is the normal state: only the day, no «идёт».
    expect(html).toContain(`<dd>${t('browser.day', { n: 2 })}</dd>`);
    // The label already says «entry»: the value names only its state.
    expect(html).toContain(t('browser.description.entry-left', { dur: fmtJoinWindow(2 * 3_600_000) }));
    expect(html).not.toContain(t('browser.join-window', { dur: fmtJoinWindow(2 * 3_600_000) }));
  });

  it('names a mode the map name does not: PvE waves and unknown presets', () => {
    for (const modeId of ['pve_waves', 'king_of_the_hill']) {
      const html = matchDescriptionHtml({ ...match, modeId }, 'Map');
      expect(html).toContain(t('browser.description.mode'));
      expect(html).toContain(tData(modeId));
    }
  });

  it('the mode name is found by id through tData — the id-to-key link holds', () => {
    // The row carries no name, only the id. It works because `dataKey()` turns `pve_waves`
    // into the same `data.pve-waves` as the «PvE Waves» name in data/modes.json.
    expect(tData('pve_waves')).not.toBe('pve_waves');
    expect(tData('standard')).not.toBe('standard');
  });

  it('an ended match says so next to its day', () => {
    const html = matchDescriptionHtml({ ...match, status: 'ended' }, 'Map');
    expect(html).toContain(`${t('browser.day', { n: 2 })} · ${t('browser.finished')}`);
  });

  it('the owner action sits next to Close only when given', () => {
    expect(matchDescriptionHtml(match, 'Map')).not.toContain('data-description-action');
    const html = matchDescriptionHtml(match, 'Map', { label: t('browser.archive'), run: () => {} });
    expect(html).toContain(`data-description-action>${t('browser.archive')}</button>`);
    expect(html).toContain('data-description-close');
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

  it.each(['pvp', 'pve'] as const)('shows the %s deadline as game time independent of browser age or clock scale', (kind) => {
    const endsAt = 2 * 86_400_000 + 7 * 3_600_000 + 45 * 60_000;
    const expected = t('browser.description.timeout', {
      at: t('fmt.stamp', { d: 3, hm: '07:45' }),
    });
    for (const timeScale of [1, 24]) {
      const html = matchDescriptionHtml({
        ...match,
        kind,
        days: 99,
        rules: { timeScale, victory: { ...match.rules.victory, endsAt } },
      }, 'Map');
      expect(html).toContain(t('browser.description.deadline'));
      expect(html).toContain(expected);
    }
  });

  it('does not fabricate a deadline for old servers or malformed timestamps', () => {
    for (const endsAt of [undefined, NaN, Infinity, -1]) {
      const html = matchDescriptionHtml({
        ...match,
        rules: { victory: { endsAt } },
      }, 'Map');
      expect(html).toContain(t('browser.description.unknown'));
      expect(html).not.toContain(t('browser.description.timeout', {
        at: t('fmt.stamp', { d: 101, hm: '00:00' }),
      }));
    }
  });

  it('a closed window or ended match cannot promise admission', () => {
    for (const changed of [{ entryOpen: false }, { status: 'ended' }]) {
      const html = matchDescriptionHtml({ ...match, ...changed }, 'Map');
      expect(html).toContain(`<dd>${t('browser.description.entry-closed')}</dd>`);
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

describe('match description dialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('closes first, then runs the owner action, so the browser may redraw its list', () => {
    const log: string[] = [];
    const clicks = new Map<string, () => void>();
    const dialog = {
      id: '',
      open: false,
      innerHTML: '',
      setAttribute() {},
      querySelector(sel: string) {
        if (!this.innerHTML.includes(sel.slice(1, -1))) return null;
        return { addEventListener: (_: string, fn: () => void) => void clicks.set(sel, fn) };
      },
      addEventListener() {},
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
        log.push('close');
      },
    };
    vi.stubGlobal('document', {
      createElement: () => dialog,
      getElementById: () => dialog,
      body: { appendChild() {} },
    });
    openMatchDescription(match, 'Map', {
      label: t('browser.archive'),
      run: () => void log.push(`run, open: ${isMatchDescriptionOpen()}`),
    });
    expect(isMatchDescriptionOpen()).toBe(true);
    clicks.get('[data-description-action]')!();
    expect(log).toEqual(['close', 'run, open: false']);
  });
});
