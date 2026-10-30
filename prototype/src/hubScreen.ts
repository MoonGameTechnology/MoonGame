import { connectToMatch } from './matchJoin';
/**
 * Хозяин хаба (REFM-220): показ хаба и его вкладки, карьера по позывному,
 * экраны вкладок (друзья, рейтинги, арсенал, аукцион, магазин, новости,
 * снабжение, кошелёк, профиль, корпорация), портрет и сверка опыта командира с сервером,
 * вход в хаб и его кнопки.
 *
 * Экраны вкладок модуль создаёт в {@link initHubScreen} и отдаёт как `export let`: `main.ts`
 * и окна партии читают их живой привязкой (арсенал — верфь, корпорация — рельса партии).
 * Поля позывного и сервера, строку статуса экрана входа, его показ, обозреватель партий,
 * выход из партии, темп и проверку удаления аккаунта модуль получает хуками: импорт из
 * `main.ts` был бы циклом.
 */
import { refusalText as errText } from '../../decisions/refusalText';
import { note } from './eventFeed';
import { authorizedBase } from '../../decisions/hubAuth';
import { httpBase } from '../../decisions/matchQuery';
import { resolveBase } from '../../decisions/serverAddress';
import { tokenFor } from '../../decisions/sessionStore';
import { t } from '../../localization/runtime';
import { parseAppearance } from '../../packages/protocol/src/playerProfile';
import { authMode, probeAuthMode, sessionToken, signOutEverywhere } from './accountSession';
import { initArsenal } from './arsenalScreen';
import { syncCommanderXp } from './commanderSync';
import { initCorp } from './corpScreen';
import { detach } from './detach';
import { initFriends } from './friendsScreen';
import { maybeIntro, openCodex } from './helpCenter';
import { initHubWallet } from './hubWallet';
import { inviteTargets, joinByNumber, refreshMyMatches } from './matchBrowser';
import { avaMatchId } from '../../packages/protocol/src/ava';
import { leaveMatch, startProvingGround } from './matchLifecycle';
import { type MetaState, parseMetaState } from './meta';
import { initMetaEconomy } from './metaEconomyScreen';
import { initMetaMarket } from './metaMarketScreen';
import { initNews } from './newsScreen';
import { readRaw, writeRaw } from './prefs';
import { PORTRAITS } from './profileArt';
import { initProfile } from './profileScreen';
import { initRank } from './rankScreen';
import { initMedalRewards } from './medalRewards';
import { initRegistrationReward } from './registrationReward';
import { initTutorialMedal } from './tutorialMedal';
import { openSectorZero } from './sectorZeroShell';
import { openSetup } from './setupScreen';
import { initShop } from './shopScreen';
import { fillWelcome, showStage, suggestCallsign } from './signInPages';
import { refreshHubDoor, restoreSolo, saveSolo, soloSaveActive } from './soloCheckpoint';

declare const __SECTOR_ZERO_ONLY__: boolean;

/** Что хабу нужно от игры. Поля экрана входа, темп и выход живут в `main.ts`. */
export interface HubScreenHost {
  /** Позывной из поля экрана входа, как набран. */
  nick(): string;
  /** Записать позывной в поле. */
  setNick(nick: string): void;
  /** Адрес сервера из поля, как набран. */
  serverField(): string;
  /** Сервер и позывной из полей; `null` — не заданы (строка статуса уже сказала). */
  resolveServer(): { base: string; nick: string } | null;
  /** Строка статуса экрана входа. */
  status(text: string): void;
  /** Показать или скрыть экран входа. */
  showConnect(show: boolean): void;
  /** Открыть обозреватель партий. */
  enterBrowse(): void;
  /** Мир встаёт: темп 0 (одиночная партия сохранена перед хабом). */
  halt(): void;
  /** Перечитать, может ли сервер удалить аккаунт. */
  refreshAccountDeletion(): Promise<void>;
}

let game: HubScreenHost;
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

// --- meta-shell hub: post-login home + bottom nav (docs/main-menu.md) -------
// After identity you land on the hub (home + PLAY + bottom nav), not the raw match
// list. The nav routes into the existing flow: "Игры"/"ИГРАТЬ" → the match browser
// (стадия 2 of #connect, untouched), «Корпорация» → вкладка `corpScreen.ts` (CORP-3), Ещё →
// настройки. Social sign-in is a guest stub (accounts AC-1.1) with a "скоро" note.
/** Узел хаба: виден ли хаб, решает его `display`. */
export let hubEl: HTMLElement;

/** Строка заметок хаба: сюда пишут вкладки, обозреватель и вход. */
export let hubNote: HTMLElement;

let registrationReward: ReturnType<typeof initRegistrationReward> | null = null;

export function showHub(show: boolean): void {
  if (!show) registrationReward?.close();
  if (!show) arsenal?.close();
  if (!show) shop?.close();
  if (!show) corp?.hideHub();
  // Карточка справочника, открытая в партии (её кнопки строят на выбранном мире), в хаб не переходит.
  if (show) document.getElementById('codex')?.classList.remove('show');
  hubEl.style.display = show ? 'flex' : 'none';
  // Справочник, открытый из хаба (карточка арсенала, плитка «Справка»), встаёт ПОВЕРХ хаба:
  // в партии его слой ниже, а у хаба выше, и раньше он открывался за ним (build.mjs).
  document.body.classList.toggle('hub-open', show);
}

const HUB_PANELS: Record<string, string> = {
  home: 'hp-home',
  rank: 'hp-rank',
  friends: 'hp-friends',
  arsenal: 'hp-arsenal',
  auction: 'hp-auction',
  supply: 'hp-supply',
  shop: 'hp-shop',
  corp: 'hp-corp',
  community: 'hp-community',
  more: 'hp-more',
};

let currentHubTab = 'home'; // the visible hub panel, so an async XP sync can repaint it
/** Панели, в которые входят из «Ещё»: пока открыта любая, подсвечена вкладка «Ещё» (UIX-10.1). */
// prettier-ignore
const HUB_UNDER_MORE: ReadonlySet<string> = new Set(['auction', 'rank', 'friends', 'supply', 'shop', 'community']);

export function hubTab(tab: string): void {
  hubNote.textContent = '';
  hubWallet?.render();
  if (tab === 'games') {
    showHub(false);
    game.showConnect(true);
    game.enterBrowse(); // hand off to the existing match browser
    return;
  }
  // Retired tabs and stale links return to the home panel instead of a blank hub.
  if (!Object.hasOwn(HUB_PANELS, tab)) tab = 'home';
  currentHubTab = tab;
  // ADDR-4: свои партии — главный экран, а не вкладка обозревателя, поэтому лента
  // переспрашивается при каждом заходе домой (день и число игроков успевают устареть).
  if (tab === 'home') detach('хаб: свои партии', refreshMyMatches());
  // Кошелёк Варрантов в шапке (UIX-10.2) — тихо: гостю и при сбое сервера остаётся прежнее число.
  if (tab === 'home' && metaMarket) detach('хаб: кошелёк аукциона', metaMarket.sync());
  // Суверены на той же плашке: баланс знает только сервер, гостю остаётся знак без числа.
  if (tab === 'home' && shop) detach('хаб: кошелёк Суверенов', shop.sync());
  if (tab === 'home' && news) detach('хаб: лента новостей', news.refresh());
  if (tab !== 'home') news?.close(); // the feed sheet lives over the home panel
  if (tab === 'friends' && friends) detach('хаб: друзья', friends.refresh()); // roster + presence are server truth
  if (tab === 'rank' && rank) detach('хаб: рейтинг', rank.refresh()); // places are computed server-side (RANK-1)
  if (tab === 'arsenal' && arsenal) detach('хаб: арсенал', arsenal.refresh()); // cache paints now, server refresh trails
  if (tab !== 'arsenal') arsenal?.close(); // the phone sheet lives over the hub, not in the tab
  if (tab === 'auction' && metaMarket) detach('хаб: аукцион', metaMarket.refresh());
  if (tab === 'supply' && metaEconomy) detach('хаб: снабжение', metaEconomy.refresh());
  if (tab === 'shop' && shop) detach('хаб: магазин', shop.refresh());
  if (tab !== 'shop') shop?.close(); // the phone sheet lives over the hub, like the arsenal's
  for (const [k, pid] of Object.entries(HUB_PANELS))
    $(pid).style.display = k === tab ? 'flex' : 'none';
  // CORP-3: the corporation tab paints after its panel is visible — the panorama centres by width.
  if (tab === 'corp') corp?.showHub();
  else corp?.hideHub();
  const navTab = HUB_UNDER_MORE.has(tab) ? 'more' : tab;
  for (const b of Array.from(document.querySelectorAll('.hub-tab')))
    b.classList.toggle('active', (b as HTMLElement).dataset.hub === navTab);
}

// --- «Друзья» — the account's roster (hub tab, FRIENDS-1) --------------------
// Экран живёт в `friendsScreen.ts`; здесь только доступ к серверу. Политика та же,
// что у «Арсенала»: вкладка ПЕРЕИСПОЛЬЗУЕТ сессию, которую уже добыл вход, но никогда
// не спрашивает пароль ради того, чтобы просто посмотреть — нет сервера, нет режима
// аккаунтов или нет сохранённой сессии читаются одинаково (гостевое состояние).
/**
 * Авторизованный адрес для вкладок хаба — ОДИН на все пять (`hubAuth.ts`, REFM-138).
 * Там же причины: три условия обязательны, режим аккаунтов пробуется у сервера, а ради
 * просмотра пароль не спрашивают — любой отказ это гостевое состояние.
 */
export async function hubAuthorizedBase(): Promise<{ base: string; token: string } | null> {
  const srv = game.resolveServer();
  if (srv) await probeAuthMode(srv.base); // проба режима — только когда есть у кого
  return authorizedBase(
    {
      server: srv,
      accountsMode: authMode === 'accounts',
      token: srv ? sessionToken(srv.base) : null,
    },
    httpBase,
  );
}

export let friends: ReturnType<typeof initFriends> | null = null;

export let rank: ReturnType<typeof initRank> | null = null;

// --- «Арсенал» — the account's persistent collection and its workshop (hub tab, ARS-5) ----
// The tab itself lives in `arsenalScreen.ts` (REFM-5); here it gets its hooks. Cache key is
// per callsign, like the meta store. `authorizedBase` encodes the tab's policy: it may reuse
// a session token a prior join already stashed, but must never prompt for a password just to
// LOOK at the collection — no server, no accounts or no stashed session all read the same way
// (the starter kit and a sign-in). Narrow = the tab is too narrow for the detail beside the
// list (the `@container arsenal` rule in build.mjs uses the same width), and then the detail
// opens as a sheet over the hub.
const ARSENAL_WIDE_MIN = 700;

export let arsenal: ReturnType<typeof initArsenal> | null = null;

export let metaMarket: ReturnType<typeof initMetaMarket> | null = null;

// «Магазин» (заказ владельца 2026-10-20): Суверены, премиум, модули и материалы за ◆.
// Единственное место покупок — Снабжение и Арсенал ведут сюда. Баланс ◆ и срок премиума
// приходят с ответом аккаунта: плашка хаба показывает число, чат помнит премиум по позывному
// (цвет шрифта — его бонус; сам срок проверяется по часам при каждом открытии настроек).
const SHOP_WIDE_MIN = 700;

const premiumKey = (): string => 'vd.premium.' + (game.nick().trim() || 'guest');

export let shop: ReturnType<typeof initShop> | null = null;

export let news: ReturnType<typeof initNews> | null = null;

/** Premium is running for this callsign, by the last account read on this device. */
export function premiumRunning(): boolean {
  return Number(readRaw(premiumKey()) ?? 0) > Date.now();
}

export let metaEconomy: ReturnType<typeof initMetaEconomy> | null = null;

export let hubWallet: ReturnType<typeof initHubWallet> | null = null;

function arsenalKey(): string {
  return 'vd.arsenal.' + (game.nick().trim() || 'guest');
}

export let profile: ReturnType<typeof initProfile> | null = null;

const medalsKey = (): string => 'vd.medals.' + (game.nick().trim() || 'guest');

export function profileKey(): string {
  return `vd.profile.${game.resolveServer()?.base ?? 'local'}.${game.nick().trim().toLowerCase() || 'guest'}`;
}

function readProfileAppearance(): unknown {
  try {
    return JSON.parse(readRaw(profileKey()) ?? 'null');
  } catch {
    return null;
  }
}

export function applyProfilePortrait(portrait?: number): void {
  if (__SECTOR_ZERO_ONLY__) return;
  const id = portrait ?? parseAppearance(readProfileAppearance())?.portrait;
  const src = id ? PORTRAITS[id - 1] : undefined;
  const avatar = document.getElementById('hubav');
  if (!avatar) return;
  if (!src) {
    avatar.textContent = playerEmblem();
    avatar.classList.remove('portrait');
    return;
  }
  const img = document.createElement('img');
  img.src = src;
  img.alt = t('profile.title');
  avatar.replaceChildren(img);
  avatar.classList.add('portrait');
}

export async function syncProfileAppearance(): Promise<void> {
  if (__SECTOR_ZERO_ONLY__) return;
  const key = profileKey();
  const srv = game.resolveServer();
  if (!srv) return;
  const session = await hubAuthorizedBase();
  if (!session || tokenFor(localStorage, srv.base, game.nick().trim()) !== session.token) return;
  try {
    const response = await fetch(`${session.base}/profiles`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    if (!response.ok) return;
    const raw = (await response.json()) as { portrait?: unknown; slots?: unknown };
    const appearance = parseAppearance({ portrait: raw.portrait, slots: raw.slots });
    if (!appearance || key !== profileKey()) return;
    writeRaw(key, JSON.stringify(appearance));
    applyProfilePortrait(appearance.portrait);
  } catch {
    /* Keep the previously saved portrait while offline. */
  }
}

// --- вход в хаб и зеркало аккаунтного XP ---------------------------------------

/** Accounts mode (EC-*): pull the DURABLE account XP into the local meta mirror, so
 *  the commander level/progress a player sees is account-backed and follows them to a
 *  new device — not the per-callsign localStorage that only lived in one browser. The
 *  server total is authoritative (it sums every credited match across devices); the
 *  per-match award still lands optimistically at checkEnd (same formula as the core's
 *  `data.rewards`, so they agree). Guest/nick mode has no account → keeps localStorage. */
export async function syncCommanderFromServer(): Promise<void> {
  const srv = game.resolveServer();
  if (!srv) return;
  await probeAuthMode(srv.base);
  if (authMode !== 'accounts') return;
  const session = sessionToken(srv.base);
  if (!session) return;
  try {
    const res = await fetch(`${httpBase(srv.base)}/commander/me`, {
      headers: { authorization: `Bearer ${session}` },
    });
    if (!res.ok) return;
    const cur = loadMeta();
    // Merging the two totals is `commanderSync.ts` (REFM-53): XP only ever grows, an
    // unreadable answer leaves the local figure alone, and only a real change repaints.
    const sync = syncCommanderXp(cur.xp, await res.json().catch(() => null));
    if (sync.changed) {
      saveMeta({ ...cur, xp: sync.xp });
      // Repaint the home panel after reconciling the cosmetic career profile.
      if (hubEl.style.display !== 'none' && currentHubTab === 'home') hubTab(currentHubTab);
    }
  } catch {
    // offline — the last mirrored total stays; a later login reconciles
  }
}

export function openHub(note = ''): void {
  if (soloSaveActive) {
    saveSolo();
    game.halt();
  }
  if (!game.nick().trim()) game.setNick(suggestCallsign());
  const nick = game.nick().trim();
  $('hub-name').textContent = nick || t('auth.commander');
  applyProfilePortrait();
  game.showConnect(false);
  showHub(true);
  hubTab('home');
  hubNote.textContent = note;
  refreshHubDoor(); // после позывного: пройденное обучение помнится по нику (`onboardKey`)
  detach('хаб: сверка командира с сервером', syncCommanderFromServer()); // account-backed XP → local mirror (accounts mode only)
  detach('хаб: портрет аккаунта', syncProfileAppearance());
  detach('account deletion capability', game.refreshAccountDeletion());
  if (registrationReward) detach('registration reward', registrationReward.show());
  // The tutorial claim goes first: its medal is then paid by the same hub entry.
  detach(
    'tutorial medal claim and medal rewards',
    (async () => {
      if (tutorialMedal) await tutorialMedal.claim();
      if (medalRewards) await medalRewards.claim();
    })(),
  );
}

// --- Commander career mirror: XP, cosmetic rank and local statistics --------
// Keep the existing storage key so old profiles retain their XP and career.
function metaKey(): string {
  return 'vd.meta.' + (game.nick().trim() || 'guest');
}
export function loadMeta(): MetaState {
  return parseMetaState(localStorage.getItem(metaKey()));
}
export function saveMeta(st: MetaState): void {
  localStorage.setItem(metaKey(), JSON.stringify(st));
}

// Player emblem — a cosmetic console crest the player picks in the main menu (hub) and
// wears in the in-match top-bar corner. Client-side only (localStorage) — never match
// state, never sent to the server. Falls back to the first glyph if unset/unknown.
const EMBLEMS = ['◆', '◇', '⬡', '⬢', '✦', '✧', '★', '⚛', '◉', '⌖', '❖', '⟡'];
export function playerEmblem(): string {
  const e = readRaw('void.emblem') ?? '';
  return EMBLEMS.includes(e) ? e : EMBLEMS[0]!;
}
export function applyEmblem(): void {
  const g = playerEmblem();
  const hubAv = document.getElementById('hubav');
  if (hubAv) {
    hubAv.textContent = g;
    hubAv.classList.remove('portrait');
  }
  if (!__SECTOR_ZERO_ONLY__) applyProfilePortrait();
  $('crestmark').textContent = g;
}
function setPlayerEmblem(g: string): void {
  if (!EMBLEMS.includes(g)) return;
  writeRaw('void.emblem', g);
  applyEmblem();
}

export let corp: ReturnType<typeof initCorp> | null = null;
/** Медаль за обучение — гид отдаёт ей пройденный урок (`guideFlow.ts`). */
export let tutorialMedal: ReturnType<typeof initTutorialMedal> | null = null;
let medalRewards: ReturnType<typeof initMedalRewards> | null = null;

/** Поднять хаб: узлы, вкладки и их экраны, профиль и награду за регистрацию.
 *  Зовётся из `main.ts` один раз, на месте прежней проводки. */
export function initHubScreen(host: HubScreenHost): void {
  game = host;
  hubEl = $('hub');
  hubNote = $('hub-note');
  if (!__SECTOR_ZERO_ONLY__)
    friends = initFriends({
      root: () => $('hp-friends'),
      authorizedBase: hubAuthorizedBase,
      openPlayer: (login) => profile?.open(login),
      myMatches: inviteTargets,
      joinMatch: joinByNumber,
    });
  // --- «Рейтинги» — commander + corporation boards (hub tab, RANK-1) ----------
  // Доски считает сервер (`leaderboardApi.ts`): своё место — по ВСЕЙ популяции, а не по
  // присланной странице, поэтому клиент его вывести и не смог бы. Доступ — та же
  // политика, что у «Друзей»: переиспользуем добытую входом сессию, пароль ради
  // просмотра не спрашиваем; нет сессии — гостевое состояние с причиной.
  if (!__SECTOR_ZERO_ONLY__)
    rank = initRank({
      root: () => $('hp-rank'),
      authorizedBase: hubAuthorizedBase,
      openPlayer: (login) => profile?.open(login),
    });
  if (!__SECTOR_ZERO_ONLY__)
    arsenal = initArsenal({
      root: () => $('hp-arsenal'),
      sheet: () => $('arsenal-sheet'),
      narrow: () => $('hp-arsenal').clientWidth < ARSENAL_WIDE_MIN,
      readCache: () => {
        try {
          return JSON.parse(localStorage.getItem(arsenalKey()) ?? 'null');
        } catch {
          return null;
        }
      },
      writeCache: (items) => localStorage.setItem(arsenalKey(), JSON.stringify(items)),
      openCodex,
      authorizedBase: hubAuthorizedBase,
      canSignIn: () => !!game.resolveServer() && authMode === 'accounts',
      signIn: () => {
        showHub(false);
        game.showConnect(true);
        showStage('welcome');
        fillWelcome((localStorage.getItem('void.nick') ?? '').trim(), 'show');
      },
      openAuction: () => hubTab('auction'),
      sell: (itemId) => {
        metaMarket?.focusSell(itemId);
        hubTab('auction');
      },
      openSeason: () => hubTab('supply'),
      openStore: (offerId) => {
        shop?.show('modules', offerId);
        hubTab('shop');
      },
      changed: async () => {
        await metaMarket?.sync();
      },
    });
  if (arsenal && typeof ResizeObserver !== 'undefined')
    new ResizeObserver(() => arsenal?.relayout()).observe($('hp-arsenal'));
  // EC-3 «Аукцион»: витрина торговли мета-предметами. Лоты и кошелёк живут на сервере,
  // поэтому кэша, как у арсенала, здесь нет — экран всегда спрашивает свежее.
  if (!__SECTOR_ZERO_ONLY__)
    metaMarket = initMetaMarket({
      root: () => $('hp-auction'),
      arsenal: () => arsenal?.items() ?? [],
      authorizedBase: hubAuthorizedBase,
      note: (message) => {
        hubNote.textContent = message;
      },
      changed: () => hubWallet?.render(),
      inventoryChanged: async () => {
        await arsenal?.refresh();
      },
    });
  if (!__SECTOR_ZERO_ONLY__)
    shop = initShop({
      root: () => $('hp-shop'),
      sheet: () => $('shop-sheet'),
      narrow: () => $('hp-shop').clientWidth < SHOP_WIDE_MIN,
      authorizedBase: hubAuthorizedBase,
      canSignIn: () => !!game.resolveServer() && authMode === 'accounts',
      signIn: () => {
        showHub(false);
        game.showConnect(true);
        showStage('welcome');
        fillWelcome((localStorage.getItem('void.nick') ?? '').trim(), 'show');
      },
      warrants: () => metaMarket?.balance() ?? 0,
      now: () => Date.now(),
      accountChanged: (view) => {
        if (view) writeRaw(premiumKey(), String(view.premiumUntil ?? 0));
        hubWallet?.render();
      },
      changed: async () => {
        await arsenal?.refresh();
        await metaMarket?.sync();
      },
    });
  if (shop && typeof ResizeObserver !== 'undefined')
    new ResizeObserver(() => shop?.relayout()).observe($('hp-shop'));
  // CORP-2 «Домой»: лента новостей. Экран — `newsScreen.ts`, решения — `decisions/newsFeed.ts`.
  // Ленту сервер отдаёт без входа, поэтому ей нужен только адрес; сессия хаба — для «Моей
  // корпорации», карточки корпорации и заявки.
  if (!__SECTOR_ZERO_ONLY__)
    news = initNews({
      column: () => $('news-col'),
      teaser: () => $('news-teaser'),
      sheet: () => $('news-sheet'),
      publicBase: () => {
        const step = resolveBase(game.serverField(), location.protocol === 'https:');
        return step.kind === 'ok' ? httpBase(step.base) : null;
      },
      authorizedBase: hubAuthorizedBase,
      note: (text) => {
        hubNote.textContent = text;
      },
      errText,
      openCorp: (tab) => {
        corp?.showSection(tab === 'hq' ? 'base' : 'battles');
        hubTab('corp');
      },
      now: () => Date.now(),
    });
  // Main-game supply has its own server-owned state; Sector Zero remains independent.
  if (!__SECTOR_ZERO_ONLY__)
    metaEconomy = initMetaEconomy({
      root: () => $('hp-supply'),
      authorizedBase: hubAuthorizedBase,
      changed: async () => {
        await arsenal?.refresh();
        await metaMarket?.sync();
      },
    });
  // Кошелёк главного экрана (UIX-10.2, заказ владельца 2026-10-01): Суверены — та же плашка с
  // «+», что в строке статуса партии; Варранты аукциона — плашкой, которая и есть дверь в аукцион.
  if (!__SECTOR_ZERO_ONLY__)
    hubWallet = initHubWallet({
      root: $('hubwallet'),
      // prettier-ignore
      wallet: () => ({ sovereigns: shop?.sovereigns() ?? null, warrants: metaMarket?.balance() ?? 0 }),
      donate: () => {
        shop?.show('sovereigns');
        hubTab('shop');
      },
      auction: () => hubTab('auction'),
    });
  // --- Профиль командира — the career dossier (docs/main-menu.md §4.2) ------------
  // Само досье живёт в `profileScreen.ts` (REFM-10); здесь только его хуки. Ключ кэша
  // медалей — по позывному, рядом с остальными ключами. `authorizedBase` кодирует ту же
  // политику, что у «Арсенала»: за паролем ради ПОСМОТРЕТЬ витрину не ходим.
  if (!__SECTOR_ZERO_ONLY__)
    profile = initProfile({
      root: () => $('profile'),
      identity: () => profileKey(),
      readAppearance: readProfileAppearance,
      writeAppearance: (value) => writeRaw(profileKey(), JSON.stringify(value)),
      appearanceChanged: applyProfilePortrait,
      view: () => {
        const st = loadMeta();
        return {
          nick: game.nick(),
          xp: st.xp,
          stats: st.stats,
          corp: (() => {
            const c = corp?.mine().corp;
            return c ? { name: c.name, influence: c.influence } : null;
          })(),
          sovereigns: shop?.sovereigns() ?? null,
        };
      },
      readCache: () => {
        try {
          return JSON.parse(localStorage.getItem(medalsKey()) ?? 'null');
        } catch {
          return null;
        }
      },
      writeCache: (value) => localStorage.setItem(medalsKey(), JSON.stringify(value)),
      authorizedBase: async () => {
        const srv = game.resolveServer();
        if (!srv) return null;
        const session = await hubAuthorizedBase();
        return session && tokenFor(localStorage, srv.base, game.nick().trim()) === session.token
          ? session
          : null;
      },
    });
  if (!__SECTOR_ZERO_ONLY__)
    registrationReward = initRegistrationReward({
      identity: profileKey,
      visible: () => hubEl.style.display !== 'none',
      authorizedBase: hubAuthorizedBase,
      changed: async () => {
        await Promise.all([syncProfileAppearance(), syncCommanderFromServer()]);
      },
    });
  // The tutorial medal: earned on this device per callsign, carried into the account profile.
  if (!__SECTOR_ZERO_ONLY__)
    tutorialMedal = initTutorialMedal({
      key: () => 'vd.medal.tutorial.' + (game.nick().trim() || 'guest'),
      authorizedBase: hubAuthorizedBase,
    });
  // Medal rewards (owner's order 2026-10-24): every reached degree of a profile medal pays
  // Sovereigns, Warrants and XP once; the window lists the grant, then XP and wallets re-read.
  if (!__SECTOR_ZERO_ONLY__)
    medalRewards = initMedalRewards({
      identity: profileKey,
      visible: () => hubEl.style.display !== 'none',
      authorizedBase: hubAuthorizedBase,
      changed: async () => {
        await Promise.all([syncCommanderFromServer(), shop?.sync(), metaMarket?.sync()]);
      },
    });
  // --- corporation cabinet (AVA-C1/C2) -----------------------------------------
  // Сам кабинет живёт в `corpScreen.ts` (REFM-11); здесь только его хуки: окно в партии
  // открывает рельса матча, а в хабе корпорация — своя вкладка (CORP-3, `hubTab('corp')`).
  // `authorizedBase` — та же политика, что у «Арсенала» и профиля; кэша сознательно нет.
  if (!__SECTOR_ZERO_ONLY__)
    corp = initCorp({
      root: () => $('corp'),
      head: () => $('corphd'),
      tabs: () => $('corptabs'),
      body: () => $('corpbody'),
      note,
      errText,
      onIntro: maybeIntro,
      authorizedBase: hubAuthorizedBase,
      hub: {
        root: () => $('hp-corp'),
        sheet: () => $('corp-sheet'),
        note: (text) => {
          hubNote.textContent = text;
        },
        canSignIn: () => !!game.resolveServer() && authMode === 'accounts',
        signIn: () => {
          showHub(false);
          game.showConnect(true);
          showStage('welcome');
          fillWelcome((localStorage.getItem('void.nick') ?? '').trim(), 'show');
        },
        // CORP-14: стиль базы покупают в магазине, на вкладке «Стили».
        openShop: (style) => {
          shop?.show('styles', style);
          hubTab('shop');
        },
        openMarket: () => hubTab('auction'),
        openBattle: (matchupId) => connectToMatch(avaMatchId(matchupId)),
      },
    });
  // hub interactions
  $('hub-play').addEventListener('click', () => hubTab('games'));
  // Single-player entry from the hub home — offline skirmish vs bots (both builds).
  $('hub-solo').addEventListener('click', () => {
    leaveMatch();
    showHub(false);
    openSetup('hub');
  });
  $('hub-solo-continue').addEventListener('click', restoreSolo);
  $('hub-sector-zero').addEventListener('click', () => openSectorZero());
  $('hub-proving-ground').addEventListener('click', () => startProvingGround());
  $('hub-msg').addEventListener('click', () => {
    hubNote.textContent = t('hub.messages.soon');
  });
  $('hub-logout').addEventListener('click', async () => {
    // «Сменить командира» must really switch identity: drop this server's session so
    // the next sign-in authenticates the NEW callsign instead of replaying the old JWT.
    const srv = game.resolveServer();
    if (srv) {
      const result = await signOutEverywhere(srv.base);
      if (result === null) return;
      if (!result) {
        hubNote.textContent = t('auth.logout.failed');
        return;
      }
    }
    leaveMatch();
    game.status('');
    showHub(false);
    game.showConnect(true);
    showStage('welcome');
  });
  for (const b of Array.from(document.querySelectorAll('.hub-tab'))) {
    b.addEventListener('click', () => hubTab((b as HTMLElement).dataset.hub ?? 'home'));
  }
  // Дополнительные разделы открываются из «Ещё», сохраняя пять вкладок нижней навигации.
  document.getElementById('hub-rank')?.addEventListener('click', () => hubTab('rank'));
  document.getElementById('hub-friends')?.addEventListener('click', () => hubTab('friends'));
  document.getElementById('hub-auction')?.addEventListener('click', () => hubTab('auction'));
  document.getElementById('hub-supply')?.addEventListener('click', () => hubTab('supply'));
  document.getElementById('hub-shop')?.addEventListener('click', () => hubTab('shop'));
  document.getElementById('hub-community')?.addEventListener('click', () => hubTab('community'));
  for (const tile of Array.from(document.querySelectorAll('#hp-more .hub-tile[data-more]'))) {
    tile.addEventListener('click', () => {
      // The tile's own label span is already localized (localizeStaticDom ran at boot);
      // read IT, not the Russian-only data-more attribute, so the toast matches the UI language.
      const label =
        tile.querySelector('[data-i18n]')?.textContent ?? (tile as HTMLElement).dataset.more ?? '';
      hubNote.textContent = t('soon.generic', { what: label });
    });
  }
  // The hub avatar now opens the account portrait and medal editor.
  const emblemPick = document.getElementById('emblempick');
  document.getElementById('hubav')?.addEventListener('click', () => profile?.open());
  // Both the portrait and identity strip open the same saved profile.
  document.querySelector('#hub .hub-who')?.addEventListener('click', () => profile?.open());
  document
    .getElementById('ep-close')
    ?.addEventListener('click', () => emblemPick?.classList.remove('show'));
  emblemPick?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.id === 'emblempick') {
      emblemPick.classList.remove('show'); // backdrop tap closes
      return;
    }
    const cell = t.closest('.ep-cell') as HTMLElement | null;
    if (cell?.dataset.emblem) {
      setPlayerEmblem(cell.dataset.emblem);
      emblemPick.classList.remove('show');
    }
  });
  // mirror the chosen emblem into the top-left corner + the hub avatar
  applyEmblem();
}
