import { beforeEach, describe, expect, it } from 'vitest';
import {
  corpBattleReportHtml,
  corpBattlesViewHtml,
  type CorpBattlesPaint,
} from './corpBattlesView';
import { setLocale, t } from '../../localization/runtime';
import { CORP_BATTLE_TABS } from '../../decisions/corpBattles';
import type { CorpBattleResult } from '../../packages/protocol/src/corpBattles';

beforeEach(() => setLocale('ru'));
const result: CorpBattleResult = {
  matchupId: 'old',
  challengerCorp: 'a',
  targetCorp: 'b',
  winnerCorp: 'a',
  at: 100,
  format: 2,
  side: 'challenger',
  report: {
    reason: 'score',
    provinces: 10,
    sides: { challenger: { score: 100, provinces: 6 }, target: { score: 50, provinces: 4 } },
    seats: [
      {
        side: 'challenger',
        accountId: 'private-account-id',
        login: '<img src=x>',
        bot: false,
        score: 100,
        provinces: 6,
        out: false,
      },
      { side: 'target', login: null, bot: true, score: 50, provinces: 4, out: true },
    ],
  },
};
function paint(over: Partial<CorpBattlesPaint> = {}): CorpBattlesPaint {
  return {
    view: {
      corpId: 'a',
      ready: { corp: true, formats: [2, 3], player: true, players: ['one'] },
      challenges: [],
      results: [result],
      tally: [{ opponent: 'b', format: 2, wins: 1, losses: 0, draws: 0 }],
      names: { b: '<script>rival</script>' },
    },
    available: true,
    corp: { corpId: 'a', name: 'Alpha', influence: 500 },
    me: { corpId: 'a', accountId: 'one', login: 'One', role: 'head' },
    members: [{ corpId: 'a', accountId: 'one', login: 'One', role: 'head' }],
    pool: [{ corpId: 'b', name: 'Beta', influence: 200, members: 3, formats: [3] }],
    rosters: {},
    wars: {},
    tab: 'now',
    format: 0,
    maxFormat: 3,
    draftFormats: [2, 3],
    busy: false,
    now: 10,
    canPlay: true,
    ...over,
  };
}
describe('corporation battle views', () => {
  it('renders all five sections in both languages with escaped server text', () => {
    for (const locale of ['ru', 'en'] as const) {
      setLocale(locale);
      for (const tab of CORP_BATTLE_TABS) {
        const html = corpBattlesViewHtml(paint({ tab }));
        expect(html.match(/role="tab"/g)).toHaveLength(5);
        expect(html).not.toMatch(/corp\.combat\.|<script>|<img src=x>|undefined|NaN/);
      }
    }
  });
  it('shows an error and retry instead of an empty history after a failed read', () => {
    const html = corpBattlesViewHtml(paint({ tab: 'history', view: null }));
    expect(html).toContain(t('corp.combat.unavailable'));
    expect(html).toContain('data-corpact="refresh"');
    expect(html).not.toContain(t('corp.combat.no-history'));
  });
  it('carries the selected common format with a rematch, and explains restricted actions', () => {
    const p = paint({ tab: 'opponents', format: 3 });
    let html = corpBattlesViewHtml(p);
    expect(html).toContain('data-corpformat="3"');
    expect(html).toContain(t('corp.combat.challenge'));
    html = corpBattlesViewHtml({ ...p, me: { ...p.me, role: 'member' } });
    expect(html).not.toContain('data-corpact="ava-challenge"');
    expect(html).toContain(t('corp.combat.head-only'));
  });
  it('does not mistake an unavailable opponent pool for an empty one', () => {
    const html = corpBattlesViewHtml(paint({ tab: 'opponents', pool: null }));
    expect(html).toContain(t('corp.combat.unavailable'));
    expect(html).toContain('data-corpact="refresh"');
    expect(html).not.toContain(t('corp.combat.no-opponents'));
  });
  it('never shows unearned formats as purchasable or lets a member change readiness', () => {
    const p = paint({ tab: 'ready' });
    expect(corpBattlesViewHtml(p)).toMatch(/data-battle-ready-format="4"[^>]+disabled/);
    const member = corpBattlesViewHtml({ ...p, me: { ...p.me, role: 'member' } });
    expect(member).not.toContain('data-corpact="ava-ready-save"');
    expect(member).toContain('data-corpact="ready-player-clear"');
  });
  it('uses server history and offers a report only if it exists', () => {
    const p = paint({ tab: 'history' });
    expect(corpBattlesViewHtml(p)).toContain('data-battle-report="old"');
    p.view!.results = [{ ...result, report: undefined }];
    expect(corpBattlesViewHtml(p)).not.toContain('data-battle-report=');
    expect(corpBattlesViewHtml(p)).toContain(t('corp.combat.no-report'));
  });
  it('reports both sides after settlement without exposing account identifiers', () => {
    const html = corpBattleReportHtml(result, '<script>rival</script>');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('&lt;script&gt;rival&lt;/script&gt;');
    expect(html).toContain(t('corp.combat.bot'));
    expect(html).not.toMatch(/private-account-id|<script>|<img src=x>/);
  });
  it('allows enrollment only during the roster window and preserves the roster limit', () => {
    const p = paint();
    p.view!.challenges = [
      {
        id: 'm',
        challengerCorp: 'a',
        targetCorp: 'b',
        format: 2,
        cost: 100,
        status: 'accepted',
        createdAt: 0,
        expiresAt: 100,
        pauseEndsAt: 50,
      },
    ];
    p.rosters = {
      m: {
        matchupId: 'm',
        side: 'challenger',
        status: 'accepted',
        pauseEndsAt: 50,
        counts: { challenger: 0, target: 1 },
        mine: [],
      },
    };
    expect(corpBattlesViewHtml(p)).toContain('data-corpact="ava-join"');
    expect(corpBattlesViewHtml({ ...p, now: 51 })).not.toContain('data-corpact="ava-join"');
    expect(corpBattlesViewHtml({ ...p, now: 51 })).not.toContain(
      'data-corpact="ava-roster-toggle"',
    );
  });
});
