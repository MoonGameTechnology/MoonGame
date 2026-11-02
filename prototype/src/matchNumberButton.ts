import { compactMatchNumberText, matchNumberText } from '../../decisions/matchNumber';
import { t } from '../../localization/runtime';
import { esc } from './format';

/** The displayed number is the copy target, including for legacy UUID sessions. */
export function matchNumberButton(
  matchId: string,
  notice: (text: string) => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mnumber btn-quiet';
  button.title = `${t('hub.mine.copy')} · ${matchNumberText(matchId)}`;
  button.ariaLabel = button.title;
  button.innerHTML =
    `<span class="mnumber-label">${esc(compactMatchNumberText(matchId))}</span>` +
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' +
    '<g class="mnumber-copy"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/></g>' +
    '<path class="mnumber-check" d="m5 12 4 4L19 6"/></svg>';
  button.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(matchId);
      button.classList.toggle('copied', true);
      button.title = t('hub.mine.copied');
      notice(t('hub.mine.copied'));
    } catch {
      // A blocked clipboard must leave the complete number available for manual selection.
      button.querySelector('.mnumber-label')!.textContent = matchNumberText(matchId);
      button.title = `${t('hub.mine.copy')} · ${matchNumberText(matchId)}`;
      button.classList.toggle('manual', true);
      button.classList.toggle('copied', false);
      notice(t('hub.mine.copy-manual'));
    }
  });
  return button;
}
