/** CORP-18 — the red «needs your attention» marker of corporation battles: what waits on
 *  the member (`decisions/corpBattles.ts`) and the light poll that keeps the hub button
 *  true while another hub tab is open. */
import { t } from '../../localization/runtime';
import { battleAttention, parseCorpBattles } from '../../decisions/corpBattles';
import type { CorpBattleChallenge } from '../../packages/protocol/src/corpBattles';
import { parseMembership, type CorpMembership } from './corp';

export interface CorpAttention {
  now: number;
  challenges: number;
}

type Rosters = Parameters<typeof battleAttention>[0]['rosters'];

/** What in «Битвы» waits on `me`; nothing for a recruit or without AvA. */
export function corpAttention(
  me: CorpMembership | null,
  challenges: readonly CorpBattleChallenge[],
  rosters: Rosters,
  available: boolean,
): CorpAttention {
  if (!me || me.role === 'recruit' || !available) return { now: 0, challenges: 0 };
  return battleAttention({
    challenges,
    corpId: me.corpId,
    accountId: me.accountId,
    head: me.role === 'head',
    rosters,
    now: Date.now(),
  });
}

export const attentionTotal = (a: CorpAttention): number => a.now + a.challenges;

/** One light read of `/corps/me` and `/ava/battles`; a failed read keeps the last marker. */
export async function pollCorpAttention(
  signedIn: boolean,
  fetchJson: (path: string) => Promise<unknown>,
  alert: (on: boolean) => void,
  rosters: Rosters = {},
): Promise<void> {
  if (!signedIn) return alert(false);
  const mine = (await fetchJson('/corps/me')) as {
    membership?: unknown;
    features?: { ava?: boolean };
  } | null;
  if (!mine) return;
  const me = parseMembership(mine.membership);
  if (!me || me.role === 'recruit' || mine.features?.ava === false) return alert(false);
  const view = parseCorpBattles(await fetchJson('/ava/battles'), me.corpId);
  if (view) alert(attentionTotal(corpAttention(me, view.challenges, rosters, true)) > 0);
}

/** The red dot on the hub's «Корпорация» button. */
export function corpAttentionMarker(on: boolean): void {
  const tab = document.querySelector<HTMLElement>('.hub-tab[data-hub="corp"]');
  tab?.classList.toggle('has-news', on);
  tab?.setAttribute('title', on ? t('corp.combat.attention') : '');
}
