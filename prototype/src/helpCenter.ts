/**
 * Хозяин справки (REFM-221): карточка корабля и справочник с кнопками «Построить здесь» и
 * «Улучшить», поиск по статьям (ONB-4), вводные к механикам при первом касании (ONB-3) и
 * сводка «пока вас не было» (ONB-5) с автопоказом по возвращении во вкладку.
 *
 * Модуль — хозяин метки ухода: новая партия гасит её дверью {@link forgetAway}, а не
 * присваиванием. Мир, своё место, позывной, мета-прогресс, разметку досье, замок здания, имя
 * флота и режим забега модуль получает хуками {@link initHelpCenter}: импорт из `main.ts`
 * был бы циклом.
 */
import {
  buildingLevel,
  buildingMaxLevel,
  type GameState,
  matchCost,
  matchUnitCost,
} from '../../packages/shared-core/src/index';
import { feedsOnBiomass } from '../../packages/shared-core/src/util/infestation';
import { t, tData } from '../../localization/runtime';
import { canBuildHere } from '../../decisions/buildGate';
import { victoryPointsShown } from '../../decisions/sectorZeroTools';
import { shipCardModel, stackBonusSlots } from '../../decisions/shipCard';
import { veteranMark } from '../../decisions/veteranMark';
import { briefSince, marksAway, splitByAttention, worthShowing } from './awayBrief';
import type { BuildKind } from './buildQueue';
import type { TileLock } from './catalogTile';
import {
  buildCodexIndex,
  type CodexCategory,
  type CodexEntry,
  GLOSSARY,
  searchCodex,
} from './codexIndex';
import { unitTitle } from './dossiers';
import { eventLog } from './eventFeed';
import { veteranPowerOn } from './fleetCard';
import { stackHullPct } from './fleetSummary';
import { buildingName, cost, esc } from './format';
import { canOrder, data, upgradeBuilding } from './game';
import { BUILD_ICON, unitIconHtml } from './icons';
import { selPlanet } from './interaction';
import { type IntroCard, parseSeenIntros, resolveIntro } from './intros';
import { jumpToPing } from './mapCamera';
import { ownerColor, youColor } from './mapPalette';
import type { MetaState } from './meta';
import { buildRecap } from './recap';
import { catalogPortraitHtml } from './shipArt';
import { shipCardHtml } from './shipCard';
import { invalidatePanel, renderPanel } from './sidePanel';
import { enqueueBuild, myRes } from './worldQueries';

/** Что справке нужно от игры. Мир, позывной, мета, досье и забег — в `main.ts`. */
export interface HelpCenterHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Позывной из поля хаба, без пробелов по краям; пустой — гость. */
  callsign(): string;
  /** Мета-прогресс командующего: ветеран вводных не видит. */
  loadMeta(): MetaState;
  /** Идёт партия, а не меню. */
  inMatch(): boolean;
  /** Разметка статьи справочника: вид (`b`/`u`), id и уровень здания. */
  codexHtml(kind: string, id: string, level: number): string;
  /** Почему новый заказ здания отбит; `null` — заказать можно. */
  buildingLocked(planetId: string, id: string): TileLock;
  /** Имя флота для карточки корабля. */
  fleetTitle(id: string): string;
  /** Идёт забег Sector Zero: очков и статей о них нет. */
  sectorZeroToolsHidden(): boolean;
}

let game: HelpCenterHost;
const live = (): GameState => game.world();
const me = (): string => game.me();

/** Карточка корабля (`shipCard.ts`) в окне справочника: отсеки стека с тем, что надето,
 *  и характеристики одного корабля. Стек адресуется местом во флоте — тем же, что у
 *  плитки; флот исчез или стек сдвинулся — карточки нет, а не чужой корабль. */
export function openShipCard(fleetId: string, index: number): void {
  const el = document.getElementById('codex');
  const f = live().fleets[fleetId];
  const stack = f?.units[index];
  if (!el || !f || !stack) return;
  const model = shipCardModel(stack, data, stackBonusSlots(live(), fleetId, stack, data));
  if (!model) return;
  const faction = live().players[f.owner]?.faction;
  const html = shipCardHtml(
    model,
    {
      // Портрет — семья владельца, как силуэт на карте: крейсер Роя — Охотник.
      portrait: (u) => catalogPortraitHtml('u', u, data, 'portrait', faction),
      icon: (u) => unitIconHtml(u, data, ownerColor(f.owner), 40, faction),
      unitName: (u) => unitTitle(u),
      moduleName: (m) => {
        const mdef = data.modules[m];
        return mdef ? tData(mdef.name) : m;
      },
    },
    {
      hpPct: stackHullPct(stack, data),
      fleetName: game.fleetTitle(f.id),
      veteran: veteranMark(stack, data, veteranPowerOn()),
    },
  );
  el.innerHTML = `<div class="cxbox sc-box">${html}<button class="cx-close">${t('codex.close')}</button></div>`;
  el.classList.add('show');
}

/** Выбранный мир партии для справочника. Из хаба — никакого: после выхода из партии
 *  `selPlanet` остаётся от неё, и карточка предложила бы строить в скрытой партии. */
export function codexWorld(): string | null {
  return document.body.classList.contains('hub-open') ? null : selPlanet;
}
export function openCodex(key: string): void {
  const [kind, id, lvl] = key.split(':');
  const el = document.getElementById('codex');
  if (!el || !kind || !id) return;
  // BUILD-1: карточка здания листает уровни (`b:id:уровень`). Без уровня в ключе
  // показывается ТЕКУЩИЙ построенный на выбранном мире (если есть) — владелец
  // открывает свою постройку и видит её, а не абстрактный первый уровень.
  const world = codexWorld();
  const builtLvl =
    kind === 'b' && world
      ? live().planets[world]?.buildings.find((b) => b.type === id)?.level
      : undefined;
  const level = Number(lvl) || builtLvl || 1;
  el.innerHTML = `<div class="cxbox">${game.codexHtml(kind, id, level)}${codexBuildBtn(kind, id, level)}<button class="cx-close">${t('codex.close')}</button></div>`;
  el.classList.add('show');
}
/** A "Build here" action inside the codex when the selected province can raise this
 *  thing — so the codex doubles as the build menu (tap a build tile → specs → build). */
function codexBuildBtn(kind: string, id: string, level = 1): string {
  const world = codexWorld();
  const p = world ? live().planets[world] : null;
  if (!p || p.owner !== me()) return ''; // only when you're looking at one of your worlds
  if (kind === 'b') {
    // BUILD-1: у ПОСТРОЕННОГО здания карточка предлагает «Улучшить» — той же пробой
    // ядра, которой решается сам приказ (RULES-1): очередь, казна и потолок уровня
    // покрыты одним вопросом. Недоступный по любой причине, кроме казны, — без кнопки.
    const inst = p.buildings.find((b) => b.type === id);
    if (inst) {
      const def = data.buildings[id];
      const max = def ? buildingMaxLevel(def) : 1;
      if (inst.level >= max) return '';
      const code = canOrder(live(), upgradeBuilding(me(), p.id, id));
      if (code !== null && code !== 'E_INSUFFICIENT') return '';
      const c = def ? matchCost(live(), buildingLevel(def, inst.level + 1).cost) : undefined;
      return `<button class="cx-build" data-cx-upg="${id}"${code ? ' disabled' : ''}>${t('side.build.upgrade', { c: '' })}${cost(c, myRes())}</button>`;
    }
    const buildable = canBuildHere(p, id, data, feedsOnBiomass(live(), me(), data));
    // buildingLocked, а не только «уже стоит»: СТРОЯЩЕЕСЯ здание ещё не в p.buildings
    // (оно попадает туда на construction.complete), и кодекс предлагал «Построить
    // здесь» второй экземпляр одноэкземплярного здания всю стройку первого.
    if (!buildable || game.buildingLocked(p.id, id)) return '';
    if (level > 1) return ''; // листаешь будущие уровни — строится всё равно первый
    return `<button class="cx-build" data-build="building:${id}">▣ ${t('codex.build-here')} · ${cost(matchCost(live(), data.buildings[id]?.cost), myRes())}</button>`;
  }
  if (kind === 'u' && data.units[id]) {
    return `<button class="cx-build" data-build="unit:${id}">${unitIconHtml(id, data, youColor, 16, live().players[me()]?.faction)} ${t('codex.build-here')} · ${cost(matchUnitCost(live(), data.units[id]), myRes())}</button>`;
  }
  return '';
}

// --- ONB-4 codex/help hub: searchable index over the article corpus ----------
// The pure index (src/codexIndex.ts) flattens every unit/building + a glossary of
// tricky terms; here we localise labels and render a searchable «?» surface. A tap
// on a result deep-links into the single-article codex (openCodex), so any
// term/unit/mechanic is two taps away. Entry points: hub «Ещё → Справочник» + the
// in-match rail «?».
const CODEX_INDEX = buildCodexIndex(data, GLOSSARY);
const CODEX_SECTIONS: Array<[CodexCategory, string]> = [
  ['unit', 'codex.hub.sec.unit'],
  ['building', 'codex.hub.sec.building'],
  ['mechanic', 'codex.hub.sec.mechanic'],
];
function codexEntryLabel(e: CodexEntry): string {
  const id = e.key.slice(2);
  if (e.category === 'unit') return unitTitle(id);
  if (e.category === 'building') return buildingName(data.buildings[id]?.name, id);
  return t(e.titleKey ?? e.title); // mechanic: the heading lives in the locale
}
function codexEntryIcon(e: CodexEntry): string {
  const id = e.key.slice(2);
  if (e.category === 'unit')
    return unitIconHtml(id, data, youColor, 20, live().players[me()]?.faction);
  if (e.category === 'building') return BUILD_ICON[id] ?? '▣';
  return '?';
}
function codexItemHtml(e: CodexEntry): string {
  return `<button class="ch-item" data-codex="${esc(e.key)}"><span class="ch-ic">${codexEntryIcon(e)}</span><span>${esc(codexEntryLabel(e))}</span></button>`;
}
// Search folds the LOCALISED label into the haystack so RU and EN queries both hit.
function renderCodexResults(query: string): void {
  const host = document.getElementById('ch-results');
  if (!host) return;
  // В забеге Sector Zero очков нет (`victoryPointsShown`) — и статьи о них тоже.
  const index = victoryPointsShown(game.sectorZeroToolsHidden())
    ? CODEX_INDEX
    : CODEX_INDEX.filter((e) => e.key !== 'm:score');
  const hits = searchCodex(index, query, (e) =>
    (codexEntryLabel(e) + ' ' + e.title + ' ' + e.tags.join(' ')).toLowerCase(),
  );
  if (!query.trim()) {
    // Empty query → browse by category.
    host.innerHTML = CODEX_SECTIONS.map(([cat, label]) => {
      const items = hits.filter((e) => e.category === cat);
      return items.length
        ? `<div class="ch-sec">${t(label)}</div><div class="ch-grid">${items.map(codexItemHtml).join('')}</div>`
        : '';
    }).join('');
    return;
  }
  host.innerHTML = hits.length
    ? `<div class="ch-grid">${hits.map(codexItemHtml).join('')}</div>`
    : `<div class="ch-empty">${t('codex.hub.empty')}</div>`;
}
export function openCodexHub(): void {
  const box = document.getElementById('codexhub');
  if (!box) return;
  box.innerHTML =
    `<div class="chbox"><div class="ch-head"><span class="cx-ic">?</span><b>${t('codex.hub.title')}</b></div>` +
    `<input id="ch-search" class="ch-search" type="text" placeholder="${t('codex.hub.search.ph')}" aria-label="${t('codex.hub.search.aria')}">` +
    `<div class="ch-body" id="ch-results"></div>` +
    `<button class="cx-close" id="ch-close">${t('codex.hub.close')}</button></div>`;
  const input = document.getElementById('ch-search') as HTMLInputElement | null;
  if (input) input.oninput = () => renderCodexResults(input.value);
  renderCodexResults('');
  box.classList.add('show');
}

// --- ONB-3 just-in-time mechanic intros --------------------------------------
// The first time a player opens an advanced panel, a one-line hint explains it,
// then never again (per-callsign seen-set). A veteran (has finished a match →
// meta XP > 0) is marked seen silently, so they are never nagged.
function seenIntrosKey(): string {
  return 'vd.seenIntros.' + (game.callsign() || 'guest');
}
/** UIX-8.1: вводная — подсказка одной строкой у низа экрана, а не окно поверх того, что она
 *  объясняет: нажатия мимо неё проходят насквозь, и первое из них её убирает (ниже). */
function showIntro(card: IntroCard): void {
  const el = document.getElementById('intro');
  if (!el) return;
  el.innerHTML =
    `<div class="inbox"><span class="in-ic">✦</span><div class="in-text"><b>${esc(t(card.titleKey))}</b>` +
    `<span>${esc(t(card.bodyKey))}</span></div><button class="in-ok">${t('onb.intro.ok')}</button></div>`;
  el.classList.add('show');
}
// Panel-open hook: show the intro for `id` once (unless already seen / a veteran).
export function maybeIntro(id: string): void {
  const seen = parseSeenIntros(localStorage.getItem(seenIntrosKey()));
  const veteran = game.loadMeta().xp > 0; // finished at least one match → knows the ropes
  const { card, seen: next } = resolveIntro(seen, id, { veteran });
  localStorage.setItem(seenIntrosKey(), JSON.stringify(next));
  if (card) showIntro(card);
}
// С клавиатуры так же: клавиша убирает подсказку раньше, чем её прочтут горячие клавиши, и
// срабатывает сама — пробел ставит паузу, T открывает науку. Escape остаётся лестнице
// «Назад»: она закрывает подсказку, и только её. Повтор зажатой клавиши и одиночный
// модификатор — ещё не действие: подсказка, открытая нажатием T, не гаснет от того же T.
const INTRO_KEEP_KEYS = new Set([
  'Escape',
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'CapsLock',
]);

// --- ONB-5 return digest ("пока тебя не было") -------------------------------
// The world runs while you're away (a backgrounded tab catches up on return, and
// on the server it runs 24/7). Rather than a silently-changed map, brief the player
// on what happened since they left — attention items first, tap to jump to the spot.
let awayFromGameTime: number | null = null;
/** Забыть метку ухода: новая партия — сводка не должна пересказывать прошлую. */
export function forgetAway(): void {
  awayFromGameTime = null;
}
function recapItemHtml(i: { text: string; anchor?: string; high: boolean }): string {
  const jump = i.anchor ? ` data-jump="${esc(i.anchor)}"` : '';
  return `<button class="rc-item${i.high ? ' hi' : ''}"${jump}><span class="rc-dot"></span><span>${esc(i.text)}</span></button>`;
}
/** Render the digest of events at/after `since`. No-op when nothing happened. */
export function openRecap(since: number): void {
  const el = document.getElementById('recap');
  if (!el) return;
  const r = buildRecap(eventLog, since);
  // Политика показа — `awayBrief.ts` (REFM-74): пустой брифинг не нагружает, важное выше.
  if (!worthShowing(r.count)) return;
  const { hi, lo } = splitByAttention(r.items);
  let body = '';
  if (hi.length)
    body +=
      `<div class="rc-sec hi">${t('onb.recap.attention', { n: r.attention })}</div>` +
      hi.map(recapItemHtml).join('');
  if (lo.length)
    body += `<div class="rc-sec">${t('onb.recap.rest')}</div>` + lo.map(recapItemHtml).join('');
  el.innerHTML =
    `<div class="rcbox"><div class="rc-head"><span class="cx-ic">🛰</span><b>${t('onb.recap.title')}</b></div>` +
    `<div class="rc-body">${body}</div><button class="cx-close" id="rc-close">${t('onb.recap.close')}</button></div>`;
  el.classList.add('show');
}
// Когда вкладка ушла в фон — реальное время, к сводке по возвращении.
let awayAtRealMs = 0;

/** Поднять справку: хуки игры и слушатели — справочник и его поиск, кнопки «?» хаба и
 *  рейки, вводные, сводка и её автопоказ. Зовётся из `main.ts` один раз, на месте прежних
 *  слушателей. */
export function initHelpCenter(host: HelpCenterHost): void {
  game = host;
  // One delegated handler for the hub (rebuilt each open, so wire the container once).
  document.getElementById('codexhub')?.addEventListener('click', (ev) => {
    const box = document.getElementById('codexhub')!;
    const tg = ev.target as HTMLElement;
    if (tg === box || tg.closest('#ch-close')) {
      box.classList.remove('show'); // backdrop / CLOSE
      return;
    }
    const item = tg.closest('.ch-item') as HTMLElement | null;
    if (item?.dataset.codex) openCodex(item.dataset.codex); // deep-link → single article (layers on top)
  });
  document.getElementById('hub-help')?.addEventListener('click', openCodexHub);
  document.getElementById('rail-help')?.addEventListener('click', openCodexHub);

  // «Понятно» — и любое нажатие по самой подсказке: под ней остаётся то, что она закрыла
  // (на телефоне — кнопка скорости), и следующее нажатие должно попасть туда. Мышь ловит
  // только коробка подсказки, поэтому щелчок сюда — щелчок по ней.
  document.getElementById('intro')?.addEventListener('click', () => {
    document.getElementById('intro')!.classList.remove('show');
  });

  // Первое действие игрока — нажатие мимо подсказки — убирает её и делает своё: подсказка
  // учит в момент нужды, а не ждёт «Понятно» (UIX-8.1). Escape закрывает её первой, как раньше.
  document.addEventListener(
    'pointerdown',
    (ev) => {
      const el = document.getElementById('intro');
      if (el?.classList.contains('show') && !(ev.target as Element).closest?.('#intro'))
        el.classList.remove('show');
    },
    true,
  );

  window.addEventListener(
    'keydown',
    (ev) => {
      if (!ev.repeat && !INTRO_KEEP_KEYS.has(ev.key))
        document.getElementById('intro')?.classList.remove('show');
    },
    true,
  );

  document.getElementById('recap')?.addEventListener('click', (ev) => {
    const el = document.getElementById('recap')!;
    const tg = ev.target as HTMLElement;
    if (tg === el || tg.closest('#rc-close')) {
      el.classList.remove('show');
      return;
    }
    const jump = tg.closest('.rc-item') as HTMLElement | null;
    if (jump?.dataset.jump) {
      el.classList.remove('show');
      jumpToPing(jump.dataset.jump); // fly the camera to the event's world
    }
  });

  // The «🛰» button in the log window → the whole-session briefing on demand.
  document.getElementById('lw-recap')?.addEventListener('click', () => openRecap(0));

  // Auto-briefing: mark where we left when the tab hides; on return summarise what happened —
  // only for a real absence. In the network the server kept the world running; the solo sim does
  // NOT catch the absence up (AUD-23: a frame gap advances at most one plausible frame), so a solo
  // brief is usually empty and `worthShowing` skips it.
  document.addEventListener?.('visibilitychange', () => {
    if (document.hidden) {
      if (marksAway(true, game.inMatch())) {
        awayFromGameTime = live().time;
        awayAtRealMs = Date.now();
      }
      return;
    }
    const since = briefSince({
      awayFromGameTime,
      inMatch: game.inMatch(),
      awayAtRealMs,
      nowRealMs: Date.now(),
    });
    awayFromGameTime = null; // метка одноразовая: иначе второй возврат покажет то же ещё раз
    if (since === null) return;
    // Give the frame loop a beat to catch the world up before we summarise it.
    window.setTimeout(() => {
      if (game.inMatch()) openRecap(since);
    }, 500);
  });

  // Codex popup: full specs for a building/ship tile, with a contextual "Build here"
  // button. Tiles live in the build menu + fleet panel now (no global HUD strip).
  const codexEl = document.getElementById('codex');
  if (codexEl) {
    codexEl.addEventListener('click', (e) => {
      const tg = e.target as HTMLElement;
      // Мир — через codexWorld(): карточка, открытая ещё в партии, могла пережить вход в хаб.
      const world = codexWorld();
      const build = (tg.closest('.cx-build') as HTMLElement | null)?.dataset.build;
      if (build && world) {
        const [kind, id] = build.split(':');
        enqueueBuild(world, { kind: kind as BuildKind, id: id!, count: 1 });
        codexEl.classList.remove('show');
        invalidatePanel();
        renderPanel();
        return;
      }
      // BUILD-1: листалка уровней в карточке здания — перерисовка той же карточки.
      const blvl = (tg.closest('[data-cx-blvl]') as HTMLElement | null)?.dataset.cxBlvl;
      if (blvl) {
        openCodex(`b:${blvl}`);
        return;
      }
      // «Улучшить» из карточки: хостовый путь заказа (сеть → приказ, соло → очередь);
      // карточка остаётся открытой и сама показывает «в работе» (проба погасит кнопку).
      const upg = (tg.closest('[data-cx-upg]') as HTMLElement | null)?.dataset.cxUpg;
      if (upg && world) {
        enqueueBuild(world, { kind: 'upgrade', id: upg, count: 1 });
        invalidatePanel();
        renderPanel();
        openCodex(`b:${upg}`);
        return;
      }
      // Карточка корабля ведёт в справочник своего корпуса — той же дорогой, что плитка.
      const deep = (tg.closest('.sc-codex') as HTMLElement | null)?.dataset.codex;
      if (deep) {
        openCodex(deep);
        return;
      }
      if (tg.id === 'codex' || tg.classList.contains('cx-close')) codexEl.classList.remove('show');
    });
  }
}
