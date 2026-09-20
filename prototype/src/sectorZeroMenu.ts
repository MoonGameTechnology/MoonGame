/** Sector Zero's home screen. Rendering and DOM only; the host owns the run and
 * storage. Reading a save never resumes it, and replacing it is an explicit act. */
import { t } from '../../localization/runtime';
import {
  parseRunDifficulty,
  runDifficultyKey,
  type RunDifficulty,
} from '../../decisions/runDifficulty';
import type { RunPreview } from '../../decisions/sectorZeroMenu';

export interface SectorZeroMenuHooks {
  root: HTMLElement;
  load(): Promise<RunPreview | null>;
  difficulty(): RunDifficulty;
  setDifficulty(value: RunDifficulty): void;
  start(): void;
  resume(): boolean;
  settings(): void;
  back(): void;
  standalone: boolean;
  preparation: { open(): void; close(): void; isOpen(): boolean };
}

export function initSectorZeroMenu(h: SectorZeroMenuHooks) {
  const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
    document.getElementById(id) as T;
  const continueButton = el<HTMLButtonElement>('sz-continue');
  const newButton = el<HTMLButtonElement>('sz-new');
  const confirmation = el('sz-confirm');
  const actions = el('sz-actions');
  const difficulties = ['weak', 'strong'].map((id) => el<HTMLButtonElement>(`sz-${id}`));
  let preview: RunPreview | null = null;
  let loading = false;
  let generation = 0;

  function render(): void {
    continueButton.hidden = !preview;
    continueButton.disabled = loading;
    newButton.disabled = loading;
    el<HTMLButtonElement>('sz-prep').disabled = loading;
    newButton.classList.toggle('sz-primary', !preview);
    el('sz-save-label').textContent = t(preview ? 'sector-zero.saved' : 'sector-zero.offline');
    el('sz-summary').textContent = loading
      ? t('sector-zero.loading')
      : preview
        ? t('sector-zero.summary', {
            wave: preview.wave,
            total: preview.total,
            difficulty: t(runDifficultyKey(preview.difficulty)),
          })
        : t('sector-zero.no-save');
    el('sz-difficulty-hint').hidden = !preview;
    for (const button of difficulties) {
      const active = button.dataset.difficulty === h.difficulty();
      button.setAttribute('aria-pressed', String(active));
      button.disabled = loading;
    }
    el('sz-back').hidden = h.standalone;
  }

  function cancel(): void {
    confirmation.hidden = true;
    actions.hidden = false;
    newButton.focus({ preventScroll: true });
  }
  function hide(): void {
    generation++;
    h.root.style.display = 'none';
    document.body.classList.remove('sector-zero-home');
  }
  async function open(): Promise<void> {
    const ownGeneration = ++generation;
    h.root.style.display = 'flex';
    h.preparation.close();
    document.body.classList.add('sector-zero-home');
    confirmation.hidden = true;
    actions.hidden = false;
    loading = true;
    render();
    // A late storage response cannot reopen a menu the player has already left.
    const loaded = await h.load();
    if (generation !== ownGeneration) return;
    preview = loaded;
    loading = false;
    render();
    (preview ? continueButton : newButton).focus({ preventScroll: true });
  }

  newButton.addEventListener('click', () => {
    if (loading) return;
    if (!preview) {
      hide();
      h.start();
      return;
    }
    actions.hidden = true;
    confirmation.hidden = false;
    el('sz-cancel').focus({ preventScroll: true });
  });
  el('sz-cancel').addEventListener('click', cancel);
  el('sz-replace').addEventListener('click', () => {
    if (loading || confirmation.hidden) return;
    hide();
    h.start();
  });
  continueButton.addEventListener('click', () => {
    if (loading || !preview) return;
    if (h.resume()) hide();
    else el('sz-summary').textContent = t('sector-zero.restore-failed');
  });
  for (const button of difficulties)
    button.addEventListener('click', () => {
      if (loading) return;
      h.setDifficulty(parseRunDifficulty(button.dataset.difficulty));
      render();
    });
  el('sz-settings').addEventListener('click', h.settings);
  el('sz-prep').addEventListener('click', () => {
    if (!loading) h.preparation.open();
  });
  el('sz-back').addEventListener('click', () => {
    hide();
    h.back();
  });
  h.root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') event.stopPropagation();
  });

  return {
    open,
    hide,
    isOpen: (): boolean => h.root.style.display === 'flex',
    // Registered above the map layers: Back dismisses replacement confirmation,
    // then returns to the shared hub only when this menu was opened from there.
    canGoBack: (): boolean =>
      h.root.style.display === 'flex' &&
      (h.preparation.isOpen() || !confirmation.hidden || !h.standalone),
    back: (): void => {
      if (h.preparation.isOpen()) h.preparation.close();
      else if (!confirmation.hidden) cancel();
      else if (!h.standalone) {
        hide();
        h.back();
      }
    },
  };
}
