/** Sector Zero's home screen. Rendering and DOM only; the host owns the run and
 * storage. Reading a save never resumes it, and replacing it is an explicit act. */
import { t } from '../../localization/runtime';
import { esc } from './format';
import {
  parseRunDifficulty,
  runDifficultyAboutKey,
  runDifficultyKey,
  type RunDifficulty,
} from '../../decisions/runDifficulty';
import type { RunPreview } from '../../decisions/sectorZeroMenu';
import { CHAPTER_KEYS, chapterRoute, romanChapter } from '../../decisions/chapterRoute';
import type { ChapterMapView } from '../../decisions/chapterMap';
import type { ProfileNumbers } from '../../decisions/cloudSync';
import type { MissionBrief } from '../../decisions/missionView';

/** Досье Роя для меню: каталог с отметкой «известно», имена уже переведены хостом. */
export interface SwarmCodexRows {
  known: number;
  total: number;
  units: Array<{
    name: string;
    known: boolean;
    max: number;
    runs: number;
    stats: { attack: number; defense: number; hp: number; speed: number };
  }>;
  modules: Array<{ name: string; desc: string; known: boolean; evidence: 'intercept' | 'brood' | null; n: number }>;
  buildings: Array<{ name: string; known: boolean }>;
}

/** Разметка досье Роя: известное — карточками, неизвестное — «?». */
export function swarmCodexHtml(c: SwarmCodexRows): string {
  const unknown = `<article class="sz-codex-card unknown"><b aria-hidden="true">?</b><small>${esc(t('sector-zero.codex.unknown'))}</small></article>`;
  const units = c.units
    .map((u) =>
      u.known
        ? `<article class="sz-codex-card"><b>${esc(u.name)}</b><p class="stats"><span>⚔ ${u.stats.attack}</span><span>🛡 ${u.stats.defense}</span><span title="${esc(t('stat.hp'))}">♥ ${u.stats.hp}</span><span title="${esc(t('stat.speed'))}">➤ ${u.stats.speed}</span></p><small>${esc(t('sector-zero.codex.unit.seen', { n: u.max, r: u.runs }))}</small></article>`
        : unknown,
    )
    .join('');
  const modules = c.modules
    .map((m) =>
      m.known
        ? `<article class="sz-codex-card"><b>${esc(m.name)}</b>${m.desc ? `<p>${esc(m.desc)}</p>` : ''}<small>${esc(m.evidence === 'intercept' ? t('sector-zero.codex.veil.seen', { n: m.n }) : t('sector-zero.codex.brood.seen'))}</small></article>`
        : unknown,
    )
    .join('');
  const buildings = c.buildings
    .map((b) =>
      b.known
        ? `<article class="sz-codex-card"><b>${esc(b.name)}</b><small>${esc(t('sector-zero.codex.building.seen'))}</small></article>`
        : unknown,
    )
    .join('');
  const section = (key: string, cards: string): string =>
    cards ? `<h4>${esc(t(key))}</h4><div class="sz-codex-grid">${cards}</div>` : '';
  return (
    `<p class="sz-codex-sum">${t('sector-zero.codex.progress', { n: `<b>${c.known}</b>`, m: c.total })}</p>` +
    (c.known === 0 ? `<p class="sz-codex-empty">${esc(t('sector-zero.codex.empty'))}</p>` : '') +
    section('sector-zero.codex.units', units) +
    section('sector-zero.codex.modules', modules) +
    section('sector-zero.codex.buildings', buildings)
  );
}
import { detach } from './detach';

/** Вход площадки и облако профиля (`YAG-1.4`). Нет — площадка без облака: ни кнопки
 *  входа, ни развилки. */
export interface SectorZeroAccount {
  /** Показать «Войти»: у площадки есть облако и вход, а игрок — гость. */
  canSignIn(): boolean;
  /** Окно входа площадки и сверка с облаком после него. */
  signIn(): Promise<void>;
  /** Развилка профилей — числа обоих; `null` — выбирать нечего. */
  fork(): { here: ProfileNumbers; cloud: ProfileNumbers } | null;
  choose(pick: 'here' | 'cloud'): Promise<void>;
}

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
  chapterInfo(index: number): {
    waves: number;
    tasks: number;
    pool: number;
    cleared: boolean;
    /** Герой-награда главы (`heroRecruits.ts`): имя и пришёл ли он уже. Нет — у главы награды-героя нет. */
    hero?: { name: string; joined: boolean };
    /** Задачи следующего забега с наградой (`missionView.ts`) — названиями, а не числом. */
    briefs: MissionBrief[];
  };
  /** Карта главы с тем, что игрок о ней знает (панель справа при выборе главы). */
  chapterMap(index: number): ChapterMapView | null;
  /** Досье Роя из профиля (`swarmCodex.ts`) — строки уже с именами из данных. */
  swarmCodex(): SwarmCodexRows;
  start(): void;
  startDev?: () => void;
  resume(): boolean;
  settings(): void;
  back(): void;
  standalone: boolean;
  preparation: { open(): void; close(): void; isOpen(): boolean };
  account?: SectorZeroAccount;
}

const numbersText = (n: ProfileNumbers): string => t('sector-zero.cloud.numbers', { ...n });

/** Класс из id данных: только `[a-z0-9_-]`, чтобы вид сектора не нёс в разметку ничего чужого. */
const cls = (id: string): string => id.toLowerCase().replace(/[^a-z0-9_-]/g, '');
const pts = (poly: ReadonlyArray<[number, number]>): string =>
  poly.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' ');

/**
 * Карта главы в стиле игровой: мозаика провинций, линии проходов, туман над неопознанным.
 * Опознанное красится стороной (вы / противник / ничьё) и видом сектора, цели задач —
 * кольцом. Толщины линий не зависят от масштаба (`non-scaling-stroke`). Размера у SVG нет —
 * только `viewBox`: высоту панель берёт из его пропорций, и карта не обрастает полосами.
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
        : `<circle class="dot side-${c.side}" cx="${Math.round(c.x)}" cy="${Math.round(c.y)}" r="${Math.round(r * 0.55)}"/>`,
    )
    .join('');
  // Цели задач — поверх, и в тумане тоже: задача сама называет место. Активная (следующий
  // забег) — мятное кольцо с флажком, как метка в забеге; «позже» — приглушённый пунктир.
  const targets = view.cells
    .filter((c) => c.objective !== null)
    .map((c) => {
      const cx = Math.round(c.x);
      const cy = Math.round(c.y);
      const ring = `<circle class="target ${c.objective}" cx="${cx}" cy="${cy}" r="${Math.round(r * 1.8)}"/>`;
      if (c.objective !== 'active') return ring;
      const fx = Math.round(c.x + r * 1.3);
      const fy = Math.round(c.y - r * 2.6);
      return (
        ring +
        `<path class="flag" d="M${fx} ${fy + Math.round(r * 2)}V${fy}l${Math.round(r * 1.4)} ${Math.round(r * 0.5)}l${-Math.round(r * 1.4)} ${Math.round(r * 0.5)}"/>`
      );
    })
    .join('');
  return (
    `<svg viewBox="${Math.round(x)} ${Math.round(y)} ${Math.round(w)} ${Math.round(h)}" preserveAspectRatio="xMidYMid meet" role="img">` +
    // Туман — свой мягкий свет в каждой плитке (градиент по рамке клетки): форма главы
    // читается, а вид и хозяин неразведанного — нет. Цвета остановок живут в CSS.
    `<defs><radialGradient id="sz-fog" cx="50%" cy="42%" r="70%"><stop offset="0" class="fog-in"/><stop offset="1" class="fog-out"/></radialGradient></defs>` +
    `<g class="cells">${cells}</g><g class="lanes">${lanes}</g><g class="marks">${marks}${targets}</g></svg>`
  );
}

export function initSectorZeroMenu(h: SectorZeroMenuHooks) {
  const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
    document.getElementById(id) as T;
  const continueButton = el<HTMLButtonElement>('sz-continue');
  const newButton = el<HTMLButtonElement>('sz-new');
  const confirmation = el('sz-confirm');
  const actions = el('sz-actions');
  const cloudChoice = el('sz-cloud-choice');
  const signInRow = el('sz-signin-row');
  const signInButton = el<HTMLButtonElement>('sz-signin');
  const choiceButtons = ['sz-keep-here', 'sz-take-cloud'].map((id) => el<HTMLButtonElement>(id));
  /** Окно входа открыто или выбор профиля применяется — второй тап ничего не начинает. */
  let busy = false;
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
    // Задачи следующего забега — названиями и с наградой (заказ владельца 2026-09-24):
    // «доп. задач: 3 из 5» не говорило, ЧТО делать и сколько за это придёт.
    const tasks = el('sz-chapter-tasks');
    const briefs = info?.briefs ?? [];
    tasks.hidden = briefs.length === 0;
    tasks.innerHTML = briefs
      .map(
        (b) =>
          `<li><span>⚑ ${esc(t(b.id, { n: b.n }))}</span><em><i class="tw-data">◇ +${b.reward.research}</i> <i class="tw-warrants">⌖ +${b.reward.warrants}</i></em></li>`,
      )
      .join('');
    // Награда-герой: силуэт, пока он не пришёл, — цель видна до забега.
    const heroLine = el('sz-chapter-hero');
    heroLine.hidden = !info?.hero;
    if (info?.hero) {
      heroLine.classList.toggle('joined', info.hero.joined);
      heroLine.innerHTML =
        `<span class="sz-hero-sil" aria-hidden="true">${info.hero.joined ? '★' : '?'}</span>` +
        `<span>${esc(t(info.hero.joined ? 'sector-zero.chapter.hero.joined' : 'sector-zero.chapter.hero', { name: info.hero.name }))}</span>`;
    }
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
        `<span class="lg target">${t('sector-zero.map.target')}</span><span class="lg target-later">${t('sector-zero.map.target.later')}</span><span class="lg fog">${t('sector-zero.map.fog')}</span>`
      : '';
  }
  function openMap(): void {
    el('sz-codex-panel').hidden = true;
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
    // Подпись есть, только когда есть сохранённый забег: без него «Одиночная игра» здесь
    // повторяла надзаголовок меню (третий раз на одном экране).
    const saveLabel = el('sz-save-label');
    saveLabel.hidden = !preview;
    saveLabel.textContent = preview ? t('sector-zero.saved') : '';
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
    el('sz-difficulty-what').textContent = t(runDifficultyAboutKey(h.difficulty()));
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
    signInRow.hidden = loading || !h.account?.canSignIn();
    signInButton.disabled = busy;
    // Развилка заменяет кнопки меню: играть до выбора — значит играть профилем, который
    // выбор может заменить.
    const fork = loading ? null : (h.account?.fork() ?? null);
    cloudChoice.hidden = !fork;
    if (fork) {
      actions.hidden = true;
      confirmation.hidden = true;
      el('sz-cloud-here').textContent = numbersText(fork.here);
      el('sz-cloud-cloud').textContent = numbersText(fork.cloud);
      for (const button of choiceButtons) button.disabled = busy;
    }
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
  /** Действие с облаком, после которого профиль мог смениться: меню читается заново. */
  function accountStep(what: string, step: () => Promise<void>): void {
    if (loading || busy) return;
    busy = true;
    render();
    detach(
      what,
      step().finally(() => {
        busy = false;
        return open();
      }),
    );
  }
  signInButton.addEventListener('click', () => {
    const account = h.account;
    if (account) accountStep('Sector Zero: вход площадки', () => account.signIn());
  });
  for (const [button, pick] of [
    [choiceButtons[0]!, 'here'],
    [choiceButtons[1]!, 'cloud'],
  ] as const)
    button.addEventListener('click', () => {
      const account = h.account;
      if (account && !cloudChoice.hidden)
        accountStep('Sector Zero: выбор профиля', () => account.choose(pick));
    });
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
  // Досье Роя встаёт на место карты главы: две панели в одном столбце не открываются разом.
  const codexPanel = el('sz-codex-panel');
  el('sz-codex').addEventListener('click', () => {
    if (!codexPanel.hidden) {
      codexPanel.hidden = true;
      return;
    }
    mapPanel.hidden = true;
    el('sz-codex-body').innerHTML = swarmCodexHtml(h.swarmCodex());
    codexPanel.hidden = false;
    if (window.matchMedia?.('(max-width: 900px)').matches)
      codexPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  el('sz-codex-close').addEventListener('click', () => {
    codexPanel.hidden = true;
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
