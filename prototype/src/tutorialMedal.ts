/** The tutorial medal: the award window at the end of the guided first match and the claim
 * that carries the medal into the account profile (rules in `decisions/tutorialMedal.ts`). */
import {
  claimTutorialMedal,
  earnTutorialMedal,
  parseTutorialMedal,
  tutorialMedalPending,
  type TutorialMedalRecord,
} from '../../decisions/tutorialMedal';
import { t } from '../../localization/runtime';
import { detach } from './detach';
import { esc } from './format';
import { readRaw, writeRaw } from './prefs';
import { TUTORIAL_MEDAL } from './profileArt';

interface TutorialMedalHost {
  /** Storage key of the current callsign's record. */
  key(): string;
  authorizedBase(): Promise<{ base: string; token: string } | null>;
}

export type TutorialMedalStatus = 'saving' | 'saved' | 'later';

export function tutorialMedalHtml(status: TutorialMedalStatus): string {
  const line =
    status === 'saving'
      ? ''
      : t(status === 'saved' ? 'profile.tutorial.saved' : 'profile.tutorial.later');
  return `<p class="rw-eyebrow">${esc(t('profile.medals'))}</p>
    <h2 id="tutorial-medal-title">${esc(t('profile.tutorial.title'))}</h2>
    <div class="rw-art"><img src="${TUTORIAL_MEDAL}" alt="${esc(t('profile.medal.tutorial'))}"></div>
    <h3>${esc(t('profile.medal.tutorial'))}</h3>
    <p class="rw-subtitle" role="status" aria-live="polite">${esc(line)}</p>
    <div class="rw-actions"><button type="button" class="rw-equip" data-tmedal="ok">${esc(t('profile.reward.accept'))}</button></div>`;
}

export function initTutorialMedal(host: TutorialMedalHost): {
  award(run: { completed: boolean; assaultWon: boolean }): void;
  claim(): Promise<boolean>;
} {
  const dialog = document.createElement('dialog');
  dialog.id = 'tutorial-medal';
  dialog.setAttribute('aria-labelledby', 'tutorial-medal-title');
  document.body.appendChild(dialog);
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  dialog.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-tmedal="ok"]')) dialog.close();
  });
  const load = (key: string): TutorialMedalRecord => parseTutorialMedal(readRaw(key));
  // Sends the claim to the signed-in account's server once; a guest or an unreachable
  // server keeps it pending for the next hub.
  const claim = async (): Promise<boolean> => {
    const key = host.key();
    if (!load(key).earned) return false;
    const auth = await host.authorizedBase();
    if (!auth) return false;
    if (!tutorialMedalPending(load(key), auth.base)) return true;
    try {
      const response = await fetch(`${auth.base}/profiles/rewards/tutorial`, {
        method: 'POST',
        headers: { authorization: `Bearer ${auth.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return false;
      writeRaw(key, JSON.stringify(claimTutorialMedal(load(key), auth.base)));
      return true;
    } catch {
      return false;
    }
  };
  return {
    claim,
    award(run) {
      const key = host.key();
      const { record, fresh } = earnTutorialMedal(load(key), run);
      if (!fresh) return;
      writeRaw(key, JSON.stringify(record));
      dialog.innerHTML = tutorialMedalHtml('saving');
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('[data-tmedal="ok"]')?.focus();
      detach(
        'tutorial medal claim',
        claim().then((saved) => {
          const status = dialog.querySelector('[role="status"]');
          if (status)
            status.textContent = t(saved ? 'profile.tutorial.saved' : 'profile.tutorial.later');
        }),
      );
    },
  };
}
