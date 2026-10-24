/** Medal rewards: on hub entry the account claims what its profile medals pay (Sovereigns,
 * Warrants and XP for every reached degree, once each) and a window lists the grant. The
 * server reads the progress itself; rules for the answer are in `decisions/medalRewards.ts`. */
import { medalRewardTotals, parseMedalRewards } from '../../decisions/medalRewards';
import type { MedalRewardGrant } from '../../packages/protocol/src/playerProfile';
import { t } from '../../localization/runtime';
import { detach } from './detach';
import { esc } from './format';
import { gradeRoman, medalEmblem } from './profileStudio';

interface MedalRewardsHost {
  identity(): string;
  visible(): boolean;
  authorizedBase(): Promise<{ base: string; token: string } | null>;
  /** Re-read the account's XP and wallets after a grant. */
  changed(): Promise<void>;
}

/** «+10 ◆ · +20 ⌖ · +50 опыта»; a zero part is left out. */
function payLine(pay: { sovereigns: number; warrants: number; xp: number }): string {
  return [
    pay.sovereigns > 0 ? t('profile.medal-rewards.sovereigns', { n: pay.sovereigns }) : '',
    pay.warrants > 0 ? t('profile.medal-rewards.warrants', { n: pay.warrants }) : '',
    pay.xp > 0 ? t('profile.medal-rewards.xp', { n: pay.xp }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function medalRewardsHtml(grants: readonly MedalRewardGrant[]): string {
  const rows = grants
    .map(
      (g) =>
        `<li>${medalEmblem(g.medalId, g.grade)}<span><b>${esc(t(`profile.medal.${g.medalId}`))}</b><small>${esc(t('profile.grade', { grade: gradeRoman(g.grade) }))}</small></span><em>${esc(payLine(g))}</em></li>`,
    )
    .join('');
  const total =
    grants.length > 1
      ? `<p class="rw-xp">${esc(t('profile.medal-rewards.total', { pay: payLine(medalRewardTotals(grants)) }))}</p>`
      : '';
  return `<p class="rw-eyebrow">${esc(t('profile.medals'))}</p>
    <h2 id="medal-rewards-title">${esc(t('profile.medal-rewards.title'))}</h2>
    <ul class="mr-list">${rows}</ul>${total}
    <div class="rw-actions"><button type="button" class="rw-equip" data-mreward="ok">${esc(t('profile.reward.accept'))}</button></div>`;
}

export function initMedalRewards(host: MedalRewardsHost): { claim(): Promise<void> } {
  const dialog = document.createElement('dialog');
  dialog.id = 'medal-rewards';
  dialog.setAttribute('aria-labelledby', 'medal-rewards-title');
  document.body.appendChild(dialog);
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-mreward="ok"]')) dialog.close();
  });
  let pending = false;
  /** A grant that arrived after the hub was left: shown on the next hub entry. */
  let held: { grants: readonly MedalRewardGrant[]; key: string } | null = null;
  // Another award window (registration, tutorial) goes first: this one waits for it to
  // close instead of stacking on top of it.
  const show = (grants: readonly MedalRewardGrant[], key: string): void => {
    if (key !== host.identity()) return;
    if (!host.visible()) {
      held = { grants, key };
      return;
    }
    const busy = document.querySelector<HTMLDialogElement>('dialog[open]:not(#medal-rewards)');
    if (busy) {
      busy.addEventListener('close', () => show(grants, key), { once: true });
      return;
    }
    dialog.innerHTML = medalRewardsHtml(grants);
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-mreward="ok"]')?.focus();
  };
  return {
    async claim() {
      if (pending) return;
      pending = true;
      const key = host.identity();
      if (held) {
        const last = held;
        held = null;
        show(last.grants, last.key);
      }
      try {
        const auth = await host.authorizedBase();
        if (!auth) return;
        const response = await fetch(`${auth.base}/profiles/rewards/medals`, {
          method: 'POST',
          headers: { authorization: `Bearer ${auth.token}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return;
        const grants = parseMedalRewards(
          ((await response.json()) as { granted?: unknown }).granted,
        );
        if (!grants?.length) return;
        show(grants, key);
        detach('medal rewards: account refresh', host.changed());
      } catch {
        /* Offline or a previous server: nothing to show; an unpaid degree is claimed again
           on the next hub entry. */
      } finally {
        pending = false;
      }
    },
  };
}
