import { parseRegistrationReward } from '../../decisions/registrationReward';
import type { RegistrationReward } from '../../packages/protocol/src/playerProfile';
import { t } from '../../localization/runtime';
import { esc } from './format';
import { CONTRIBUTION_MEDAL } from './profileArt';
import { gradeRoman } from './profileStudio';
import { detach } from './detach';

interface RewardHost {
  identity(): string;
  visible(): boolean;
  authorizedBase(): Promise<{ base: string; token: string } | null>;
  changed(): Promise<void>;
}

export function registrationRewardHtml(
  reward: RegistrationReward,
  saving = false,
  notice = '',
): string {
  return `<button type="button" class="rw-later btn-x" data-reward="later" aria-label="${esc(t('profile.reward.later'))}">×</button>
    <p class="rw-eyebrow">${esc(t('profile.medals'))}</p>
    <h2 id="registration-reward-title">${esc(t('profile.reward.title'))}</h2>
    <p class="rw-subtitle">${esc(t('profile.reward.subtitle'))}</p>
    <div class="rw-art"><img src="${CONTRIBUTION_MEDAL}" alt="${esc(t('profile.medal.contribution'))}"></div>
    <h3>${esc(t('profile.medal.contribution'))}</h3>
    <p class="rw-grade">${esc(t('profile.grade', { grade: gradeRoman(reward.grade) }))}</p>
    <p class="rw-xp">${esc(t('profile.reward.xp', { n: reward.xp }))}</p>
    <p class="rw-notice" role="status" aria-live="polite">${esc(notice)}</p>
    <div class="rw-actions"><button type="button" data-reward="accept" ${saving ? 'disabled' : ''}>${esc(t(saving ? 'profile.reward.saving' : 'profile.reward.accept'))}</button><button type="button" class="rw-equip" data-reward="equip" ${saving ? 'disabled' : ''}>${esc(t('profile.reward.equip'))}</button></div>`;
}

/** Native modal supplies focus trapping and a top layer; late responses never open it
 * over a match or a different account. Closing without accepting leaves the receipt pending. */
export function initRegistrationReward(host: RewardHost): { show(): Promise<void>; close(): void } {
  const dialog = document.createElement('dialog');
  dialog.id = 'registration-reward';
  dialog.setAttribute('aria-labelledby', 'registration-reward-title');
  document.body.appendChild(dialog);
  let epoch = 0;
  let key = '';
  let pending = false;
  let saving = false;
  let reward: RegistrationReward | null = null;
  let session: { base: string; token: string } | null = null;
  let controller: AbortController | null = null;
  const current = (n: number): boolean => n === epoch && key === host.identity() && host.visible();
  const close = (): void => {
    epoch++;
    controller?.abort();
    pending = saving = false;
    session = null;
    reward = null;
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener('cancel', close);
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-reward]')
      ?.dataset.reward;
    if (action === 'later') {
      close();
      return;
    }
    if ((action !== 'accept' && action !== 'equip') || saving || !reward || !session) return;
    const n = epoch;
    const auth = session;
    saving = true;
    dialog.innerHTML = registrationRewardHtml(reward, true);
    detach(
      'registration reward acceptance',
      (async () => {
        try {
          const response = await fetch(`${auth.base}/profiles/rewards/registration/accept`, {
            method: 'POST',
            headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ equip: action === 'equip' }),
            signal: AbortSignal.any([controller!.signal, AbortSignal.timeout(10_000)]),
          });
          const body = (await response.json()) as { reward?: unknown; error?: string };
          if (!current(n)) return;
          const receipt = parseRegistrationReward(body.reward);
          if (!response.ok || !receipt?.accepted) {
            saving = false;
            dialog.innerHTML = registrationRewardHtml(
              reward!,
              false,
              t(
                body.error === 'E_MEDAL_SLOTS_FULL'
                  ? 'profile.reward.full'
                  : 'profile.reward.error',
              ),
            );
            dialog.querySelector<HTMLButtonElement>('[data-reward="accept"]')?.focus();
            return;
          }
          close();
          await host.changed();
        } catch {
          if (!current(n)) return;
          saving = false;
          dialog.innerHTML = registrationRewardHtml(reward!, false, t('profile.reward.error'));
          dialog.querySelector<HTMLButtonElement>('[data-reward="accept"]')?.focus();
        }
      })(),
    );
  });
  return {
    close,
    async show() {
      if (key === host.identity() && (pending || dialog.open)) return;
      close();
      key = host.identity();
      const n = epoch;
      pending = true;
      controller = new AbortController();
      try {
        const auth = await host.authorizedBase();
        if (!auth || !current(n)) return;
        const response = await fetch(`${auth.base}/profiles/rewards/registration`, {
          headers: { authorization: `Bearer ${auth.token}` },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        });
        if (!response.ok) return;
        const body = (await response.json()) as { reward?: unknown };
        if (!current(n)) return;
        const receipt = parseRegistrationReward(body.reward);
        if (!receipt || receipt.accepted) return;
        reward = receipt;
        session = auth;
        dialog.innerHTML = registrationRewardHtml(receipt);
        dialog.showModal();
        dialog.querySelector<HTMLButtonElement>('[data-reward="accept"]')?.focus();
        await host.changed();
      } catch {
        /* Offline or a previous server: keep the hub usable; retry on its next entry. */
      } finally {
        if (n === epoch) pending = false;
      }
    },
  };
}
