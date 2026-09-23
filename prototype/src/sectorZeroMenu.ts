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
import type { ChapterMapView } from '../../decisions/chapterMap';

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
  /** Что глава просит: волн до победы, сколько задач видно в следующем забеге и сколько
   *  их в запасе главы (PVR-5.3), и выиграна ли она хоть раз. */
  chapterInfo(index: number): { waves: number; tasks: number; pool: number; cleared: boolean };
  /** Карта главы с тем, что игрок о ней знает (панель справа при выборе главы). */
  chapterMap(index: number): ChapterMapView | null;
  start(): void;
  startDev?: () => void;
  resume(): boolean;
  settings(): void;
  back(): void;
  standalone: boolean;
  preparation: { open(): void; close(): void; isOpen(): boolean };
}

/** Класс из id данных: только `[a-z0-9_-]`, чтобы вид сектора не нёс в разметку ничего чужого. */
const cls = (id: string): string => id.toLowerCase().replace(/[^a-z0-9_-]/g, '');
const pts = (poly: ReadonlyArray<[number, number]>): string =>
  poly.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' ');

/**
 * Карта главы в стиле игровой: мозаика провинций, линии проходов, туман над неопознанным.
 * Опознанное красится стороной (вы / противник / ничьё) и видом сектора, цели задач —
 * кольцом. Толщины линий не зависят от масштаба (`non-scaling-stroke`).
 */
export function chapterMapSvg(view: ChapterMapView): string {
  const { x, y, w, h } = view.frame;
  const cells = view.cells
    .map(
      (c) =>
        `<polygon class="${c.known ? `known side-${c.side} kind-${cls(c.kind ?? '')}` : 'fog'}" points="${pts(c.poly)}"/>`,
    )
    .join('');
  const lanes = view.lanes
    .map(([x1, y1, x2, y2]) => `<line x1="${Math.round(x1)}" y1="${Math.round(y1)}" x2="${Math.round(x2)}" y2="${Math.round(y2)}"/>`)
    .join('');
  const r = Math.max(w, h) / 60;
  const marks = view.cells
    .filter((c) => c.known)
    .map((c) =>
      c.side === 'you'
        ? `<rect class="home" x="${Math.round(c.x - r)}" y="${Math.round(c.y - r)}" width="${Math.round(r * 2)}" height="${Math.round(r * 2)}" transform="rotate(45 ${Math.round(c.x)} ${Math.round(c.y)})"/>`
        : `<circle class="dot side-${c.side}" cx="${Math.round(c.x)}" cy="${Math.round(c.y)}" r="${Math.round(r * 0.55)}"/>` +
          (c.objective ? `<circle class="target" cx="${Math.round(c.x)}" cy="${Math.round(c.y)}" r="${Math.round(r * 1.8)}"/>` : ''),
    )
    .join('');
  return (
    `<svg viewBox="${Math.round(x)} ${Math.round(y)} ${Math.round(w)} ${Math.round(h)}" preserveAspectRatio="xMidYMid meet" role="img">` +
    `<defs><pattern id="sz-fog" width="${Math.round(r * 1.6)}" height="${Math.round(r * 1.6)}" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="100%" height="100%" class="fog-bg"/><line x1="0" y1="0" x2="0" y2="${Math.round(r * 1.6)}" class="fog-hatch"/></pattern></defs>` +
    `<g class="cells">${cells}</g><g class="lanes">${lanes}</g><g class="marks">${marks}</g></svg>`
  );
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
          ...(info.tasks ? [t('sector-zero.chapter.tasks', { n: info.tasks, m: info.pool })] : []),
          ...(info.cleared ? [t('sector-zero.chapter.cleared')] : []),
        ].join(' · ')
      : '';
    for (const node of lostNodes)
      node.classList.toggle('peek', Number(node.dataset.lost) === peek);
    if (!mapPanel.hidden) renderMap(index, !keys);
  }

  // Панель карты главы: открывается выбором главы на маршруте и закрывается крестиком.
  const mapPanel = el('sz-map-panel');
  function renderMap(index: number, lost: boolean): void {
    const view = lost ? null : h.chapterMap(index);
    el('sz-map-title').textContent = lost ? t('sector-zero.mission.lost') : t(CHAPTER_KEYS[index]!.name);
    el('sz-map-body').innerHTML = view
      ? chapterMapSvg(view)
      : `<div class="sz-map-lost"><span>${t('sector-zero.map.lost')}</span></div>`;
    el('sz-map-foot').innerHTML = view
      ? `<b>${t('sector-zero.map.scouted', { n: view.known, m: view.total })}</b>` +
        `<span class="lg you">${t('sector-zero.map.you')}</span><span class="lg hostile">${t('sector-zero.map.hostile')}</span>` +
        `<span class="lg target">${t('sector-zero.map.target')}</span><span class="lg fog">${t('sector-zero.map.fog')}</span>`
      : '';
  }
  function openMap(): void {
    mapPanel.hidden = false;
    h.root.classList.add('sz-map-open');
    renderChapter();
    // На телефоне карта стоит блоком ниже меню — подвести к ней, иначе тап «ничего не сделал».
    if (window.matchMedia?.('(max-width: 760px)').matches)
      mapPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  el('sz-map-close').addEventListener('click', () => {
    mapPanel.hidden = true;
    h.root.classList.remove('sz-map-open');
  });
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
      // Выигранная хоть раз глава отмечена на пути (PVR-5.4).
      button.classList.toggle('sz-passed', h.chapterInfo(index).cleared);
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
      openMap();
    });
  for (const node of lostNodes)
    node.addEventListener('click', () => {
      const index = Number(node.dataset.lost);
      peek = peek === index ? null : index;
      if (peek === null) renderChapter();
      else openMap();
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
