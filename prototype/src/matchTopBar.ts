/**
 * Верхняя полоса матча (REFM-222): то, что игрок читает над картой и у её края. Строка статуса
 * с часами, волнами, осадами и чипами задач, союзника и сохранения; ряд 1 шапки
 * (позывной, место, ✦-чип очков, день с отсчётом); плашки ресурсов с «+N» под ними; значки
 * внимания (бои, письма, зеркало на гамбургере) и тревога «враг у ваших рубежей»; полоса
 * скорости с парой «играть / ускорить», множителями и перезапуском; досье Роя. Кеши шапки, по
 * которым кадр решает, перерисовывать ли узел, живут здесь же.
 *
 * Правила того, ЧТО показать, живут в чистых модулях рядом (`standingLine.ts`,
 * `resourceChip.ts`, `attentionBadges.ts`, `matchExits.ts`, `threatAlerts.ts`, `swarmDossier.ts`
 * и решения в `decisions/`); здесь только их проводка. Темп мира и его реальные часы, мир на
 * экране, своё место, имена, пульс чипа союзника, окна, пауза забега и кнопка скорости телефона
 * живут в `main.ts`; модуль получает их хуками {@link initTopBar}: импорт оттуда был бы циклом.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import { identifiedNodes, scanNodeThreats } from '../../packages/shared-core/src/index';
import { t } from '../../localization/runtime';
import { allyPanelView } from '../../decisions/allyPanel';
import { devourSieges } from '../../decisions/devourSiege';
import type { MissionRow } from '../../decisions/missionView';
import { tempoOf } from '../../decisions/phoneSpeed';
import { refugeThreats } from '../../decisions/refugeThreat';
import { runClockText } from '../../decisions/runClock';
import type { RunPauseEvent } from '../../decisions/runPause';
import { RUN_SPEED_DEV } from '../../decisions/runTempo';
import { swarmDossier } from '../../decisions/swarmDossier';
import { swarmJournal } from '../../decisions/swarmJournal';
import { swarmLoreKnown } from '../../decisions/swarmLore';
import { waveReadout } from '../../decisions/waveReadout';
import { hourBucket } from './alerts';
import { ALLY_EMBLEM } from './allyScreen';
import { attentionTotal, countShown, myBattleCount, railBadge } from './attentionBadges';
import { note, toast } from './eventFeed';
import { clockHM, countdownHMS, esc, flowPer, flowRate, kfmt } from './format';
import { data } from './gameData';
import { motionOn, pcUi } from './graphicsPrefs';
import { RES_SVG, SOV_SVG } from './icons';
import { jumpToPing } from './mapCamera';
import { fleetSeen, known, vision } from './mapFog';
import { displayOf, speedbarRestartShown, speedbarShown, timeControlsShown } from './matchExits';
import { unreadMsgs } from './messageLog';
import { NET, netWorld } from './netSession';
import type { initPhoneSpeed } from './phoneSpeed';
import { ctx } from './protoKernel';
import {
  chipDead,
  chipShort,
  flowDigits,
  flowPrefix,
  flowRounded,
  flowShown,
  flowSign,
  stockText,
} from './resourceChip';
import { sectorProgress } from './sectorProfile';
import { isSectorZeroRun, sectorDevActive, sectorRunActive } from './sectorRun';
import { runWallet } from './sectorZeroShell';
import { saveSolo, soloSaveActive } from './soloCheckpoint';
import { atLimit, callsign, liveStanding, standingShown, topSignature } from './standingLine';
import { stewFmtDur } from './stewardScreen';
import { swarmDossierBadge, swarmDossierHtml } from './swarmDossier';
import { threatAlerts, threatScanDue, threatsHeard, type ThreatSighting } from './threatAlerts';
import { DAY, HOUR } from './time';

declare const __PLAYER_BUILD__: boolean;

/** Что полосе нужно от игры. Темп, мир, место, имена, окна и такт телефона — в `main.ts`. */
export interface TopBarHost {
  /** Мир на экране. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Имена держав по месту. */
  names(): Record<string, string>;
  /** Имя мира для строки — с учётом тумана и переименований. */
  placeName(id: string): string;
  /** Идёт ли матч на экране. */
  inMatch(): boolean;
  /** Темп мира: игровые часы за реальную секунду, 0 — пауза. */
  speed(): number;
  /** Поставить темп мира. */
  setSpeed(speed: number): void;
  /** Продолжить без нагона: реальное время паузы мир не отыгрывает. */
  restartRealClock(): void;
  /** Пауза забега показана: «‖» полосы идёт через её правило. */
  runPauseShown(): boolean;
  /** Повод паузы забега. */
  runPauseEvent(event: RunPauseEvent): void;
  /** Инструменты сессии убраны: идёт забег Sector Zero. */
  toolsHidden(): boolean;
  /** Порог очков победы этого матча. */
  scoreLimit(): number;
  /** Позывной из поля ввода. */
  nick(): string;
  /** Приток и расход ресурсов в час — памятка кадра. */
  income(): Record<string, number>;
  /** Телефонная раскладка. */
  mobile(): boolean;
  /** Сколько мест ведёт локальный ИИ. */
  aiSeats(): number;
  /** Разработчик включил управление временем. */
  speedControl(): boolean;
  /** Кнопка скорости телефона. */
  phoneSpeed(): Pick<ReturnType<typeof initPhoneSpeed>, 'sync'>;
  /** Значки «Событий» и «Ещё» телефона. */
  phoneBadges(battles: number, unread: number): void;
  /** Чип союзника мигает. */
  allyPulsing(): boolean;
  /** Чип союзника мигает: союзник докладывает об угрозе. */
  pulseAlly(): void;
  /** Окно союзника. */
  openAlly(): void;
  /** Панель задач забега. */
  toggleMissions(): void;
  /** Открыта ли панель задач забега. */
  missionsOpen(): boolean;
  /** Карточка ресурса. */
  openResource(key: string): void;
  /** Перезапуск: к выбору ботов или в меню Sector Zero. */
  restart(): void;
}

let game: TopBarHost;
const $ = (id: string) => document.getElementById(id) as HTMLElement;

// Кеши шапки: узел перерисовывается, только когда его разметка или текст изменились.
let lastClockText = '';
let lastClockHead = '';
let lastTopText = ''; // row-1 dirty check (nick / standing / score / day / countdown)
let lastHudHtml = '';
let lastAlertText = '';
let lastRailAlert = '';

/** Строка статуса забыла себя: следующий кадр перерисует её целиком. */
export function forgetStatusLine(): void {
  lastClockText = '';
}

// --- swarm dossier --------------------------------------------------------------------------
let swarmDossierWin: HTMLElement;
let swarmDossierDesktop: MediaQueryList | undefined;
export let swarmDossierPinned = false;
let lastSwarmDossierHtml = '';
let lastSwarmDossierRefresh = -Infinity;
let lastSwarmDossierContactKey = '';
let swarmDossierScanUntil = 0;
const SWARM_DOSSIER_REFRESH_MS = 500;
/** Чем досье открыли — язычком или пунктом гамбургера: туда и вернуть фокус при закрытии. */
let swarmDossierOpener: HTMLElement | null = null;
function openSwarmDossier(opener: HTMLElement): void {
  swarmDossierOpener = opener;
  swarmDossierWin.classList.add('show');
  renderSwarmDossier();
  $('swarm-dossier-close').focus({ preventScroll: true });
}
export function closeSwarmDossier(): void {
  if (swarmDossierPinned) return;
  swarmDossierWin.classList.remove('show');
  swarmDossierOpener?.focus({ preventScroll: true });
}
/** Смена матча: досье старого матча не остаётся открытым поверх нового. */
export function hideSwarmDossier(): void {
  swarmDossierWin.classList.remove('show');
}
let railDossier: HTMLElement;
let swarmTab: HTMLElement;
// Досье сворачивается до шапки со сводкой (заказ владельца 2026-09-23). Свёрнутость —
// удобство ЗРИТЕЛЯ, а не состояние партии: хранится в localStorage и переживает перезагрузку;
// хранилище может быть недоступно (приватное окно) — тогда досье просто развёрнуто.
// Сворачивает только приколотое досье: у выдвижной панели на телефоне есть «Закрыть».
const SWARM_DOSSIER_FOLD_KEY = 'vd.swarmDossier.folded';
let swarmDossierFolded = false;
let lastSwarmDossierBadge = '';
function applySwarmDossierFold(): void {
  const folded = swarmDossierPinned && swarmDossierFolded;
  swarmDossierWin.classList.toggle('folded', folded);
  const fold = $('swarm-dossier-fold');
  fold.setAttribute('aria-expanded', String(!folded));
  fold.title = swarmDossierPinned ? t(folded ? 'swarm.intel.unfold' : 'swarm.intel.fold') : '';
}
export function renderSwarmDossier(now = performance.now()): void {
  const s = game.world();
  const ME = game.me();
  const pinned = Boolean(game.inMatch() && s.pve && swarmDossierDesktop?.matches);
  if (pinned !== swarmDossierPinned) {
    swarmDossierPinned = pinned;
    lastSwarmDossierRefresh = -Infinity;
    swarmDossierWin.classList.toggle('pinned', pinned);
    swarmDossierWin.classList.toggle('show', pinned);
    swarmDossierWin.setAttribute('role', pinned ? 'complementary' : 'dialog');
    if (pinned) swarmDossierWin.removeAttribute('aria-modal');
    else swarmDossierWin.setAttribute('aria-modal', 'true');
    applySwarmDossierFold();
  }
  if (pinned) swarmDossierWin.classList.add('show');
  if (!game.inMatch()) swarmDossierWin.classList.remove('show');
  if (!swarmDossierWin.classList.contains('show')) {
    lastSwarmDossierRefresh = -Infinity;
    lastSwarmDossierContactKey = '';
    swarmDossierScanUntil = 0;
    swarmDossierWin.classList.remove('updating');
    return;
  }
  swarmDossierWin.classList.toggle('scan-motion', pinned && motionOn());
  swarmDossierWin.classList.toggle('updating', pinned && now < swarmDossierScanUntil);
  // Coalesce incoming state changes before building contacts/HTML, not only DOM writes.
  // The simulation and fog keep their full cadence; only this desktop panel is sampled.
  if (pinned && now - lastSwarmDossierRefresh < SWARM_DOSSIER_REFRESH_MS) return;
  lastSwarmDossierRefresh = now;
  const contacts = swarmDossier(s, ME, vision?.identify ?? new Set());
  // A live observation's clock advances continuously. It must not spin the scanner.
  const contactKey = JSON.stringify(
    contacts.map((c) => ({
      id: c.id,
      location: c.location,
      units: c.units,
      live: c.live,
      at: c.live ? undefined : c.at,
    })),
  );
  if (
    pinned &&
    contactKey !== lastSwarmDossierContactKey &&
    (contacts.length || lastSwarmDossierContactKey)
  ) {
    swarmDossierScanUntil = now + 750;
    swarmDossierWin.classList.add('updating');
  }
  lastSwarmDossierContactKey = contactKey;
  // PVR-4.5: журнал строится из ПРОЕКЦИИ — в ней лежит только свой журнал, чужой снят
  // фильтром зрителя, а память и проект Роя не приезжают вовсе.
  const badge = swarmDossierBadge(contacts);
  if (badge !== lastSwarmDossierBadge) {
    $('swarm-dossier-badge').textContent = badge;
    lastSwarmDossierBadge = badge;
  }
  const html = swarmDossierHtml(
    contacts,
    swarmJournal(s.swarmJournal?.[ME]),
    swarmLoreKnown(sectorProgress, sectorRunActive),
    game.placeName,
  );
  if (html !== lastSwarmDossierHtml) {
    const body = $('swarm-dossier-body');
    const scroll = body.scrollTop;
    const biologyOpen = body.querySelector<HTMLDetailsElement>('.swarm-biology')?.open;
    body.innerHTML = html;
    const biology = body.querySelector<HTMLDetailsElement>('.swarm-biology');
    if (biology && biologyOpen) biology.open = true;
    body.scrollTop = scroll;
    lastSwarmDossierHtml = html;
  }
}

// --- status line, top-bar row 1, purse and badges -------------------------------------------
let devlineHead: HTMLElement;
let devlineTail: HTMLElement;
let purse: HTMLElement;
let tbName: HTMLElement;
let tbPlace: HTMLElement;
let tbScore: HTMLElement;
let tbDay: HTMLElement;
let tbEta: HTMLElement;
let alertBadge: HTMLElement;
let railEl: HTMLElement;
let railAlert: HTMLElement;

/** Плашки ресурсов обновляются НА МЕСТЕ. Числа на быстрой скорости меняются каждый кадр, и
 *  замена `innerHTML` всей шапки пересоздавала узел плашки между нажатием и отпусканием —
 *  клик по ресурсу терялся (нашёл прогон «потыкать все кнопки», 2026-09-25). Узел `.res`
 *  живёт, пока набор ресурсов тот же; меняются его класс, подпись и содержимое, а
 *  содержимое прозрачно для указателя (CSS), так что целью клика всегда остаётся плашка. */
let purseTpl: HTMLTemplateElement;
function patchPurse(html: string): void {
  purseTpl.innerHTML = html;
  // Без настоящего DOM (упрощённые харнесы) — прежняя замена целиком.
  if (!purseTpl.content?.children || !purse.children) {
    purse.innerHTML = html;
    return;
  }
  const fresh = [...purseTpl.content.children] as HTMLElement[];
  const cur = [...purse.children] as HTMLElement[];
  const same =
    fresh.length === cur.length && fresh.every((el, i) => el.dataset.res === cur[i]!.dataset.res);
  if (!same) {
    purse.replaceChildren(...fresh);
    return;
  }
  fresh.forEach((el, i) => {
    const old = cur[i]!;
    if (old.className !== el.className) old.className = el.className;
    if (old.title !== el.title) old.title = el.title;
    if (old.innerHTML !== el.innerHTML) old.innerHTML = el.innerHTML;
  });
}

/**
 * Кадр шапки: строка статуса и входы в досье Роя, ряд 1, плашки ресурсов и значки внимания.
 * `missions` — строки задач забега этого кадра: их же получают панель задач и комиксы.
 */
export function renderTopBar(missions: MissionRow[]): void {
  const s = game.world();
  const ME = game.me();
  // Status strip below the top bar: the in-game clock plus the donate currency
  // (Суверены ◆) pushed to the right end — one level down from the resource row.
  // Day + countdown live in the #daycard, victory progress in the #tbscore chip
  // (row 1 of the bar, below). (World/fleet counts stay on the player card.)
  // PVR-1.2: строка волн стоит рядом с часами, потому что это то же самое измерение —
  // сколько осталось до следующего события мира. В обычной партии `waveReadout` отвечает
  // «нечего», и полоса выглядит ровно как до этого кирпича.
  const wave = waveReadout(s.pve, s.time);
  const waveHtml =
    wave.kind === 'none'
      ? ''
      : `<span class="dl-wave">${t('hud.wave', { n: wave.kind === 'waves' ? wave.wave : wave.total, m: wave.total })}` +
        ` · ${
          wave.kind === 'cleared'
            ? t('hud.wave.done')
            : wave.kind === 'hold'
              ? // Глава с архивом (PVR-7.3) или с контрактом операции (главы V и VI): удержание
                // её не выигрывает — обещать «выстоять ещё» значило бы врать; волны просто
                // кончились, исход решает накопитель или операция.
                s.extraction || s.operation
                ? t('hud.wave.done')
                : t('hud.wave.hold', { in: countdownHMS(wave.holdInMs) })
              : // На телефоне строка статуса уже экрана: слова «следующая через» уходят, остаётся
                // отсчёт (прогон кнопок на телефоне, 2026-09-25 — хвост обрезался маской).
                `<span class="dl-full">${t('hud.wave.next', { in: countdownHMS(wave.nextInMs) })}</span>` +
                `<span class="dl-short">${countdownHMS(wave.nextInMs)}</span>`
        }</span>`;
  // ЗАДАЧИ ЗАБЕГА (решение владельца 2026-09-22). Прогресс считается ЧИСТЫМ предикатом по
  // текущему состоянию, поэтому живая строка не стоит ни нового поля в состоянии, ни
  // события: тот же `missionProgress`, что платит в конце, отвечает и здесь, каждый кадр.
  // Видимы только задачи ЭТОГО забега — запас главы минус закрытое навсегда (PVR-5.3).
  // Чип — кнопка панели задач (заказ владельца 2026-09-24): список прятался в подсказке
  // при наведении, и на телефоне его не было видно вовсе.
  // PVR-4.7: осада «Поглощения мира» над своим миром — и в строке статуса: на карте отсчёт
  // может заслонить флот, здесь он читается всегда. На телефоне — только знак и время.
  const siegeHtml = devourSieges(s, ME)
    .map((m) => {
      const place = game.placeName(m.target);
      const left = countdownHMS(m.leftMs);
      const tip = m.archetype
        ? ` title="${esc(t(`boss.${m.archetype}.siege`, { world: place, in: left }))}"`
        : '';
      return `<span class="dl-siege"${tip}>☠ <span>${esc(place)} </span>${left}</span>`;
    })
    .join('');
  const missionsDone = missions.filter((m) => m.complete).length;
  const missionHtml =
    missions.length === 0
      ? ''
      : `<button type="button" class="dl-missions" data-missions="1" aria-expanded="${game.missionsOpen()}" title="${t('hud.missions.title')}"><i aria-hidden="true">⚑</i><span>${t('hud.missions.label')}</span><b>${missionsDone}/${missions.length}</b></button>`;
  // Глава IV (PVR-7.5): чип «⬡ Союзник · шаг операции» — вход в окно связи, только после
  // встречи. После самой встречи он мигает, пока игрок его не заметит.
  const allyView = sectorRunActive ? allyPanelView(s, ME, data) : null;
  const allyHtml = allyView
    ? `<button type="button" class="dl-ally${game.allyPulsing() ? ' pulse' : ''}" data-ally-open="1" title="${esc(t('ally.title'))}">` +
      `<i aria-hidden="true">${ALLY_EMBLEM}</i><span>${esc(t('ally.label'))}</span><b>${esc(t(`ally.step.${allyView.step}`))}</b></button>`
    : '';
  // В забеге время суток ничего не значит (дня в шапке нет) — часы показывают, сколько
  // забег идёт, в тех же реальных минутах, что и все его таймеры.
  const clockHtml = `<span id="clock">${isSectorZeroRun() ? runClockText(s.time) : clockHM(s.time)}</span>`;
  if (clockHtml !== lastClockHead) {
    devlineHead.innerHTML = clockHtml;
    lastClockHead = clockHtml;
  }
  const statusHtml =
    missionHtml +
    allyHtml +
    siegeHtml +
    waveHtml +
    (!__PLAYER_BUILD__ && sectorDevActive ? `<span>${t('sandbox.dev.active')}</span>` : '') +
    (soloSaveActive && !NET && game.speed() === 0
      ? `<button type="button" data-solo-play="1">${t('solo.save.play')}</button>`
      : '') +
    (soloSaveActive && !NET
      ? `<button type="button" data-solo-save="1">${t('solo.save.action')}</button>`
      : '') +
    // Суверены — приманка (заказ владельца 2026-09-23): золото, блик и «+». Магазин живёт в
    // «Снабжении» главного экрана (решение 2026-10-15: «магазин не скрывай»), и нажатие
    // говорит, где он, не выводя из партии. Числа нет, пока у основной игры нет
    // авторитетного кошелька; в забеге Sector Zero Суверены — в шапке забега (`runWallet`).
    (game.toolsHidden()
      ? ''
      : `<button type="button" class="dl-donate" data-donate="1" title="${t('hub.sovereigns')}" aria-label="${t('donate.open')}"><i>${SOV_SVG}</i><em aria-hidden="true">+</em></button>`);
  if (statusHtml !== lastClockText) {
    devlineTail.innerHTML = statusHtml;
    lastClockText = statusHtml;
  }
  // Входы в досье Роя — пока оно не приколото справа (ПК держит его открытым всегда).
  // Язычок прячется и под открытой панелью: ручка того, что уже выдвинуто, не нужна.
  const dossierEntry = Boolean(s.pve) && !swarmDossierPinned;
  const railDossierShown = dossierEntry ? '' : 'none';
  if (railDossier.style.display !== railDossierShown) railDossier.style.display = railDossierShown;
  const tabHidden = !dossierEntry || swarmDossierWin.classList.contains('show');
  if (swarmTab.hidden !== tabHidden) swarmTab.hidden = tabHidden;
  // Top-bar row 1: nick + live standing («N-е из M» — the end-screen ranking formula
  // over the LIVE scores), the ✦ victory chip in the middle gap, and the day card
  // with a countdown to the next game day. Fixed nodes are patched by textContent
  // (no innerHTML rebuild — the crest/who/dstat click targets stay put).
  const SCORE_LIMIT = game.scoreLimit();
  const d = Math.floor(s.time / DAY) + 1;
  // Живое положение в таблице — `standingLine.ts` (REFM-191): место берётся ТОЙ ЖЕ
  // формулой, что и на итоговом экране (`placementOf`), иначе две рукописные копии
  // сортировки молча разойдутся; пустая таблица даёт место 0, и печатать его нельзя —
  // вышло бы «1-е из 0» до старта; подпись перерисовки несёт КАЖДОЕ видимое поле через
  // разделитель, недостижимый в тексте, иначе строка застынет на прошлом значении.
  const {
    place: myPlace,
    of: seats,
    score,
    need,
  } = liveStanding(s.match?.scores ?? {}, ME, SCORE_LIMIT);
  const nick = callsign(game.nick(), game.names()[ME]);
  const eta = countdownHMS(DAY - (s.time % DAY));
  // Шапка забега (решение владельца 2026-09-24): вместо эмблемы, очков и дня — кошелёк
  // профиля, живой: награда или ролик посреди забега видны сразу.
  runWallet.render();
  const topText = topSignature(nick, myPlace, seats, score, d, eta);
  if (topText !== lastTopText) {
    tbName.textContent = nick;
    tbPlace.textContent = standingShown(myPlace) ? t('hud.place', { p: myPlace, n: seats }) : '';
    tbScore.textContent = `✦ ${score}/${SCORE_LIMIT}`;
    tbScore.classList.toggle('win', atLimit(need));
    tbDay.textContent = t('browser.day', { n: d });
    // digits only: the «до след. дня» caption is a static sibling node (#tbetacap),
    // so a narrow phone can drop the caption and keep the countdown.
    tbEta.textContent = eta;
    lastTopText = topText;
  }

  // Top bar = the five session resources (icon + amount). The donate currency (Суверены ◆)
  // is rendered separately on the status line right under this bar (see statusHtml above).
  const r = s.players[ME]?.resources ?? {};
  // Inline-SVG line icons (RES_SVG) — pixel-true to the mock, tinted via
  // currentColor. Name in `title` for hover/long-press.
  // Flow under the stock: the tested netIncome() (production − upkeep, per hour)
  // finally shown to the player. A resource with no stock AND no flow is dimmed —
  // it plays no part in the current match yet.
  const inc = game.income();
  const myArrears = s.players[ME]?.arrears ?? [];
  const MOBILE = game.mobile();
  // Как число на фишке говорит правду — `resourceChip.ts` (REFM-190): поток меньше
  // единицы округляется до ДЕСЯТОЙ (содержание даёт доли за час, и целое врало бы «0»),
  // фишка гаснет только когда пусто И не течёт, долг вытесняет скорость (при долге она
  // считает производство, которое уже не доходит), а телефон печатает скорость, как ПК.
  const chip = (icon: string, key: string) => {
    const stock = r[key] ?? 0;
    // Часы забега: в забеге приток — за минуту (решение владельца 2026-09-24).
    const flow = flowRounded(flowRate(inc[key] ?? 0));
    const flowTxt = flowShown(flow)
      ? `<em class="${flowSign(flow)}">${flowPrefix(flow)}${flowDigits(flow, kfmt)}${flowPer()}</em>`
      : '';
    const dead = chipDead(stock, flow) ? ' dead' : '';
    const short = chipShort(myArrears, key) ? ' short' : '';
    return `<span class="res${dead}${short}" title="${t(`hud.resource.${key}`)}" data-res="${key}"><i>${icon}</i><span class="rv"><b>${stockText(stock, MOBILE, kfmt)}</b>${short ? '<em class="dn">⚠</em>' : flowTxt}</span></span>`;
  };
  // Capsule icons = RES_SVG (line art traced from the mock; TECH_CUR keeps the text
  // glyphs for prose); capsule order follows the mock: coins, cube, sprout, bolt, chip.
  const hudHtml =
    chip(RES_SVG['credits']!, 'credits') +
    chip(RES_SVG['metal']!, 'metal') +
    chip(RES_SVG['food']!, 'food') +
    chip(RES_SVG['energy']!, 'energy') +
    chip(RES_SVG['microelectronics']!, 'microelectronics') +
    ((r.biomass ?? 0) > 0 || (inc.biomass ?? 0) !== 0 ? chip(RES_SVG['biomass']!, 'biomass') : '');
  if (hudHtml !== lastHudHtml) {
    patchPurse(hudHtml);
    lastHudHtml = hudHtml;
  }
  // Кого зовут значки внимания и куда ложится цифра — `attentionBadges.ts` (REFM-189):
  // ноль ПРЯЧЕТ значок (значок с «0» гонит игрока в пустоту), бой считается моим и когда
  // я его лишь ВИЖУ, а зеркало на гамбургере молчит при открытой панели — там свои значки.
  const msgBadge = document.getElementById('msgbadge');
  if (msgBadge) {
    msgBadge.style.display = countShown(unreadMsgs) ? '' : 'none';
    msgBadge.textContent = String(unreadMsgs);
  }
  const battles = myBattleCount(
    Object.values(s.battles),
    ME,
    known,
    (b) => !!vision?.engaged.battles.has(b.id),
  );
  const alertText = String(battles);
  if (alertText !== lastAlertText) {
    alertBadge.style.display = countShown(battles) ? 'grid' : 'none';
    alertBadge.textContent = alertText;
    lastAlertText = alertText;
  }
  // collapsed rail mirrors unread/battle attention onto the hamburger, so notifications
  // still surface while the tool panel (with its per-tool badges) is closed.
  const railAlertText = railBadge(
    attentionTotal(battles, unreadMsgs),
    railEl.classList.contains('open'),
  );
  if (railAlertText !== lastRailAlert) {
    railAlert.style.display = railAlertText ? 'grid' : 'none';
    if (railAlertText) railAlert.textContent = railAlertText;
    lastRailAlert = railAlertText;
  }
  game.phoneBadges(battles, unreadMsgs); // те же значки на «Событиях» и «Ещё» телефона
}

// --- threat alert (THREAT-HUD): «враг у ваших рубежей» ------------------------
// The same fog-honest node-threat tripwire the Steward keys off (ST-3.1,
// scanNodeThreats), surfaced to the LIVE player: one note per (node, fleet)
// EPISODE — a camping fleet doesn't re-toast every step, a fresh approach after
// the episode ended alerts again (the radarMemory pattern). Throttled to once
// per GAME-HOUR bucket: solo advances s.time every frame, so a raw s.time guard
// would be a no-op and the coverage flood would run per frame; threats move on
// multi-hour ETAs, so an hourly sweep loses nothing. NET is naturally
// fog-clean — the fogged state only ever holds fleets the player may see.
const threatMemory = new Set<string>();
let threatScanAt = -1;
/** Флоты главных сил, о курсе которых к докам союзник уже доложил (глава VI, PVR-8.4). */
const refugeReported = new Set<string>();
export function updateThreatAlerts(): void {
  const s = game.world();
  const ME = game.me();
  // РЕЖИМ звонка — `threatAlerts.ts` (REFM-169): дроссель на игровой час (соло двигает
  // время каждый кадр, поэтому сторож «время изменилось» пустой), один звонок на эпизод
  // «мир + флот», забывание кончившегося и правило «срок обещается, только пока не истёк».
  if (!threatScanDue(hourBucket(s.time, HOUR), threatScanAt)) return;
  threatScanAt = hourBucket(s.time, HOUR);
  if (!threatsHeard(s.players[ME]?.status)) return;
  const c = ctx(s.time, s);
  const identified = identifiedNodes(s, ME, data);
  const sightings: ThreatSighting[] = [];
  for (const p of Object.values(s.planets)) {
    if (p.owner !== ME) continue;
    for (const th of scanNodeThreats(s, p.id, ME, c, identified)) {
      sightings.push({ node: p.id, fleetId: th.fleetId, kind: th.kind, eta: th.eta });
    }
  }
  for (const a of threatAlerts(sightings, s.time, threatMemory)) {
    note(
      a.left === null
        ? t('threat.here', { node: game.placeName(a.node) })
        : t('threat.incoming', { node: game.placeName(a.node), dur: stewFmtDur(a.left) }),
      a.node,
    );
  }
  // Глава VI (PVR-8.4, §8.7): союзник докладывает наблюдаемую угрозу месту эвакуации —
  // видимый курс главных сил к найденным докам, один раз на флот (`refugeThreat.ts`). Чип
  // «⬡ Союзник» мигает: в окне связи ждёт его предложение охранять доки (PVR-8.5).
  const toRefuge = refugeThreats(s, ME, fleetSeen, refugeReported);
  for (const th of toRefuge) refugeReported.add(th.fleetId);
  if (toRefuge.length > 0) {
    note(t('refuge.threat'), toRefuge[0]!.at);
    game.pulseAlly();
  }
}
/** Смена матча: id миров и флотов повторяются, и старый эпизод не должен глушить новую тревогу. */
export function resetThreatAlerts(): void {
  threatMemory.clear(); // node ids repeat across matches — a stale episode must not mute a real alert
  threatScanAt = -1;
  refugeReported.clear(); // id флотов карты повторяются от забега к забегу
}

// --- speedbar -----------------------------------------------------------------------------
let restartBtn: HTMLElement; // speedbar restart (shown in the no-bots solo sandbox)
let restartSep: HTMLElement;
let spdCtl: HTMLElement; // speedbar time-control group
let speedbarEl: HTMLElement;
/** Множитель «×N», на который настроена пара «играть / ускорить», — его пишет кнопка скорости
 *  телефона (UIX-3.2): у ряда нет чипа на каждый множитель настройки матча (×2, ×5, ×300). */
let timeMult = 1;
/** ▶▶▶ дев-забега; в игроцкой сборке кнопки нет. */
let devFastBtn: HTMLElement | null = null;

/** Подсветить кнопку полосы, темп которой идёт сейчас. */
function markSpeed(): void {
  for (const x of Array.from(document.querySelectorAll('[data-speed]')))
    x.classList.toggle('on', Number((x as HTMLElement).dataset.speed) === game.speed());
}

// Map a setup time-flow multiplier (×1/×2/×5/×10) onto the speedbar and start running at
// it. ×1 is true wall-clock — 1 game-hour per real hour — matching the real-time MMO
// design; each higher multiplier accelerates from there (×5 = 5 game-hours per real hour,
// …), and fast-forward (▶▶) runs at 3× the chosen play. The play/fast buttons carry the
// live values so pause→resume returns to the chosen pace, not the default.
export const PLAY_BASE = 1 / 3600; // game-hours per real second; 1/3600 ⇒ 1 game-hour per real hour (×1 = wall-clock)
/**
 * Настроить пару «играть / ускорить». `fastMult` отдельным параметром, потому что у
 * ЗАБЕГА своё отношение между ними: обычной партии ускорение втрое только помогает, а
 * забег на нём проскакивает нижнюю границу прохождения (PVR-2.2). По умолчанию — прежние
 * втрое, так что для всех остальных вызовов ничего не изменилось.
 */
export function applyTimeSpeed(mult: number, fastMult: number = mult * 3): void {
  const play = PLAY_BASE * mult;
  timeMult = mult;
  const playBtn = $('spd-play');
  const fastBtn = $('spd-fast');
  if (playBtn) playBtn.dataset.speed = String(play);
  if (fastBtn) fastBtn.dataset.speed = String(PLAY_BASE * fastMult);
  game.setSpeed(play);
  markSpeed();
  for (const x of Array.from(document.querySelectorAll('[data-mult]')))
    x.classList.toggle('on', Number((x as HTMLElement).dataset.mult) === mult);
}

/** Кадр полосы скорости: перезапуск, управление временем и кнопка скорости телефона. */
export function renderSpeedbar(): void {
  // Player build: the button (and the skirmish it restarts into) doesn't exist.
  const restartShown = !__PLAYER_BUILD__ && speedbarRestartShown(netWorld, game.aiSeats());
  if (!__PLAYER_BUILD__) {
    const restart = displayOf(restartShown);
    restartBtn.style.display = restart;
    restartSep.style.display = restart;
  }
  // Правило 6 (`matchExits.ts`): в забеге полоса несёт только его темп — ▶ и ▶▶.
  const run = game.toolsHidden();
  speedbarEl.classList.toggle('spd-run', run);
  if (devFastBtn) devFastBtn.hidden = !(run && sectorDevActive);
  const showSpdCtl = displayOf(
    timeControlsShown(pcUi(), game.speedControl(), netWorld, run),
  );
  if (spdCtl && spdCtl.style.display !== showSpdCtl) spdCtl.style.display = showSpdCtl;
  const showBar = displayOf(speedbarShown(pcUi(), showSpdCtl === '', restartShown));
  if (speedbarEl && speedbarEl.style.display !== showBar) speedbarEl.style.display = showBar;
  // Телефон прячет полосу за кнопкой скорости (UIX-3.2): кнопка есть, пока есть управление
  // временем; на ней темп по скорости мира и множитель партии (в забеге множителей нет).
  const devRate = devFastBtn && !devFastBtn.hidden ? Number(devFastBtn.dataset.speed) : undefined;
  game.phoneSpeed().sync(
    game.mobile() && game.inMatch() && showSpdCtl === '' && showBar === '',
    tempoOf(game.speed(), {
      play: Number($('spd-play').dataset.speed),
      fast: Number($('spd-fast').dataset.speed),
      dev: devRate,
    }),
    run ? null : timeMult,
  );
}

/** Поднять полосу: хуки игры, узлы шапки и обработчики. Зовётся из `main.ts` один раз. */
export function initTopBar(host: TopBarHost): void {
  game = host;
  // Досье Роя.
  swarmDossierWin = $('swarm-dossier');
  swarmDossierDesktop = window.matchMedia?.(
    '(min-width:900px) and (hover:hover) and (pointer:fine)',
  );
  // Входы в досье на телефоне (заказ владельца 2026-09-24): пункт гамбургера и язычок у
  // правого края. Кнопка в строке статуса снята — на телефоне её обрезало на «Досье Р…».
  railDossier = $('rail-dossier');
  swarmTab = $('swarm-tab');
  railDossier.addEventListener('click', () => openSwarmDossier(railDossier));
  swarmTab.addEventListener('click', () => openSwarmDossier(swarmTab));
  $('swarm-dossier-close').addEventListener('click', closeSwarmDossier);
  swarmDossierFolded = (() => {
    try {
      return localStorage.getItem(SWARM_DOSSIER_FOLD_KEY) === '1';
    } catch {
      return false;
    }
  })();
  $('swarm-dossier-fold').addEventListener('click', () => {
    if (!swarmDossierPinned) return;
    swarmDossierFolded = !swarmDossierFolded;
    try {
      localStorage.setItem(SWARM_DOSSIER_FOLD_KEY, swarmDossierFolded ? '1' : '0');
    } catch {
      /* хранилище недоступно — свёрнутость проживёт до перезагрузки */
    }
    applySwarmDossierFold();
  });
  // Мир в карточке силы — ссылка: камера едет туда. На телефоне панель закрывает карту,
  // поэтому после перехода она уступает место тому, ради чего игрок нажал.
  $('swarm-dossier-body').addEventListener('click', (e) => {
    const node = (e.target as Element).closest<HTMLElement>('[data-jump]')?.dataset.jump;
    if (!node) return;
    jumpToPing(node);
    if (!swarmDossierPinned) closeSwarmDossier();
  });

  // Строка статуса рисуется двумя частями — часы и остальное (`build.mjs`, обе части
  // `display: contents`). Между ними стояла пауза забега (`YAG-6.2`); по решению владельца
  // 2026-09-24 она живёт в полосе скорости рядом с ▶ и ▶▶ — «там ей логичнее находиться».
  devlineHead = $('devline-head');
  devlineTail = $('devline-status');
  $('devline').addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-solo-play]')) {
      if (soloSaveActive && !NET) {
        game.setSpeed(Number($('spd-play').dataset.speed));
        game.restartRealClock();
        markSpeed();
      }
      return;
    }
    if ((event.target as Element).closest('[data-solo-save]')) {
      saveSolo(true);
      return;
    }
    if ((event.target as Element).closest('[data-donate]')) {
      toast(t('donate.where'));
      return;
    }
    if ((event.target as Element).closest('[data-missions]')) {
      game.toggleMissions();
      return;
    }
    if ((event.target as Element).closest('[data-ally-open]')) {
      game.openAlly();
      return;
    }
  });

  purse = $('purse');
  purseTpl = document.createElement('template');
  // Tap a resource chip → open the resource card (RC-1): stock, net flow, breakdown,
  // and a button to open the market on that resource.
  purse.addEventListener('click', (ev) => {
    const el = (ev.target as Element).closest('[data-res]') as HTMLElement | null;
    if (!el) return;
    game.openResource(el.dataset.res!);
  });
  // top-bar row 1: nick + live standing (left), victory chip (gap), day card (right)
  tbName = $('tbname');
  tbPlace = $('tbplace');
  tbScore = $('tbscore');
  tbDay = $('tbday');
  tbEta = $('tbeta');
  // Tap the ✦ score chip → a plain-words breakdown of how the score is built and how
  // the match ends (the victory rule is otherwise invisible mid-match).
  $('top').addEventListener('click', (ev) => {
    if (!(ev.target as Element).closest('.dstat')) return;
    const s = game.world();
    const ME = game.me();
    const mine = Object.values(s.planets).filter((p) => p.owner === ME);
    const worlds = mine.filter((p) => (p.kind ?? 'planet') === 'planet').length;
    const score = Math.round(s.match?.scores?.[ME]?.total ?? 0);
    note(
      t('hud.score.tip', {
        score,
        limit: game.scoreLimit(),
        w: worlds,
        s: mine.length - worlds,
      }),
    );
  });
  alertBadge = $('alertbadge');
  railEl = $('rail');
  railAlert = $('railalert');

  // Полоса скорости.
  restartBtn = $('restart');
  restartSep = $('restart-sep');
  spdCtl = $('spd-ctl');
  speedbarEl = $('speedbar');
  for (const b of Array.from(document.querySelectorAll('[data-speed]'))) {
    b.addEventListener('click', () => {
      // Пауза забега — через его правило (`YAG-6.2`): оно помнит темп для продолжения, а уход
      // со страницы и пауза площадки говорят с тем же правилом. «‖» на паузе продолжает.
      if (b.id === 'spd-pause' && game.runPauseShown()) {
        game.runPauseEvent('toggle');
        return;
      }
      game.setSpeed(Number((b as HTMLElement).dataset.speed));
      markSpeed();
    });
  }
  // Pace chips (×1/×10/×50): retune the play/fast pair mid-match and start running at
  // the new multiplier — the same mapping the setup screen launches with.
  for (const b of Array.from(document.querySelectorAll('[data-mult]'))) {
    b.addEventListener('click', () => applyTimeSpeed(Number((b as HTMLElement).dataset.mult)));
  }
  // ▶▶▶ дев-забега (заказ владельца 2026-09-24) — свой постоянный темп: пара «играть /
  // ускорить» его не трогает. В игроцкой сборке кнопки нет вовсе (`<!--dev-only-->`).
  devFastBtn = document.getElementById('spd-dev');
  if (devFastBtn) devFastBtn.dataset.speed = String(PLAY_BASE * RUN_SPEED_DEV);
  // Restart → back to the skirmish setup (bot selection). The speedbar button serves the
  // no-bots sandbox; the end-banner button (delegated) serves a finished bot match.
  // Player build: the button is stripped with the rest of the time controls (no skirmish).
  if (!__PLAYER_BUILD__) restartBtn.addEventListener('click', () => game.restart());
}
