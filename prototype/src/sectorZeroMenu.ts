/** Sector Zero's home screen. Rendering and DOM only; the host owns the run and
 * storage. Reading a save never resumes it, and replacing it is an explicit act. */
import { t } from '../../localization/runtime';
import {
  parseRunDifficulty,
  runDifficultyKey,
  type RunDifficulty,
} from '../../decisions/runDifficulty';
import type { RunPreview } from '../../decisions/sectorZeroMenu';
import { CHAPTER_KEYS, chapterRoute, romanChapter } from '../../decisions/chapterRoute';

export interface SectorZeroMenuHooks {
  root: HTMLElement;
  load(): Promise<RunPreview | null>;
  difficulty(): RunDifficulty;
  setDifficulty(value: RunDifficulty): void;
  /** Номер главы (0 — первая). Карта главы живёт в данных, экран только выбирает. */
  mission(): number;
  setMission(value: number): void;
  /** Сколько глав играбельно (`PVE_MISSION_COUNT`) — число живёт у карт, не у экрана. */
  chapters: number;
  /** Что глава просит: волн до победы и дополнительных задач — из её режима и карты. */
  chapterInfo(index: number): { waves: number; tasks: number };
  start(): void;
  startDev?: () => void;
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
  // Маршрут глав (PVR-6.9): узел на главу от края сектора к эпицентру. Закрытые главы —
  // безымянным «сигнал потерян»: нажать можно (карточка скажет, что там), выбрать нельзя.
  const route = chapterRoute(h.chapters);
  el('sz-route').innerHTML = route
    .map(
      (node) =>
        `<button id="sz-mission-${node.index}" type="button" class="sz-node${node.core ? ' sz-core-node' : ''}${node.playable ? '' : ' sz-lost'}" data-${node.playable ? 'mission' : 'lost'}="${node.index}"${node.playable ? ' aria-pressed="false"' : ' aria-disabled="true"'}><b>${romanChapter(node.index)}</b></button>`,
    )
    .join('');
  for (const node of route)
    el(`sz-mission-${node.index}`).setAttribute(
      'aria-label',
      node.playable ? t(CHAPTER_KEYS[node.index]!.name) : t('sector-zero.mission.lost'),
    );
  const missions = [...el('sz-route').querySelectorAll<HTMLButtonElement>('[data-mission]')];
  /** Выбранная глава; номер из хранилища вне пути читается первой главой — так же, как
   *  его клампит `pveState`, чтобы экран не выделял не ту главу, что запустится. */
  const current = (): number => {
    const m = h.mission();
    return Number.isInteger(m) && m >= 0 && m < missions.length ? m : 0;
  };
  const lostNodes = [...el('sz-route').querySelectorAll<HTMLButtonElement>('[data-lost]')];
  /** Узел, который игрок сейчас разглядывает (закрытый); `null` — карточка выбранной главы. */
  let peek: number | null = null;
  function renderChapter(): void {
    const index = peek ?? current();
    const keys = peek === null ? CHAPTER_KEYS[index] : undefined;
    el('sz-chapter-name').textContent = keys ? t(keys.name) : t('sector-zero.mission.lost');
    el('sz-chapter-brief').textContent = keys ? t(keys.brief) : t('sector-zero.mission.lost.brief');
    const info = keys ? h.chapterInfo(index) : null;
    el('sz-chapter-stats').textContent = info
      ? [
          t('sector-zero.chapter.waves', { n: info.waves }),
          ...(info.tasks ? [t('sector-zero.chapter.tasks', { n: info.tasks })] : []),
        ].join(' · ')
      : '';
    for (const node of lostNodes)
      node.classList.toggle('peek', Number(node.dataset.lost) === peek);
  }
  let preview: RunPreview | null = null;
  let loading = false;
  let generation = 0;

  function render(): void {
    continueButton.hidden = !preview;
    continueButton.disabled = loading;
    newButton.disabled = loading;
    const devButton = el<HTMLButtonElement>('sz-dev');
    if (devButton) { devButton.disabled = loading; devButton.hidden = !h.startDev; }
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
    for (const button of missions) {
      const index = Number(button.dataset.mission ?? 0);
      button.setAttribute('aria-pressed', String(index === current()));
      // Путь пройден до выбранной главы — линия к ней горит.
      button.classList.toggle('sz-passed', index < current());
      button.disabled = loading;
    }
    renderChapter();
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
  el('sz-dev')?.addEventListener('click', () => {
    if (loading || !h.startDev) return;
    hide();
    h.startDev();
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
  for (const button of missions)
    button.addEventListener('click', () => {
      if (loading) return;
      peek = null;
      h.setMission(Number(button.dataset.mission ?? 0));
      render();
    });
  for (const node of lostNodes)
    node.addEventListener('click', () => {
      const index = Number(node.dataset.lost);
      peek = peek === index ? null : index;
      renderChapter();
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
