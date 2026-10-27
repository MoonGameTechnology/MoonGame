import { jsonlTail, tailCount } from '../packages/server/src/jsonlTail';
import { MemoryRegistrationRewardStore, PostgresRegistrationRewardStore, type RegistrationRewardStore } from '../packages/server/src/registrationRewardStore';
import { registerArsenalApi } from '../packages/server/src/arsenalApi';
import { MemoryDropStore } from '../packages/server/src/store';
import { MetaEconomy } from '../packages/server/src/metaEconomy';
import { loadMetaEconomyCatalog } from '../packages/server/src/metaEconomyCatalog';
import { registerMetaEconomyApi } from '../packages/server/src/metaEconomyApi';
import { MemoryMetaEconomyStore, PostgresMetaEconomyStore, type MetaEconomyStore } from '../packages/server/src/metaEconomyStore';
import { createMetaRewardDelivery } from '../packages/server/src/metaEconomyDelivery';
import { commerceOffers } from '../packages/server/src/commerceCatalog';
import { registerMetaCommerce } from '../packages/server/src/metaCommerce';
import { loadAvaMaps, loadDropTables, loadStarterArsenal } from '../packages/server/src/scenario';
import { arsenalSnapshotOf, grantStarterArsenal } from '../packages/server/src/arsenal';
import { initializeOrdinaryArsenal, syncAccountArsenal } from '../packages/server/src/mainGameArsenal';
import { PostgresArsenalStore, type ArsenalStore } from '../packages/server/src/store';
import { corporateEndpoint, registerCorporateGateway, registerCorporateMaintenance } from '../packages/server/src/corporateTransport';
import { corporateRemote } from '../packages/server/src/corporateRemote';
import { securityAuditFromEnv } from '../packages/server/src/securityAudit';
import { readAssetDir } from '../packages/server/src/staticAssets';
import { recoveryMailer } from '../scripts/recoveryMailer';
import { prepareRuntimeDatabase } from '../packages/server/src/databaseSecurity';
import { checkProductionReadiness } from '../packages/server/src/serverConfig';
import { registerCorpApi } from '../packages/server/src/corpApi';
import { CorpService } from '../packages/server/src/corpService';
import { MemoryCorpStore, PostgresCorpStore, type CorpStore } from '../packages/server/src/store';
import { MemoryAnnouncementStore, MemoryAvaFeedStore, PostgresAnnouncementStore, PostgresAvaFeedStore, type AnnouncementStore, type AvaFeedStore } from '../packages/server/src/store';
import { registerNewsApi } from '../packages/server/src/newsApi';
// CORP-5: corporation battles on the players' host — the same AvA slice as the production
// entry (`packages/server/src/main.ts`): challenges, the roster, the battle room, its result,
// medals and the corp-warehouse handouts.
import { MemoryAvaChallengeStore, MemoryAvaResultStore, MemoryAvaRosterStore, MemoryAvaSessionStore, MemoryCorpRentStore, MemoryMedalStore, PostgresAvaChallengeStore, PostgresAvaResultStore, PostgresAvaRosterStore, PostgresAvaSessionStore, PostgresCorpRentStore, PostgresDropStore, PostgresMedalStore, type AvaChallengeStore, type AvaResultStore, type AvaRosterStore, type AvaSessionStore, type CorpRentStore, type DropStore, type MedalStore } from '../packages/server/src/store';
import { AvaService } from '../packages/server/src/avaService';
import { MedalService } from '../packages/server/src/medalService';
import { loadMedalCatalog } from '../packages/server/src/medalCatalog';
import { registerAvaApi, registerAvaFeed } from '../packages/server/src/avaApi';
import { registerMedalApi } from '../packages/server/src/medalApi';
import { AvaOrchestrator, avaDeniedAction, isAvaMatchId, type AvaSessionSpec } from '../packages/server/src/avaOrchestrator';
import { createAvaSweeps } from '../packages/server/src/avaSweeps';
import { CorpArsenalService } from '../packages/server/src/corpArsenalService';
import { registerCorpArsenalApi } from '../packages/server/src/corpArsenalApi';
import { createCorporateServices } from '../packages/server/src/corporateTransactions';
import { declareAvaWar } from '../packages/server/src/serverWiring';
import { salvageFromEvents } from '../packages/server/src/dropRoller';
import { DEFAULT_MAP_ID, MAP_IDS, mapPreset, victoryFor, type MapId } from './src/mapCatalog';
import { registerProfileApi } from '../packages/server/src/profileApi';
import { settleMedalRewards } from '../packages/server/src/medalRewards';
// UIX-4.4 (часть 1): push до игроков — тот же приёмник подписки и та же рассылка «своё и
// срочное», что у канонического хоста; без VAPID в окружении не монтируется ничего.
import { registerPushApi } from '../packages/server/src/pushApi';
import { configureWebPush, sendPush, vapidFromEnv } from '../packages/server/src/push';
import { createPushDispatcher } from '../packages/server/src/pushDispatch';
import { MemoryPushStore, PostgresPushStore, type PushStore } from '../packages/server/src/store';
import { MemoryPlayerActivityStore, PostgresPlayerActivityStore } from '../packages/server/src/playerActivity';
import { registerPlayerActivityApi } from '../packages/server/src/playerActivityApi';
import { MemoryProfileStore, PostgresProfileStore, type ProfileStore } from '../packages/server/src/profileStore';
import { creditProfileMatch } from '../packages/server/src/profileCredit';
import { MemoryBotRosterStore, PostgresBotRosterStore, type BotRosterStore, type BotAssignment, type BotIdentity } from '../packages/server/src/botRoster';
import { botMatchLimit, startBotArrivals, botPopulationConfig, prepareBotPopulation, recoverBotMatch, recoverBotPopulation, settleBotMatch } from '../packages/server/src/botPopulation';
import { StaggeredAi } from './src/aiScheduler';
import { aiOrderSlices } from './src/aiOrderSlices';
import { botAcceptsOffer, botBehaviorOrders, botStyle } from './src/botBehavior';
import { botSocialAvailable, createBotSocial } from '../packages/server/src/botSocial';
import { botChatText } from '../scripts/botChatText';
import type { Action, DomainEvent } from '../packages/shared-core/src/index';
import { playablePlayerIds } from '../packages/shared-core/src/state/playableSeats';
// Serves the prototype's OWN world over WebSocket so two browsers — or two phones
// running the APK — can play the same session against one authoritative core.
//
//   pnpm dev:proto-server                          # 127.0.0.1:8788
//   HOST=0.0.0.0 PORT=8788 pnpm dev:proto-server   # reachable on the LAN
//   (then expose it with a tunnel — see docs/multiplayer.md — for a remote friend)
//
// Throwaway dev harness, like the prototype itself: built by esbuild
// (netserver.mjs), ESLint-ignored, and never typechecked. It reuses the
// prototype's exact `kernel` + `data` + `newGame()`, so the world the server
// hosts is byte-identical to the one the client already knows how to draw — the
// client's `MAP` lines up 1:1 with the server's planets and the renderer needs
// no changes. This is NOT the Stage-3 server: state lives in memory (a restart
// loses the match) and the `?player=` handshake is unauthenticated.
import { readFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import pgPkg from 'pg';
import {
  MatchRoom,
  MatchRegistry,
  sessionMeta,
  type MatchMeta,
  freeMatchId,
  pveOrders,
  MetricsAggregator,
  DailyJsonl,
  analyticsActorFromEnv,
  journalRecord,
  registerTelemetryApi,
  type TelemetryStats,
  createMultiplayerServer,
  wsLimitsFromEnv,
  tlsFromEnv,
  registerBrowserApi,
  registerMatchApi,
  registerSeatsApi,
  startClockDriver,
  HEARTBEAT_MS,
  type ClockDriverHandle,
  MemoryAccountStore,
  MemoryCommanderStore,
  MemoryMatchStore,
  MemoryReceiptStore,
  MemoryFriendStore,
  MemoryUserStore,
  PostgresAccountStore,
  PostgresCommanderStore,
  PostgresMatchStore,
  PostgresReceiptStore,
  PostgresFriendStore,
  PostgresUserStore,
  registerAuthApi,
  mailerFromEnv,
  authRateFromEnv,
  registerAdminApi,
  adminLoginsFromEnv,
  kickSeat,
  registerFriendApi,
  registerMetaMarketApi,
  MemoryMetaMarket,
  PostgresMetaMarket,
  MemoryArsenalStore,
  type MetaMarket,
  registerLeaderboardApi,
  FriendService,
  liveSession,
  currentPwfp,
  revokeAccountConnections,
  configFromEnv,
  type AccountStore,
  type JoinFailure,
  type JoinResult,
  type FriendStore,
  type CommanderStore,
  type MatchStore,
  type ReceiptStore,
  type RoomObservation,
  type UserStore,
} from '../packages/server/src/index';
import {
  newGame,
  kernel,
  data,
  networkSeats,
  networkSeatPlan,
  networkStartsOf,
  parseNetworkMatchMode,
  aiOrders,
  seatAiDecision,
  stewardActive,
  HOUR,
  serverAutoAssaultActions,
  serverAutoRetreatActions,
  serverChainActions,
  chainStamp,
  economySnapshot,
  approvalView,
} from './src/game';
import { ActionGate } from '../packages/action-layer/src/index';
import { isValidActionPayload } from '../packages/shared-core/src/actions/payloadSchemas';
import type { PlayerId } from '../packages/shared-core/src/index';
import { MS_PER_DAY, SWARM_MEMORY_WINDOW } from '../packages/shared-core/src/index';
import type { Identity } from '../packages/server/src/matchApi';
import { admitSeat, seatClaim } from '../packages/server/src/joinSeat';
import { expiredSeatClaims } from '../packages/server/src/seatExpiry';
import { bootRoster, MAX_HOSTED_MATCHES } from '../packages/server/src/matchRoster';
import {
  creditCommanderXp,
  nickSeatAccounts,
} from '../packages/server/src/commanderCredit';
import { detach } from '../packages/server/src/detach';
import { createSnapshotWriter } from '../packages/server/src/snapshotWriter';
import { commitMatch } from '../packages/server/src/matchCommit';
import type { StewardPosture } from './src/stewardScreen';
import { installFatalHandlers } from '../packages/server/src/fatal';
import { buildVersion } from '../packages/server/src/buildVersion';
import { isMetricsReaderRequest, isOperatorRequest, metricsReaderTokenFromEnv, operatorTokenFromEnv } from '../packages/server/src/operatorAccess';
import { metricsReaderSummary } from '../packages/server/src/metrics';
const { Pool } = pgPkg;

// RESIL-3 — ДО всего остального. Этот хост важнее близнеца: именно он собирается в
// `proto-server.mjs`, который и запускает контейнер (`Dockerfile` CMD).
installFatalHandlers();

// --- M0/M1 playtest log: append room events to a per-run JSONL and feed every one
// to the MetricsAggregator for the on-exit summary. Pure observation. The M1
// high-frequency kinds are handled with care: `broadcast`/`timing` lines land in
// the JSONL only when anomalous (slow or fat) — the aggregator still counts them
// all — and `events` lines only fire on real activity (battles, arrivals).
// PTM-0.1: one file per UTC day (`playtest-logs/match-YYYY-MM-DD.jsonl`), written off the
// room's hot path through a bounded queue; every line carries its match id, so
// `pnpm run metrics -- --match <id>` reports one match out of the shared file.
const matchLog = new DailyJsonl({ dir: 'playtest-logs', prefix: 'match' });
const metrics = new MetricsAggregator();
// PTM-0.1: the aggregated summary also lands periodically, so a crash (no graceful
// shutdown) loses at most this much of it.
const SUMMARY_EVERY_MS = 10 * 60 * 1000;
// PTM-0.2: the seat's account becomes the analytics pseudonym `actor`; the raw account
// id never reaches the journal (nor `/metrics/recent`, which serves its lines).
const actorOf = analyticsActorFromEnv(process.env);
// PTM-1.1: browser product events, their own daily file (the receiver is wired in
// `httpRoutes` below, where the session check lives).
const clientLog = new DailyJsonl({ dir: 'playtest-logs', prefix: 'client' });
let telemetryStats: (() => TelemetryStats) | undefined;
// A summary is a cumulative snapshot of THIS process; a restart within the UTC day appends
// a fresh run to the same file, and the report keeps each run's last snapshot apart.
const RUN_ID = Date.now().toString(36);
const writeSummary = (): void =>
  matchLog.write({
    kind: 'summary',
    run: RUN_ID,
    summary: metrics.summary(),
    log: matchLog.stats(),
    client: { log: clientLog.stats(), ...(telemetryStats ? { receiver: telemetryStats() } : {}) },
  });
setInterval(writeSummary, SUMMARY_EVERY_MS).unref();
const SLOW_MS = 50; // a submit/broadcast slower than this is worth a JSONL line
const FAT_DELTA_BYTES = 10_240; // a per-player delta fatter than this too (target: idle < 1 KB)
function worthLogging(ev: RoomObservation): boolean {
  if (ev.kind === 'timing') return ev.ms >= SLOW_MS;
  if (ev.kind === 'broadcast') {
    return ev.ms >= SLOW_MS || Object.values(ev.deltaBytes).some((b) => b >= FAT_DELTA_BYTES);
  }
  return true;
}
// The «заместитель» (substitute) AI must not seize a chair the moment it looks
// empty. `humans` is in-memory — after a restart it is empty for everyone — and a
// player is legitimately away for hours or days in a real-time game that runs for
// weeks. So an empty chair gets a REAL-TIME grace window (per-seat wall-clock
// deadline) before the expansion bot takes over; the owner reclaims it the instant
// they reconnect. SES-2.2: the default is 3 real days — being offline overnight (or
// for a couple of days) leaves your empire holding its own (garrisons defend,
// standing orders run, and the Steward covers your sleep if you delegated it), not
// handed to a bot. A Steward delegation bypasses the grace entirely: turning the
// seat over to your OWN autopilot was your call, not an abandonment (SES-2.2 keeps
// the two AIs distinct — see `seatAiDecision`). Wall-clock, independent of
// TIME_SCALE: the ×24 first session still measures absence in real days.
const AI_GRACE_MS = Number(process.env.AI_GRACE_MS ?? 3 * 24 * 60 * 60 * 1000);

// Entry window (SES-2.3): how long, in REAL time from a session's creation, a NEW
// player may still claim a free seat. After it closes the session runs to its end
// with whoever is in it — a latecomer can't parachute into a game already days deep
// (Iron Order model). A player who ALREADY holds a seat reconnects at any time; this
// gates only first-time claims. Default 4 real days; env-configurable. Measured off
// the world clock (`state.time / TIME_SCALE`, see MatchRegistry.entryOpen) so it
// survives a restart and honours the session's time scale — on the ×24 first session
// 4 real days is 96 game-days, i.e. effectively the whole match.
const ENTRY_WINDOW_MS = Number(process.env.ENTRY_WINDOW_MS ?? 4 * 24 * 60 * 60 * 1000);

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8788);
// Playtest fast-forward: wall→game clock multiplier. TIME_SCALE=100 ⇒ a real minute
// is ~1.7 game-hours, so fleets/builds/economy resolve on-screen instead of over real
// hours. 1 (default) = real-time. Compresses the clock itself, not just durations.
// GATE=1|true → only validated `action.v1` envelopes are accepted (bare `action`
// messages are rejected); the bundled client self-configures from `welcome.gated`.
// Mirrors packages/server serverConfig (per-room gate instance, shared validator).
const GATE = process.env.GATE === '1' || process.env.GATE === 'true';
// SEAT_LOCK=1|true → seat tickets (REL-5): a nick's first join mints a secret the
// client stores and must present on every reconnect (`?ticket=`), so knowing a URL
// or a nick is no longer enough to take someone's seat; `?player=` is refused.
const SEAT_LOCK = process.env.SEAT_LOCK === '1' || process.env.SEAT_LOCK === 'true';
// Operator access to /metrics/* from beyond loopback (prod behind Docker). Unset or
// shorter than 32 chars = loopback only. See `operatorAccess.ts`.
const METRICS_TOKEN = operatorTokenFromEnv(process.env);
const METRICS_READER_TOKEN = metricsReaderTokenFromEnv(process.env);
const TIME_SCALE = Math.max(1, Number(process.env.TIME_SCALE ?? 1) || 1);

// Serve the built prototype HTML so a peer just opens `http://host:port/` (no file
// transfer; the connect overlay auto-fills the same-origin ws:// URL). Regular players
// get the PLAYER client at `/` (no test mode / single-player / time controls — see
// build.mjs); the full dev client stays one step away at `/dev` for the host. If the
// player artifact hasn't been built yet (stale dist), `/` falls back to the dev client.
// Предпочитаем сборку для сервера (`dist/served/`): картинки в ней — отдельные файлы с
// хешем в имени и годовым кэшем, а документ легче в шесть раз. Без её `assets/` берём
// однофайловые: документ со ссылками на картинки, которых нет, хуже тяжёлого.
const servedAssetsDir = 'prototype/dist/served/assets';
const served = existsSync(servedAssetsDir);
const devHtmlPath = served ? 'prototype/dist/served/dev.html' : 'prototype/dist/void-dominion.html';
const playerHtmlPath = served
  ? 'prototype/dist/served/player.html'
  : 'prototype/dist/void-dominion-player.html';
const assets = served ? readAssetDir(servedAssetsDir) : undefined;
const devHtml = existsSync(devHtmlPath) ? readFileSync(devHtmlPath, 'utf8') : undefined;
const playerHtml = existsSync(playerHtmlPath) ? readFileSync(playerHtmlPath, 'utf8') : undefined;
const indexHtml = playerHtml ?? devHtml;
// ADM-1: пульт администратора — отдельный артефакт того же `pnpm run prototype`.
const adminHtmlPath = 'prototype/dist/void-dominion-admin.html';
const adminHtml = existsSync(adminHtmlPath) ? readFileSync(adminHtmlPath, 'utf8') : undefined;

// Every non-internal IPv4 this host owns (the candidates other devices could dial).
function ipv4s(): string[] {
  const all: string[] = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) all.push(i.address);
    }
  }
  return all;
}

// Classify an IPv4 by how a peer can reach it (mirrors `pnpm doctor`). A VM-NAT
// (VirtualBox/QEMU) or link-local address prints fine but is a dead end off this
// box — the trap behind "works locally, friend can't join".
function ipKind(ip: string): 'vm-nat' | 'link-local' | 'cgnat' | 'lan' | 'public' {
  if (ip.startsWith('10.0.2.') || ip.startsWith('10.0.3.')) return 'vm-nat';
  if (ip.startsWith('169.254.')) return 'link-local';
  const [a = -1, b = -1] = ip.split('.').map(Number); // malformed ip → no range matches
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  if (ip.startsWith('192.168.') || ip.startsWith('10.') || (a === 172 && b >= 16 && b <= 31)) {
    return 'lan';
  }
  return 'public';
}

// Durability: with DATABASE_URL set, the match is snapshotted to Postgres and
// survives a restart; otherwise it's in-memory (a restart loses it, as before).
// One production policy for both hosts, before connecting or migrating the DB.
const PROD_FLAG = process.env.PROD === '1' || process.env.PROD === 'true';
const readiness = checkProductionReadiness(process.env);
if (!readiness.ok) {
  process.stderr.write(`PROD=1 refuses to start: missing ${readiness.missing.join(', ')}.\n`);
  process.exit(1);
}
const DATABASE_URL = process.env.DATABASE_URL;
let pool: InstanceType<typeof Pool> | null = null;
let matchStore: MatchStore;
let accountStore: AccountStore;
let receiptStore: ReceiptStore;
let userStore: UserStore;
let friendStore: FriendStore;
let commanderStore: CommanderStore;
let profileStore: ProfileStore;
let botStore: BotRosterStore;
let registrationRewards: RegistrationRewardStore;
let corpStore: CorpStore;
// CORP-1: the news feed — corporation and battle facts beside the corporations, the
// admin's announcements in the game database.
let feedStore: AvaFeedStore;
let announcementStore: AnnouncementStore;
// CORP-5: the AvA stores. Challenges, rosters and results belong to the corporations
// (remote when `CORPORATIONS_URL` is set); the battle sessions, medals, the warehouse
// handouts and the battle salvage stay in the game database.
let challengeStore: AvaChallengeStore;
let rosterStore: AvaRosterStore;
let resultStore: AvaResultStore;
let sessionStore: AvaSessionStore;
let medalStore: MedalStore;
let corpRentStore: CorpRentStore;
let dropStore: DropStore;
// EC-3: аукцион на прото-хосте — тот же слайс, что в проде. Фаусет Варрантов читается
// из окружения ЗДЕСЬ (композиционный корень), а по умолчанию выключен: торгуемая выдача
// на аккаунт превращает регистрацию в монетный двор (ARS-0 anti-RMT).
const corporationsEndpoint = corporateEndpoint(process.env);
const metaFaucet = Number(process.env.META_MARKET_FAUCET ?? 0) || 0;
let metaMarket: MetaMarket;
let arsenalStore: ArsenalStore;
let metaEconomyStore: MetaEconomyStore;
let pushStore: PushStore;
if (DATABASE_URL) {
  pool = new Pool({ connectionString: DATABASE_URL });
  await prepareRuntimeDatabase(pool, process.env);
  matchStore = new PostgresMatchStore(pool);
  accountStore = new PostgresAccountStore(pool);
  receiptStore = new PostgresReceiptStore(pool);
  userStore = new PostgresUserStore(pool);
  friendStore = new PostgresFriendStore(pool);
  commanderStore = new PostgresCommanderStore(pool);
  profileStore = new PostgresProfileStore(pool);
  botStore = new PostgresBotRosterStore(pool);
  registrationRewards = new PostgresRegistrationRewardStore(pool);
  corpStore = new PostgresCorpStore(pool);
  feedStore = new PostgresAvaFeedStore(pool);
  announcementStore = new PostgresAnnouncementStore(pool);
  challengeStore = new PostgresAvaChallengeStore(pool);
  rosterStore = new PostgresAvaRosterStore(pool);
  resultStore = new PostgresAvaResultStore(pool);
  sessionStore = new PostgresAvaSessionStore(pool);
  medalStore = new PostgresMedalStore(pool);
  corpRentStore = new PostgresCorpRentStore(pool);
  dropStore = new PostgresDropStore(pool);
  arsenalStore = new PostgresArsenalStore(pool);
  metaMarket = new PostgresMetaMarket(pool, undefined, metaFaucet);
  metaEconomyStore = new PostgresMetaEconomyStore(pool);
  pushStore = new PostgresPushStore(pool);
} else {
  // The session store reads an ended battle's result from the raw match store.
  const memoryMatches = new MemoryMatchStore();
  matchStore = memoryMatches;
  accountStore = new MemoryAccountStore();
  receiptStore = new MemoryReceiptStore();
  userStore = new MemoryUserStore();
  friendStore = new MemoryFriendStore();
  commanderStore = new MemoryCommanderStore();
  profileStore = new MemoryProfileStore();
  botStore = new MemoryBotRosterStore();
  registrationRewards = new MemoryRegistrationRewardStore(userStore, profileStore, commanderStore);
  // One feed for both writers: the corp store announces a corp's own facts into it.
  const memoryFeed = new MemoryAvaFeedStore();
  feedStore = memoryFeed;
  corpStore = new MemoryCorpStore(memoryFeed);
  announcementStore = new MemoryAnnouncementStore();
  challengeStore = new MemoryAvaChallengeStore();
  rosterStore = new MemoryAvaRosterStore();
  resultStore = new MemoryAvaResultStore();
  sessionStore = new MemoryAvaSessionStore(memoryMatches);
  medalStore = new MemoryMedalStore();
  corpRentStore = new MemoryCorpRentStore();
  const memoryArsenal = new MemoryArsenalStore();
  const memoryMarket = new MemoryMetaMarket(memoryArsenal, undefined, metaFaucet);
  const memoryDrops = new MemoryDropStore();
  dropStore = memoryDrops;
  arsenalStore = memoryArsenal;
  metaMarket = memoryMarket;
  metaEconomyStore = new MemoryMetaEconomyStore(memoryArsenal, memoryDrops, memoryMarket);
  pushStore = new MemoryPushStore();
}
metaMarket.setEconomy(metaEconomyStore);
// UIX-4.4 (часть 1): ключи VAPID из окружения. Нет ключей — нет ни маршрута ключа, ни
// рассылки: подписаться было бы нечем, слать некому.
const vapid = vapidFromEnv(process.env);
if (vapid) configureWebPush(vapid);
const pushDispatch = vapid
  ? createPushDispatcher({
      store: pushStore,
      send: sendPush,
      onError: (m) => process.stderr.write(`${m}\n`),
    })
  : null;
const metaCatalog = loadMetaEconomyCatalog(data);
const starterArsenal = loadStarterArsenal(data);
let shuttingDown = false;
const arsenalRefreshes = new Set<Promise<void>>();
let refreshGrantedArsenal: (accountId: string) => Promise<void> = async () => {};
// ARS-4: таблицы выпадения — и для доставки наград, и для осколков за бои битвы корпораций.
const dropTables = loadDropTables(data);
const metaEconomy = new MetaEconomy({ store: metaEconomyStore, catalog: metaCatalog, dropTables, now: Date.now,
  onEvent: (event) => {
    process.stdout.write(`${JSON.stringify({ t: 'meta-economy', ...event })}\n`);
    // Final snapshots can themselves issue durable rewards. During shutdown do
    // not start another room mutation; authenticated rejoin syncs the owned catalog.
    if (shuttingDown) return;
    const refresh = refreshGrantedArsenal(event.accountId)
      .finally(() => { arsenalRefreshes.delete(refresh); });
    arsenalRefreshes.add(refresh);
    void refresh.catch((error) => process.stderr.write(`meta live catalog refresh failed: ${String(error)}\n`));
  },
});

if (corporationsEndpoint) {
  corpStore = corporateRemote(corporationsEndpoint, 'corpStore');
  feedStore = corporateRemote(corporationsEndpoint, 'feedStore');
  challengeStore = corporateRemote(corporationsEndpoint, 'challengeStore');
  rosterStore = corporateRemote(corporationsEndpoint, 'rosterStore');
  resultStore = corporateRemote(corporationsEndpoint, 'resultStore');
}

/** Account crediting (EC-*): the core already computed `match.rewards` (place + XP per
 *  seat, deterministic). At match end, map each seat's nick → account and bank the XP
 *  durably, EXACTLY ONCE (creditMatch's idempotency marker survives a restart that
 *  re-observes the same end). Nick-mode servers have no accounts → nothing to credit.
 *
 *  Правила банковки живут в `packages/server/src/commanderCredit.ts` — общие с боевым
 *  входом (SES-2). Своя копия тут была ровно до тех пор, пока боевой вход начислял
 *  только AvA-матчам; сведена, чтобы два хоста не разъезжались и здесь. */
async function creditMatchXp(
  matchId: string,
  rewards: Record<string, { xp: number }> | undefined,
): Promise<void> {
  await creditCommanderXp(
    commanderStore,
    nickSeatAccounts(accountStore, userStore, matchId),
    matchId,
    rewards,
  );
}

// Accounts on the PLAYABLE path (SES-2.5): with AUTH_JWT_SECRET set, the full account
// contour switches on — POST /auth/register + /auth/login (scrypt, uniform-401,
// per-IP limits) hand out a session JWT; GET /matches/:id/join exchanges it for a
// short-lived join token; the WS handshake then requires `?token=` and the nick/ticket
// dev handshakes are REFUSED (the token is the sole identity — same shape as the
// production entry). Unset ⇒ the nick+ticket flow stays (LAN playtests, zero setup).
// One env, both worlds; the client self-configures via GET /auth/status.
const authCfg = configFromEnv(process.env);
const securityAudit = securityAuditFromEnv(process.env);
const AUTH = authCfg.auth !== undefined;
const rewardDelivery = createMetaRewardDelivery({
  store: metaEconomyStore,
  matches: matchStore,
  seats: (id) => AUTH ? nickSeatAccounts(accountStore, userStore, id) : async () => ({}),
  settle: (facts) => metaEconomy.settle(facts),
  activeDay: (accountId, day) => metaEconomy.settleActiveDay(accountId, day),
  stageCount: metaCatalog.rewards.stageFractions.length,
  participation: metaCatalog.rewards.participation,
  onError: (error) => process.stderr.write(`meta reward delivery failed: ${String(error)}\n`),
});
matchStore = rewardDelivery.matches;
rewardDelivery.start();
const BOT_POPULATION = botPopulationConfig(process.env);
await botStore.ensureRoster();
// System handles are reserved and cannot be registered as human accounts. The authenticated host
// is required even when restoring existing bots with fresh filling disabled.
if (!AUTH && (BOT_POPULATION.fillPercent > 0 || (await botStore.activeMatchIds()).length > 0))
  throw new Error('E_BOT_AUTH_REQUIRED');
await recoverBotPopulation({ bots: botStore, profiles: profileStore, accounts: accountStore,
  matches: matchStore, now: Date.now });
// ADM-1: кто может командовать составом партии (`ADMIN_LOGINS=alice,bob`). Полномочие —
// на УЧЁТКЕ, а не общий токен: в логе видно, кто снял игрока, а смена пароля отзывает
// доступ вместе с сессией. Пусто ⇒ админских маршрутов на хосте нет вообще.
const ADMIN_LOGINS = adminLoginsFromEnv(process.env.ADMIN_LOGINS);
// Same guard as packages/server/src/main.ts: auth without an Origin allowlist leaves
// the WS handshake open to cross-site hijack (CSWSH) — warn loudly, don't silently run.
if (AUTH && !authCfg.allowedOrigins) {
  process.stderr.write(
    'warning: AUTH is on but ALLOWED_ORIGINS is unset — no Origin allowlist (CSWSH). ' +
      'Set ALLOWED_ORIGINS before exposing this beyond a trusted network.\n',
  );
}
// Public-bind + no-auth warning (audit S1): even without PROD=1, a public bind with
// no AUTH_JWT_SECRET is the open `?nick=` playtest path — surface it loudly so an
// operator doesn't accidentally expose a public unauthenticated server.
const HOST_BIND = process.env.HOST ?? '127.0.0.1';
if (!AUTH && HOST_BIND === '0.0.0.0' && !PROD_FLAG) {
  process.stderr.write(
    'warning: HOST=0.0.0.0 with no AUTH_JWT_SECRET — public unauthenticated playtest mode. ' +
      'Anyone who knows a nick can take a seat. Set AUTH_JWT_SECRET (and ideally PROD=1) ' +
      'before exposing this beyond a trusted network.\n',
  );
}
// HTTPS-1.1, вторая половина: `TRUST_PROXY=1` объявляет прокси впереди, и с ним сервер
// начинает ВЕРИТЬ `X-Forwarded-Proto`. Верить чужому заголовку можно ровно до тех пор,
// пока прислать его может только прокси — то есть пока plain-порт не торчит наружу.
// Гвардия в `wsServer.ts` ловит недонастроенный прокси и наивный обход (заголовка нет →
// 403), но ПОДДЕЛАННЫЙ заголовок от неотличима от настоящего по построению. Поэтому
// единственная реальная защита — привязка: за прокси upstream слушает loopback
// (`SERVER_BIND=127.0.0.1` в `deploy/docker-compose.tls.yml`, DoD HTTPS-2.1).
// Публичная привязка вместе с TRUST_PROXY — не всегда ошибка (прокси может стоять на
// другой машине частной сети), поэтому предупреждаем, а не отказываем.
if (process.env.TRUST_PROXY === '1' && HOST_BIND !== '127.0.0.1' && HOST_BIND !== 'localhost') {
  process.stderr.write(
    `warning: TRUST_PROXY=1 вместе с HOST=${HOST_BIND} — plain-порт слушает не только loopback. ` +
      'Пока он достижим снаружи, клиент может прислать собственный X-Forwarded-Proto: https ' +
      'и обойти проверку транспорта. Привяжите upstream к 127.0.0.1 (см. SERVER_BIND в ' +
      'deploy/docker-compose.tls.yml) или закройте порт файрволом.\n',
  );
}
// New matches take their capacity and sides from the selected map: duel by default,
// or four-player FFA. Legacy seating formats remain readable for existing sessions.
const NETWORK_MODE = parseNetworkMatchMode(process.env.TEAMS);
const NET_SEATS = networkSeats(NETWORK_MODE, DEFAULT_MAP_ID);
// MATCHES=N — сколько партий ЗАСЕЯТЬ на пустом сторе (default 1); тот же режим и та же
// шкала времени у всех, браузер матчей показывает каждую. Это НЕ список партий хоста:
// список приходит из стора (ADDR-1, `matchRoster.ts`). Первая засеянная сохраняет
// исторический id `proto`, чтобы уже выданные билеты на места и durable-снапшот пережили
// обновление; остальные получают настоящие идентификаторы, а не порядковые номера.
const MATCHES = Math.max(1, Math.min(MAX_HOSTED_MATCHES, Number(process.env.MATCHES ?? 1) || 1));

// CORP-5 — битвы корпораций на хосте игроков: те же службы и тот же фоновый обход, что у
// боевого входа (`packages/server/src/main.ts`), а не своя копия. Вызовы, составы, итоги и
// лента принадлежат корпорациям (за `CORPORATIONS_URL`, если он задан); сама битва — комната
// ЭТОГО хоста, и пустые места сторон играет его ИИ. Битва сажает УЧЁТКИ из состава, поэтому
// без AUTH обход не запускается и комнаты битв не поднимаются: у ник-хоста нет корпораций.
const medalCatalog = loadMedalCatalog();
// На Postgres каждое намерение — своя транзакция: машина состояний вызова и расчёт итога
// битвы держатся на собственных воротах «ровно один раз», которым она нужна.
const corporateServices = pool && !corporationsEndpoint ? createCorporateServices(pool) : undefined;
const avaService: AvaService = corporationsEndpoint
  ? corporateRemote<AvaService>(corporationsEndpoint, 'ava')
  : (corporateServices?.ava ??
    new AvaService({ corpStore, challengeStore, rosterStore, resultStore, feedStore, medals: medalCatalog }));
const medalService =
  corporateServices?.medals ?? new MedalService({ corpStore, resultStore, medalStore, catalog: medalCatalog });
const corpArsenalService = new CorpArsenalService({ corpStore, arsenalStore, rentStore: corpRentStore, challengeStore, rosterStore });
// Манифест, который несут партии самого прототипа (`newGame`). Хост игроков по нему партию не
// отвергает, но битва, собранная здесь, остаётся одной из них.
const PROTOTYPE_MANIFEST = '1';
const avaOrchestrator = new AvaOrchestrator({
  challengeStore,
  rosterStore,
  sessionStore,
  data,
  maps: loadAvaMaps(),
  manifest: PROTOTYPE_MANIFEST,
  createRoom: (spec) => raiseAvaBattle(spec),
  // CORP-4: ни одна карта не подходит под запертый состав — битва отменяется, вызов возвращается.
  cancel: (matchupId) => avaService.cancelLocked(matchupId),
  // Сутки мира (`corporation-wars.md` §10) по часам ЭТОГО хоста: TIME_SCALE переводит их в
  // реальное время. AVA_PEACE_MS переопределяет срок для плейтеста, как у боевого входа.
  peaceMs: Number(process.env.AVA_PEACE_MS ?? '') || MS_PER_DAY / TIME_SCALE,
  isMatchEnded: async (matchId) => (await matchStore.load(matchId))?.status === 'ended',
  // Войну объявляет живая комната серверными действиями — мимо запрета для игроков.
  escalateWar: async (matchId) => {
    const room = registry.get(matchId);
    return room ? declareAvaWar(room, matchId) : false;
  },
  settle: (matchupId, winnerSide) => avaService.settleMatch(matchupId, winnerSide),
  // ARS-3: арсенал учётки на момент блокировки состава; ARS-6: плюс выданное со склада.
  arsenalOf: async (accountId) => arsenalSnapshotOf(await arsenalStore.listOf(accountId)),
  corpRentalOf: (accountId, matchupId) => corpArsenalService.rentedArsenalOf(accountId, matchupId),
});
const avaSweeps = createAvaSweeps({
  sessionStore,
  resultStore,
  ava: avaService,
  orchestrator: avaOrchestrator,
  corpArsenal: corpArsenalService,
  maintenance: () => process.env.CORPORATIONS_MAINTENANCE === '1',
  log: (message) => process.stderr.write(`${message}\n`),
});

// Wakeup-driver tuning. NETA2-6: the arm/fire/stall loop + the live-player HEARTBEAT_MS
// beat now live in the shared `startClockDriver` (packages/server) — one scheduler for
// both hosts. This host only pins a tighter 1h timer cap (setTimeout overflow +
// clock-drift safety); the stall limit and the beat interval come from the shared driver.
const MAX_TIMER_MS = 60 * 60_000; // 1h cap, passed as the driver's maxDelayMs

/** One hosted session: a MatchRoom plus ALL its per-match machinery — the empty-seat
 *  AI (with the BF-17 reconnect grace), the standing-order drivers, the debounced
 *  durable snapshot and the offline wakeup timer. Everything that used to be a
 *  module-level single-match global lives in this closure now, one set per match. */
interface HostedMatch {
  id: string;
  room: MatchRoom;
  restored: boolean;
  /** Final durable flush (shutdown). */
  flush(): Promise<void>;
  clearTimers(): void;
}

async function createHostedMatch(
  id: string,
  mapId: MapId = DEFAULT_MAP_ID,
  modeId?: string,
): Promise<HostedMatch> {
  let connected = 0; // live players in THIS match (gates the empty-seat AI)
  // CORP-5: битва корпораций. Её мир собирает оркестратор (`raiseAvaBattle`), а не `newGame`.
  const ava = isAvaMatchId(id);
  // The shared offline scheduler (assigned after `room` below). `observe` re-arms it,
  // so it is declared here — before `observe` — and read with `?.` until it exists.
  let driver: ClockDriverHandle | null = null;
  // Seats with a live human peer. Any seat NOT in here is "empty" and is driven by
  // the server-side AI (mirrors single-player: empty slots are taken by the AI).
  const humans = new Set<string>();
  const botSeats = new Set<string>();
  const botIdentities = new Map<string, BotIdentity>();
  const aiEligibleAt = new Map<string, number>();
  const background = new Set<Promise<void>>();
  const runBackground = (what: string, work: Promise<unknown>): void => {
    const tracked = work.then(() => {}).finally(() => { background.delete(tracked); });
    background.add(tracked);
    detach(what, tracked);
  };
  const drainBackground = async (): Promise<void> => {
    // detach already reports failures; none may skip the final world snapshot.
    while (background.size) await Promise.allSettled([...background]);
  };

  async function rememberBots(assignments: readonly BotAssignment[]): Promise<void> {
    for (const assignment of assignments) {
      if (!botIdentities.has(assignment.playerId)) {
        const identity = await botStore.findByLogin(assignment.login);
        if (!identity || identity.id !== assignment.botId) throw new Error('E_BOT_IDENTITY');
        botIdentities.set(assignment.playerId, identity);
      }
      botSeats.add(assignment.playerId);
    }
  }

  const restoredSnap = await matchStore.load(id);
  // Битва рождается только из снимка оркестратора: свежий мир под её номером был бы чужой партией.
  if (ava && !restoredSnap) throw new Error('E_NO_MATCH');
  let initialState =
    restoredSnap?.state ??
    newGame({
      mapId,
      ...(modeId !== undefined ? { modeId } : {}),
      seats: networkSeatPlan(NETWORK_MODE, mapId),
    });
  if (AUTH && !restoredSnap) initialState = initializeOrdinaryArsenal(initialState, data);
  // Режим берётся ИЗ СОСТОЯНИЯ, а не из аргумента: у восстановленной партии аргумента
  // нет (её поднимает `bootRoster` по списку из стора), и без этой строки рестарт
  // молча вернул бы PvE-сессию к базовым правилам — ровно та «подмена правил под
  // матчем», которую `resolveMatchConfig` отказывается допускать для чужого режима.
  const sessionModeId = initialState.modeId;
  // A NET seat is not a bot: every seat here is claimable by a human, and the
  // server-side AI merely stands in for an empty chair (`humans` is the live truth).
  // Strip the static `ai` branding newGame took from the seat config, or two humans
  // on DEFAULT_SETUP seats could never ally (E_BOT_ALLIANCE against seat p2 forever).
  // В битве корпораций пустые места сторон — боты оркестратора (`bot:<место>`): человеку
  // их не занять, и метка остаётся.
  if (!ava) for (const seat of Object.values(initialState.players)) if (!seat.npc) delete seat.ai;
  // CORP-5: эти места всю битву играет ИИ хоста — есть кто-то в партии или нет.
  const avaBots = new Set(
    ava ? Object.values(initialState.players).filter((p) => p.ai && !p.npc).map((p) => p.id) : [],
  );
  // Rehydrate idempotency receipts so a retried action stays deduped across a restart.
  const initialReceipts = await receiptStore.loadAll(id);

  // ARS-4, как у боевого входа: осколки победителю каждого боя битвы корпораций по павшему
  // составу врага. Место → учётка — из состава сессии: у бота учётки нет, ему не достаётся ничего.
  let avaSeatAccounts: Record<string, string> | null = null;
  async function creditAvaSalvage(events: readonly DomainEvent[]): Promise<void> {
    const salvage = salvageFromEvents(events, dropTables);
    if (salvage.size === 0) return;
    if (!avaSeatAccounts) {
      const session = await sessionStore.byMatch(id);
      if (!session) return; // связи битвы с составом ещё нет — начислять некому
      avaSeatAccounts = Object.fromEntries(
        Object.entries(session.seats).map(([accountId, slot]) => [slot, accountId]),
      );
    }
    for (const [winner, shards] of salvage) {
      const accountId = avaSeatAccounts[winner];
      if (accountId) await dropStore.addShards(accountId, shards);
    }
  }

  // ECON-6: игровое время последнего экономического среза (первый — через час).
  let lastEconAt = initialState.time;
  const observe = (ev: RoomObservation): void => {
    metrics.observe(ev);
    pushDispatch?.(id, ev); // UIX-4.3: своё и срочное — тем, кого нет в игре
    if (worthLogging(ev)) {
      matchLog.write(journalRecord(id, ev, actorOf));
    }
    if (ev.kind === 'join') {
      connected++;
      humans.add(ev.playerId);
      aiEligibleAt.delete(ev.playerId); // the human is back — cancel any pending takeover
    } else if (ev.kind === 'leave') {
      connected = Math.max(0, connected - 1);
      humans.delete(ev.playerId);
      aiEligibleAt.set(ev.playerId, Date.now() + AI_GRACE_MS); // reconnect window
    } else if (ev.kind === 'action' && !ev.durable) {
      // Persist the receipt so a retried action stays deduped across a restart.
      // NETA2-3: a DURABLE action (gated committed path) already had its receipt
      // written by the room's commit-before-broadcast `persist` callback — skip it
      // here or we double-write. Only the SYNC path (server drivers, ungated actions)
      // has no other durable writer, so it still persists through this branch.
      runBackground('сохранение квитанции', receiptStore.save(id, {
        actionId: ev.actionId,
        playerId: ev.playerId,
        seq: ev.seq,
        ok: ev.ok,
        ...(ev.code ? { code: ev.code } : {}),
      }));
    } else if (ev.kind === 'end' && AUTH) {
      // Bank each seated commander's match XP onto their account (idempotent).
      runBackground('начисление опыта за матч', creditMatchXp(id, ev.rewards));
      runBackground('профиль: итоги матча', creditProfileMatch(profileStore, nickSeatAccounts(accountStore, userStore, id), id, room.state));
    } else if (ev.kind === 'events' && ava) {
      runBackground('осколки за бой битвы корпораций', creditAvaSalvage(ev.events));
    }
    // Persist after anything that changes the world (debounced below), and re-arm
    // the offline wakeup: an action may schedule or consume events — both move the
    // next-event time. ('lobby' kept for transport parity; auto-started sessions
    // never emit it — SES-2.1.)
    if (ev.kind === 'action' || ev.kind === 'lobby' || ev.kind === 'end') scheduleSave();
    // Re-arm on room events: an action may (un)schedule events, and a join/leave
    // starts/stops the live-player heartbeat (the driver reads room.peerCount).
    // `reschedule()` re-evaluates the next wake AND resets the driver's stall guard —
    // a genuine external event means the situation may have changed. `advance_overflow`
    // is EXCLUDED: a stalled catch-up emits it from inside `room.tick()` itself, so
    // rescheduling on it would defeat the stall back-off (an eternal 0ms wake spin). The
    // M1 metrics kinds are excluded too: they describe work already done (fan-out size,
    // timings, desync reports) and never move the next-event time — rescheduling on every
    // broadcast would churn the timer.
    if (
      ev.kind === 'join' ||
      ev.kind === 'leave' ||
      ev.kind === 'lobby' ||
      ev.kind === 'action' ||
      ev.kind === 'end' ||
      ev.kind === 'dead_letter'
    ) {
      driver?.reschedule();
    }
  };

  // No lobby (SES-2.1, Iron Order model): the session's world clock runs from the
  // moment the session is CREATED, 24/7 — a player always joins a live world (the
  // feed shows which game day it is). There is no host and no Start press to wait
  // for; empty chairs defend themselves until claimed (and the stand-in AI takes
  // an abandoned one after the real-days grace, SES-2.2).
  const room = new MatchRoom({
    id,
    initialState,
    kernel,
    data,
    onChat: (message) => botSocial?.onMessage(message),
    serverChatAllowed: (seat) => botSeats.has(seat),
    now: () => Date.now(),
    // Born running: the clock anchors at the initial game time (fresh world: Day 1
    // now; restored snapshot: its durable anchor) and TIME_SCALE applies from here.
    initiallyStarted: true,
    initialClock: restoredSnap?.clock,
    singlePeerPerPlayer: true, // one live connection per chair — no two people command one empire
    emitStateHash: true, // attach hashState(view) so the client overlay can flag desync
    // Bot favour (`approval`) is a prototype key the core fog passes through whole:
    // each player gets only the bots' opinion of THEM, not every bot's of every seat.
    hostFog: approvalView,
    securityAudit,
    arsenalStore,
    observe, // M0: log every room event to JSONL + count for the on-exit summary
    initialReceipts, // rehydrated idempotency (deduped action stays deduped after restart)
    // PVE-5.2: тактика Роя. Для PvP-сессии `pveOrders` возвращает пустой список
    // (нет `state.pve`), поэтому провод безусловный — режим решают ДАННЫЕ, а не
    // условие здесь. Без этой строки волны спавнились бы у логова и стояли.
    // AUD-20: окно памяти Роя. Без него драйвер не адаптирует Рой вовсе (так было до
    // аудита). Сетевой матч сложность у клиента не спрашивает — её решает сервер, и
    // сервер ставит обычный Рой (сторож `aiProfile.test.ts`).
    serverOrders: (state, seq) =>
      pveOrders(state, data, { session: id, seq, memoryWindow: SWARM_MEMORY_WINDOW.weak }),
    // The kernel context config must match what the local sim (and the HUD) promise:
    // without it victory falls back to its 600 default while the HUD counts to 450.
    config: {
      timeScale: 1,
      ...(sessionModeId !== undefined ? { modeId: sessionModeId } : {}),
      victory: victoryFor(initialState),
    },
    initialSeq: restoredSnap?.seq, // resume the action counter — else the optimistic-by-seq
    // store drops post-restart saves until seq climbs back past the stored value
    // Strict commit-before-broadcast: await the durable write of the new snapshot +
    // receipt before the room commits state / broadcasts. The debounced scheduleSave in
    // `observe` above becomes a harmless coalesced extra for actions (still needed for
    // tick-driven advances, which are recomputable and persist after the fact).
    persist: async (snapshot, receipt) => {
      await commitMatch(matchStore, receiptStore, snapshot, receipt);
    },
    timeScale: TIME_SCALE, // playtest fast-forward (1 = real-time)
    // CORP-5: стороны битвы от мира к войне переводит оркестратор, а не игроки; Хранителя
    // битва не принимает — список отказов общий с каноническим сервером.
    ...(ava ? { denyPlayerActions: avaDeniedAction } : {}),
    // REL-4: the action-layer front-door — envelope validate→authorize→sequence→dedup
    // with per-type payload schemas BEFORE the reducer. Server-internal drivers
    // (AI / standing orders) submit via room.submitAction and are unaffected.
    ...(GATE ? { gate: new ActionGate({ payloadValidator: isValidActionPayload }) } : {}),
  });

  const botSocial = createBotSocial({
    room,
    isBot: (seat) => botSeats.has(seat),
    availability: (seat, wall) => {
      const identity = botIdentities.get(seat);
      return identity !== undefined && botSocialAvailable(identity.id, wall);
    },
    render: botChatText,
    behavior: (bot, human, stance, state) => {
      const identity = botIdentities.get(bot);
      return identity !== undefined && botAcceptsOffer(state, bot, human, identity.seed, stance);
    },
    onError: (code) => process.stderr.write(`${code}\n`),
  });

  if (AUTH && initialState.match.status === 'ended')
    await creditProfileMatch(profileStore, nickSeatAccounts(accountStore, userStore, id), id, initialState);

  // BF-17: after a (re)start `humans` is empty for EVERY seat — a restarted server
  // must not immediately hand every human's empire to the expand-AI. Seed the same
  // reconnect grace window for all seats; a joining human clears it, a delegated
  // steward bypasses it, and a genuinely empty chair starts playing once it lapses.
  for (const seat of Object.keys(room.state.players)) {
    aiEligibleAt.set(seat, Date.now() + AI_GRACE_MS);
  }

  // Snapshot the world after changes, debounced so a burst of actions is one write.
  const snapshots = createSnapshotWriter({
    async save() {
      const snapshot = {
        matchId: id,
        dataVersion: room.state.version?.data ?? 'proto',
        seq: room.sequence,
        status: room.state.match.status === 'ended' ? 'ended' as const : 'ongoing' as const,
        state: room.state,
        clock: room.clockSnapshot,
        economyActivity: room.economyActivitySnapshot,
      };
      await matchStore.save(snapshot);
      // Admission may cross the terminal deadline before it can update botSeats.
      // The durable roster, not the successfully seated in-memory cache, owns settlement.
      if (snapshot.status === 'ended')
        await settleBotMatch({ snapshot, bots: botStore, profiles: profileStore, accounts: accountStore, now: Date.now() });
      // CORP-5: итог битвы — сразу в расчёт (склад, влияние, лента). Не вышло — повторит обход.
      if (snapshot.status === 'ended' && ava) detach('итог битвы корпораций', avaSweeps.deliverResults());
    },
    onError(e) {
      process.stderr.write(`snapshot save failed (${id}): ${(e as Error)?.message ?? String(e)}\n`);
      // A finished room has no more AI wakes. Keep one bounded retry until its
      // durable result lands; active roster ownership survives a process restart.
      if (room.state.match.status === 'ended') scheduleSave(5_000);
    },
  });
  function scheduleSave(delay = 500): void { snapshots.schedule(delay); }

  // Население ботов-учёток — для обычных партий: места битвы корпораций раздаёт её состав.
  if (AUTH && !ava) {
    try {
      await rememberBots(await prepareBotPopulation({ matchId: id, room, bots: botStore,
        accounts: accountStore, data, config: BOT_POPULATION, restored: true, now: Date.now() }));
    } catch (error) {
      // A partially persisted claim belongs to this match and is repaired on
      // restart. Never release it on a timeout or expose a half-admitted room.
      snapshots.stop();
      try {
        await recoverBotMatch({ bots: botStore, profiles: profileStore, accounts: accountStore,
          matches: matchStore, now: Date.now }, id);
      } catch (cleanupError) {
        process.stderr.write(`bot creation recovery deferred (${id}): ${String(cleanupError)}\n`);
      }
      throw error;
    }
  }

  // Offline scheduler (PA-4.1): the shared `startClockDriver` (assigned below, after the
  // driver bodies its onTick calls) runs the world 24/7 — it arms one timer for the
  // soonest scheduled event, ticks the room when it fires (advance + broadcast the
  // arrivals/battles/captures that came due), and re-arms; the live-player HEARTBEAT_MS
  // beat keeps a watched room's clock moving on-screen even with an empty schedule.
  // The durable clock anchor includes downtime; advanceTo processes due events through
  // the normal deterministic scheduler. Legacy snapshots resume at their saved state.time. The distributed evolution
  // is a Postgres job queue (pg-boss): one shared "wake match X at T" job across processes
  // instead of one in-memory timer per room — see docs/persistence-accounts-roadmap.md.
  // `driversBusy` guards re-entrancy: on a DURABLE room a driver pass awaits the room's
  // mailbox, so a later (heartbeat) tick must not start a second pass mid-flight.
  let driversBusy = false;
  // Тик, не сумевший взять `driversBusy`, оставляет долг вместо того, чтобы потерять
  // свой проход стоячих драйверов; его отрабатывает тот, кто гварду отпустит.
  let standingDue = false;
  // Stable phases throughout each two-hour cycle; only one decision/order per
  // event-loop slice. The same bounded queue drives solo. The authoritative room
  // still serializes and validates every order, including ones that became stale.
  const aiSchedule = new StaggeredAi<Action[]>(2 * HOUR);
  aiSchedule.reset(room.state.time);
  let aiBusy = false;
  let aiStopped = false;
  let aiClockStalled = false;
  /** Поза из политики планировщика: `${kind}:${posture}` → `posture`. Берём из
   *  переданного значения, а не выводим заново — иначе план строится под одну позу,
   *  а планировщик гейтит по другой, и расхождение невидимо. */
  const postureOf = (policy: string): StewardPosture | 'expand' =>
    policy.slice(policy.indexOf(':') + 1) as StewardPosture | 'expand';
  const aiPolicy = (seat: string): string | null => {
    if (room.state.players[seat]?.status !== 'active') return null;
    if (botSeats.has(seat)) return `bot:${botStyle(botIdentities.get(seat)!.seed)}`;
    // CORP-5: бот стороны играет за свою сторону всю битву — смотрит на неё кто-то или нет.
    if (avaBots.has(seat)) return 'ava:expand';
    // Место человека в битве не играет никакой ИИ — ни подмена после отсрочки, ни Хранитель
    // (corporation-wars.md §7): атакует только вошедший игрок, экономика и оборона идут сами.
    if (ava) return null;
    // Offline population keeps its own empires active. The grace-based human
    // stand-in keeps the existing watched-room policy.
    if (connected === 0) return null;
    const posture = stewardActive(room.state, seat, room.state.time);
    const eligibleAt = aiEligibleAt.get(seat);
    const graceExpired = !!room.state.players[seat]?.npc || eligibleAt === undefined || Date.now() >= eligibleAt;
    const decision = seatAiDecision(humans.has(seat), posture, graceExpired);
    return decision.kind === 'none' ? null : `${decision.kind}:${decision.posture}`;
  };
  async function runServerAI(): Promise<void> {
    if (aiBusy || aiStopped) return;
    aiBusy = true;
    try {
      while (!aiStopped && !aiClockStalled && room.isStarted && (connected > 0 || botSeats.size > 0 || avaBots.size > 0) && room.state.match.status !== 'ended') {
        if (driversBusy) {
          await new Promise<void>((resolve) => setTimeout(resolve, 16));
          continue;
        }
        // Стоячие драйверы не должны вклиниться ВНУТРЬ зависимой пары, пока ждётся
        // durable-запись. Гварда берётся на одну маленькую порцию и отпускается сразу.
        driversBusy = true;
        try {
          const step = aiSchedule.step(room.state.time, Object.keys(room.state.players), aiPolicy,
            (seat, policy) => botSeats.has(seat)
              ? botBehaviorOrders(room.state, seat, botIdentities.get(seat)!.seed)
              : aiOrderSlices(aiOrders(room.state, seat, postureOf(policy))));
          if (!step.worked) return;
          const group = step.action ?? [];
          // Политику спрашиваем ОДИН раз на порцию. Перепроверка перед каждым приказом
          // рвала ровно ту пару, ради которой порция и существует: `submitServerAction`
          // ждёт мейлбокс, за это время истекает делегирование Стюарда или возвращается
          // человек — и флот оставался вышедшим из боя без приказа куда идти. Планировщик
          // уже сверяет политику с той, под которую план строился (`aiScheduler.step`).
          if (group.length && aiPolicy(group[0]!.playerId) !== null) {
            for (const action of group) await room.submitServerAction(action.playerId, action);
          }
        } finally {
          driversBusy = false;
          // Тик, пришедший в занятое окно, оставил долг — отдаём его, иначе проход
          // стоячих драйверов пропадёт вместе с этим ударом сердца. Отцепляем так же,
          // как это делает тик: свой сбой прохода не должен уронить цикл ИИ, а гварду
          // он возьмёт сам — следующая итерация подождёт её штатно.
          if (standingDue && !aiStopped) {
            standingDue = false;
            runBackground('серверные драйверы (отложенный проход)', runStandingPass());
          }
        }
        // Yield between BOTH planning and applying: persistence may resolve already,
        // so awaiting submit alone is not an event-loop/render opportunity.
        await new Promise<void>((resolve) => setTimeout(resolve, 16));
      }
    } finally {
      aiBusy = false;
    }
  }

  // CC-2 / RETR-2 / CC-1: drive the authoritative STANDING orders (auto-storm, auto-retreat,
  // order chains) server-side. Решения чистые (`serverDrivers.ts` и ядро), здесь только
  // применение через авторитетную комнату. Отклонённый приказ просто пропускается.
  // Дежурного вылета (CC-4) больше нет: «Держать патруль» (SHU-6.6) поднимает эскадру
  // событием ядра, без драйвера.
  async function runServerStanding(): Promise<void> {
    if (!room.isStarted) return;
    // RETR-2 идёт ПЕРВЫМ: смысл приказа — выйти из боя до следующего раунда, а не
    // после того, как флот отработает остальные намерения.
    for (const r of serverAutoRetreatActions(room.state)) {
      for (const act of r.actions) await room.submitServerAction(r.owner, act);
    }
    for (const a of serverAutoAssaultActions(room.state)) {
      for (const act of a.actions) if (!(await room.submitServerAction(a.owner, act)).ok) break;
    }
    // CC-1: advance the authoritative order chains — stamp first (consume-on-issue),
    // then the head step's orders; a rejected order is skipped, the chain moves on.
    for (const c of serverChainActions(room.state, room.state.time)) {
      if (c.patch) {
        await room.submitServerAction(
          c.owner,
          chainStamp(c.owner, c.fleetId, c.patch.steps, c.patch.waitUntil),
        );
      }
      for (const act of c.actions) await room.submitServerAction(c.owner, act);
    }
  }

  // Один проход стоячих драйверов + истечение заявок на места. Зовут его тик и —
  // если тик не смог взять гварду — цикл ИИ, отпуская её (см. `standingDue`).
  async function runStandingPass(): Promise<void> {
    if (aiStopped) return;
    driversBusy = true;
    try {
      await runServerStanding(); // CC-2/RETR-2/CC-1: standing orders (auto-storm, retreat, chains)
      // ENTRY-3 (правило 7): вернуть в оборот места, заявленные и не подтверждённые
      // дольше окна. Тот же вызов, что у канонического сервера (`serverWiring.ts`) —
      // паритет держится общей функцией, а не двумя похожими циклами.
      for (const { playerId, action } of expiredSeatClaims(room.state, room.clockScale)) {
        await room.submitServerAction(playerId, action);
      }
    } finally {
      driversBusy = false;
    }
  }

  // Raise the shared clock driver for this room. onTick fires AFTER room.tick(): persist
  // the advanced world and — unless the tick stalled or a pass is still in flight — run
  // the empty-seat AI + standing orders. The driver owns the arm/stall/re-arm loop and the
  // HEARTBEAT_MS beat; `observe` calls driver.reschedule() when an action moves the
  // next-event time (or a join/leave flips the beat).
  driver = startClockDriver(room, {
    heartbeatMs: HEARTBEAT_MS,
    // One room timer, paced to the existing staggered two-game-hour AI cycle.
    // It does not add sockets or affect the real online-player count.
    backgroundHeartbeatMs: () => {
      if ((!botSeats.size && !avaBots.size) || !room.isStarted || room.state.match.status === 'ended') return null;
      const delay = aiSchedule.nextDelay(room.state.time, Object.keys(room.state.players), aiPolicy);
      return delay === null ? null : Math.max(HEARTBEAT_MS, delay / room.clockScale);
    },
    maxDelayMs: MAX_TIMER_MS,
    onTick: ({ progressed }) => {
      // ECON-6: почасовой экономический срез в пайплайн наблюдений (JSONL — кривые
      // казны/притока/arrears, агрегатор — arrears-часы). Раз в игровой час, не спам.
      // (Merged from main's inline onWake into the shared driver's onTick — same cadence.)
      if (room.state.time - lastEconAt >= HOUR) {
        lastEconAt = room.state.time;
        observe(economySnapshot(room.state));
      }
      // Same-instant runaway: work is due (ms 0) but the clock didn't move. SKIP the
      // drivers then — their submissions emit `action` observations that reschedule the
      // driver and reset its stall guard, which would spin a 0ms wake. The driver's own
      // STALL_LIMIT backs off; here we just avoid feeding it.
      const stalled = !progressed && room.msUntilNextEvent() === 0;
      aiClockStalled = stalled;
      if (!stalled) {
        // Гварда защищает от ВТОРОГО прохода поверх летящего (durable-комната ждёт
        // мейлбокс), но ту же гварду держит цикл ИИ короткими слайсами ~350 раз за
        // цикл. Пока тик просто проверял её и уходил, каждый удар сердца, попавший в
        // занятое окно, терял свой проход ЦЕЛИКОМ — вместе с авто-штурмом, отходом,
        // цепочками приказов и истечением заявок на места (ENTRY-3). Теперь
        // он не пропускает, а ОТКЛАДЫВАЕТ: `standingDue` отработает тот, кто отпустит.
        if (driversBusy) standingDue = true;
        else {
          standingDue = false; // проход идёт ПРЯМО СЕЙЧАС — прежний долг им и погашен
          runBackground('серверные драйверы', runStandingPass());
        }
        runBackground('распределённые ходы ИИ', runServerAI());
      }
      scheduleSave(); // persist the advanced world
    },
    onStall: () =>
      process.stderr.write(
        `wakeup driver idling (${id}): the world clock stalled (a same-instant scheduling loop) — ` +
          'check for a module scheduling events at its own instant.\n',
      ),
  });

  const botArrivals = AUTH && !ava ? startBotArrivals({
    config: BOT_POPULATION,
    canJoin: () => !aiStopped && room.state.match.status !== 'ended' && registry.entryOpen(id) &&
      botSeats.size < botMatchLimit(room.state, BOT_POPULATION.fillPercent),
    join: async () => {
      await rememberBots(await prepareBotPopulation({ matchId: id, room, bots: botStore,
        accounts: accountStore, data, config: BOT_POPULATION, restored: false, now: Date.now() }));
      driver?.reschedule();
      scheduleSave();
    },
    onError: (error) => process.stderr.write(`bot arrival deferred (${id}): ${String(error)}\n`),
  }) : null;

  return {
    id,
    room,
    restored: !!restoredSnap,
    async flush() {
      if (aiStopped) {
        // Producers may already be awaiting a durable action when timers stop.
        // Let them finish before draining the mailbox and capturing the final state.
        await Promise.all([botArrivals?.drain(), botSocial.drain(), drainBackground()]);
        await room.drain();
        await drainBackground(); // a committed terminal action can credit profiles
      }
      await snapshots.flush();
    },
    clearTimers(): void {
      botArrivals?.stop();
      botSocial?.stop();
      aiStopped = true;
      snapshots.stop();
      driver?.stop(); // cancel the pending wake
    },
  };
}

// Raise every hosted session, then expose them ALL through the registry so the
// client's match browser (GET /matches) lists each with its real status
// (map / rules / day / players) and joins go to `/matches/<id>`.
//
// ADDR-1: набор партий больше НЕ выводится из `MATCHES=N`. Живые партии перечисляет
// стор (`ongoingMatchIds` — нормализованный `status`, не JSONB), а переменная окружения
// описывает лишь первый запуск на пустом сторе. Иначе рестарт добавлял бы ещё N комнат
// к уже существующим, а `?join=proto` навсегда означал бы «комната №1 этого процесса».
// Само решение — в `matchRoster.ts` рядом с каноническим сервером, чтобы хосты не
// разъезжались в том, как называется партия.
const hosted: HostedMatch[] = [];
// Каталог во ВТОРОМ аргументе — им реестр выводит `kind` строки (`matchKind`: PvE это
// «у пресета есть секция `pve`»). Без него лента честно молчала бы про вид даже у
// сессии с режимом: поймано живым прогоном при BRW-0 — `modeId` в строке уже стоял,
// а `kind` у всех трёх партий приезжал `undefined`.
const registry = new MatchRegistry(accountStore, data);
refreshGrantedArsenal = async (accountId) => {
  const user = await userStore.findById(accountId);
  // Колода битвы корпораций законсервирована на момент блокировки состава (ARS-3): живой
  // каталог учётки обновляет только обычные партии.
  if (user) await syncAccountArsenal({ accountId, login: user.login, arsenal: arsenalStore, accounts: accountStore, registry, isOrdinary: (id) => !isAvaMatchId(id) });
};
/** Метаданные браузера: карта и режим берутся из САМОЙ сессии (`sessionMeta`, BRW-0) —
 *  карта из сохранённого состояния, режим из резолвнутого конфига комнаты. Сборка живёт
 *  в `packages/server`, чтобы у неё был один экземпляр на оба хоста и на тест ленты.
 *  `entryWindowMs` — SES-2.3: новичок занимает свободное место только внутри этого
 *  реального окна от создания сессии. */
const browserMeta = (room: MatchRoom): MatchMeta =>
  sessionMeta(room, {
    timeScale: TIME_SCALE,
    createdAt: Date.now(),
    entryWindowMs: ENTRY_WINDOW_MS,
  });

// Список партий на старте приходит из СТОРА, а не из `MATCHES=N`: `bootRoster` поднимает
// всё, что стор считает живым, и засевает только пустой стор (иначе каждый рестарт
// добавлял бы ещё N комнат). Без этого партия, созданная через `POST /matches`, жила бы
// лишь до перезапуска процесса — id уникален, но поднять её было бы некому.
// Битвы корпораций в этот список не входят: их поднимает не `bootRoster`, а свой путь ниже
// (CORP-5) — иначе рестарт поднял бы битву обычной партией, с чужими правилами мест.
const storedMatchIds = await matchStore.ongoingMatchIds();
const roster = bootRoster({ stored: storedMatchIds.filter((id) => !isAvaMatchId(id)), seedCount: MATCHES });
for (const id of roster.raise) {
  const h = await createHostedMatch(id);
  hosted.push(h);
  registry.register(h.room, browserMeta(h.room));
  if (!h.restored) await h.flush(); // засеянная партия тоже durable сразу, а не после хода
}
// Идущие битвы корпораций возвращаются битвами. Без учёток их некому играть — они ждут в
// сторе запуска с AUTH.
if (AUTH) for (const id of storedMatchIds.filter(isAvaMatchId)) await hostAvaMatch(id);
const matchIds = roster.raise;
const restoredCount = hosted.filter((h) => h.restored).length;
/**
 * ADDR-1: поднять НОВУЮ партию по требованию, а не на старте процесса.
 *
 * До этого сессии существовали только как «комнаты» из `MATCHES=N`, поэтому `?join=proto`
 * значил «первая комната ЭТОГО сервера», а не «партия #4821»: перезапуск отдал бы то же
 * имя другому миру, и закладка игрока указала бы не туда. Здесь партия рождается в момент
 * запроса и получает собственный id (`freeMatchId()` — то же правило, что у канонического
 * хоста), а `hosted` пополняется, иначе её таймеры не остановит и состояние не сбросит на
 * диск выход по SIGINT (см. конец файла).
 */
const MAX_HOSTED = 64; // потолок сессий в одном процессе: создание ограничено сверху,
// а не только per-IP лимитом маршрута — иначе память процесса растёт по запросу.
async function hostNewMatch(mapId: MapId = DEFAULT_MAP_ID, modeId?: string): Promise<HostedMatch> {
  if (shuttingDown) throw new Error('E_SHUTTING_DOWN');
  if (hosted.length >= MAX_HOSTED) throw new Error('match capacity reached'); // → 500, bounded
  // Номер свободен и у живых комнат, и в сторе: законченная партия тоже держит свой номер.
  const id = await freeMatchId(async (candidate) =>
    registry.has(candidate) || (await matchStore.load(candidate)) !== null,
  );
  const h = await createHostedMatch(id, mapId, modeId);
  hosted.push(h);
  registry.register(h.room, browserMeta(h.room));
  // Свежая партия ложится в стор СРАЗУ, а не при первой активности. Иначе её нет в
  // `ongoingMatchIds()` — а именно оттуда следующий старт берёт список (см. `bootRoster`
  // выше), — и рестарт до первого хода стёр бы партию вместе с уже розданным адресом.
  // Восстановленную трогать незачем: она в сторе по определению.
  if (!h.restored) await h.flush();
  return h;
}

/** CORP-5: поднять комнату битвы корпораций — на старте хоста и при запуске битвы. Вход
 *  закрыт для всех с первой секунды (`entryWindowMs: 0`): места раздаёт состав, а не
 *  очередь, поэтому в «Доступных» битвы нет, а её участники видят её в своих партиях. */
async function hostAvaMatch(id: string): Promise<HostedMatch> {
  const h = await createHostedMatch(id);
  hosted.push(h);
  registry.register(
    h.room,
    sessionMeta(h.room, { timeScale: TIME_SCALE, createdAt: Date.now(), entryWindowMs: 0 }),
  );
  return h;
}

/**
 * CORP-5: приёмник оркестратора — запустить битву, собранную из запертого состава.
 *
 * 1. **Первый снимок пишется, только если его нет.** Повтор после потерянной связи битвы с
 *    составом поднимает уже идущую битву, а не начинает её заново.
 * 2. **Комната сразу durable** вместе с якорем своих часов: рестарт до первого хода не
 *    теряет ни битву, ни время, прошедшее с её начала.
 * 3. **Места состава записываются за логинами.** Это зеркало состава, а не его замена (место
 *    решает `resolveAvaSeat`), и нужно оно затем, чтобы участник нашёл битву в своих партиях
 *    хаба и вошёл в неё оттуда. Повтор безвреден: привязка уже есть.
 */
async function raiseAvaBattle(spec: AvaSessionSpec): Promise<void> {
  if (shuttingDown) throw new Error('E_SHUTTING_DOWN');
  if (!registry.has(spec.matchId)) {
    if (!(await matchStore.load(spec.matchId))) {
      await matchStore.save({
        matchId: spec.matchId,
        dataVersion: spec.state.version.data,
        seq: 0,
        status: 'ongoing',
        state: spec.state,
      });
    }
    await (await hostAvaMatch(spec.matchId)).flush();
  }
  for (const [accountId, slot] of Object.entries(spec.seats)) {
    const user = await userStore.findById(accountId);
    if (user) await accountStore.resolveSeat(spec.matchId, user.login, [slot], slot);
  }
}

/** CORP-5: вход в битву корпораций. Место — из состава (`resolveAvaSeat`), заявка — та же,
 *  что у обычного входа (`joinSeat.ts`, правило 1). Окна входа у битвы нет: место у участника
 *  есть с её первой секунды. Стартовый арсенал не выдаётся и живой каталог не подмешивается —
 *  колода битвы законсервирована на момент блокировки состава (ARS-3). */
async function joinAvaBattle(
  id: string,
  room: MatchRoom,
  who: { login: string; accountId?: string | undefined; pwfp?: string | undefined },
): Promise<JoinResult | JoinFailure> {
  const ava = who.accountId ? await avaOrchestrator.resolveAvaSeat(id, who.accountId) : null;
  if (!ava?.ok) return { error: 'E_NOT_ROSTERED' };
  // Зеркало состава в посадочных записях: оно ведёт участника в битву из хаба (`raiseAvaBattle`).
  await accountStore.resolveSeat(id, who.login, [ava.playerId], ava.playerId);
  const seat = await admitSeat({
    matchId: id,
    claim: seatClaim({
      avaPlayerId: ava.playerId,
      claimed: room.state.players[ava.playerId]?.claimedAt !== undefined,
      knownFactions: [],
    }),
    reserved: false, // место дал состав, а не этот вход: отпускать нечего
    release: async () => undefined,
    room,
  });
  if (!seat.ok) return { error: seat.error, ...(seat.reason !== undefined ? { reason: seat.reason } : {}) };
  return { playerId: seat.playerId, token: await authCfg.signToken!(id, seat.playerId, who.accountId, who.pwfp) };
}

// UIX-4.4 (часть 2): service worker push-уведомлений (`build.mjs` → `dist/sw.js`). Только там,
// где push правда работает — есть ключи VAPID и вход в аккаунт (подписка привязана к нему);
// иначе нет ни `/sw.js`, ни разрешения воркера в политике документа.
const swPath = 'prototype/dist/sw.js';
const serviceWorker = vapid && AUTH && existsSync(swPath) ? readFileSync(swPath, 'utf8') : undefined;

const server = createMultiplayerServer({
  securityAudit,
  registry,
  host,
  port,
  indexHtml,
  ...(assets ? { assets } : {}),
  ...(serviceWorker !== undefined ? { serviceWorker } : {}),
  accountStore, // `?nick=` WS login resolves its seat here
  seatLock: SEAT_LOCK, // REL-5: nick+ticket identity; `?player=` refused when on
  // Accounts (SES-2.5): with AUTH on, the WS handshake requires a verified join token
  // (`?token=`) and ignores nick/ticket entirely — the token is minted by the join
  // route below, AFTER the session + entry-window checks passed.
  // The join token is also bound to the account's password: after a reset the old one
  // is refused here (and the reset itself closes the account's open sockets, below).
  ...(AUTH
    ? {
        auth: authCfg.auth,
        accountPwfp: (accountId: string) => currentPwfp(userStore, accountId),
        accountSeat: async (matchId: string, accountId: string) => {
          // CORP-5: место в битве корпораций решает её состав, как у боевого входа.
          const ava = isAvaMatchId(matchId) ? await avaOrchestrator.resolveAvaSeat(matchId, accountId) : null;
          if (ava) return ava.ok ? ava.playerId : null;
          if (isAvaMatchId(matchId)) return null; // связи битвы с составом нет — места нет ни у кого
          const user = await userStore.findById(accountId);
          return user ? accountStore.seatOf(matchId, user.login) : null;
        },
      }
    : {}),
  // TLS-2 (playtest-hardening): за https-прокси хост обязан уважать Origin-allowlist
  // (CSWSH) и реальные клиентские IP из X-Forwarded-For — без этой проводки env в
  // docker-compose ничего не включает, а per-IP rate-limit auth-роутов за прокси
  // схлопывается в один bucket. Зеркалит packages/server/src/main.ts.
  ...(authCfg.allowedOrigins ? { allowedOrigins: authCfg.allowedOrigins } : {}),
  trustProxy: process.env.TRUST_PROXY === '1',
  // Лимиты WS-рукопожатия на адрес — те же переменные, что у packages/server/src/main.ts.
  ...wsLimitsFromEnv(process.env),
  // RS-5.1: native TLS — TLS_KEY_FILE+TLS_CERT_FILE ⇒ this host serves wss:// itself (no
  // nginx needed for a single-node playtest). Unset ⇒ plain ws (proxy may terminate TLS).
  tls: tlsFromEnv(),
  // ZTP-1.1: /health names the running build (short commit sha baked in by image.yml).
  // This host is what the image runs, so it is the one that has to report it.
  version: buildVersion(process.env.GIT_SHA),
  ready: () => matchStore.ping?.() ?? Promise.resolve(true),
  // Aggregate metrics accept a separate observer credential; raw routes do not.
  ...(METRICS_TOKEN ? { operatorToken: METRICS_TOKEN } : {}),
  ...(METRICS_READER_TOKEN ? { metricsReaderToken: METRICS_READER_TOKEN } : {}),
  // Entry window (SES-2.3): the transport refuses a FIRST-time nick once the session's
  // window has closed (a returning seat-holder always reconnects). Same window the
  // browser feed uses to keep a closed session out of «Доступные». (In AUTH mode the
  // claim happens in the join ROUTE below — this transport gate covers the nick path.)
  admitNewSeat: (matchId) => registry.entryOpen(matchId),
  // The match-browser read-model + archive intents (GET /matches, POST …/archive).
  // The dev client and the admin console are `documents` below.
  httpRoutes: (app) => {
    // Личность зрителя — из СЕССИИ, когда аккаунты включены: иначе полный матч уходит
    // из «Доступных», а во вкладку «мои» не попадает, и вернуться в свою партию из
    // интерфейса нечем. Ссылка на `identifySession` намеренно ЛЕНИВАЯ (стрелка): этот
    // колбэк выполняется внутри `createMultiplayerServer` выше по файлу, а сам хук
    // объявлен ниже — прямая ссылка упала бы в TDZ ещё на старте.
    registerBrowserApi(app, registry, AUTH ? (request) => identifySession(request) : undefined);
    // Raw /metrics/* routes are OPERATOR-ONLY (`operatorAccess.ts`): the configured
    // bearer is required even on loopback; tokenless loopback is for dev only. The JSONL tail carries pre-fog
    // domain events (fleet routes, captures) and every player's economy — served to the
    // internet it was a map hack for every match on the host. Anyone else gets the
    // ordinary 404, as if the route did not exist.
    const operator = (req: { socket: { remoteAddress?: string }; headers: Record<string, unknown> }): boolean =>
      isOperatorRequest({ remoteAddress: req.socket.remoteAddress, headers: req.headers }, METRICS_TOKEN);
    const metricsReader = (req: { socket: { remoteAddress?: string }; headers: Record<string, unknown> }): boolean =>
      isMetricsReaderRequest({ remoteAddress: req.socket.remoteAddress, headers: req.headers }, METRICS_TOKEN, METRICS_READER_TOKEN);
    // NETA2-mon: the aggregator's FAILURE signals, live over HTTP — glance at desyncs /
    // rejects-by-code / dead-letters / advance-overflows / worst fps without waiting for
    // the on-exit JSONL summary, one `curl` from the host.
    // PTM-2.3: plus the telemetry pipeline itself — is it flowing during a test? Aggregates only.
    app.get('/metrics/summary', async (req, reply) => {
      if (!metricsReader(req)) return reply.callNotFound();
      const summary = metrics.summary();
      return {
        ...(operator(req) ? summary : metricsReaderSummary(summary)),
        journal: { match: matchLog.stats(), client: clientLog.stats() },
        ...(telemetryStats ? { telemetry: telemetryStats() } : {}),
      };
    });
    // NETA2-mon operator view: a one-glance "is anything going wrong right now?"
    // derived from the live MetricsAggregator. Returns a compact status with
    // thresholds so a playtest host can `curl /metrics/health` and read a single
    // line. `ok: false` + `alerts` lists every threshold breach. Operator-only, like
    // `/metrics/summary`.
    app.get('/metrics/health', async (req, reply) => {
      if (!operator(req)) return reply.callNotFound();
      const s = metrics.summary();
      const alerts: string[] = [];
      // Hard failures — these should ALWAYS be zero in a healthy match.
      if (s.desyncs > 0) alerts.push(`desyncs: ${s.desyncs} (client/server state divergence — should be 0)`);
      if (s.deadLetters > 0) alerts.push(`deadLetters: ${s.deadLetters} (scheduled events that failed to apply — should be 0)`);
      if (s.advanceOverflows > 0) alerts.push(`advanceOverflows: ${s.advanceOverflows} (advanceTo hit MAX_ADVANCE_STEPS — catch-up is starving)`);
      // Reject rate — >10% rejections means players are sending bad actions (bug or cheat).
      const rejectRate = s.actions.total > 0 ? s.actions.rejected / s.actions.total : 0;
      if (rejectRate > 0.1) alerts.push(`rejectRate: ${(rejectRate * 100).toFixed(1)}% (${s.actions.rejected}/${s.actions.total} — players sending invalid actions)`);
      // Latency — >200ms submit means the server is struggling under load.
      if (s.submitMs.count > 0 && s.submitMs.max > 200) alerts.push(`submitMs.max: ${s.submitMs.max}ms (server is slow under load)`);
      if (s.broadcastMs.count > 0 && s.broadcastMs.max > 200) alerts.push(`broadcastMs.max: ${s.broadcastMs.max}ms (fan-out is slow)`);
      // Client FPS — min < 30 means at least one player is seeing jank.
      if (s.clientFps && s.clientFps.count > 0 && s.clientFps.min < 30) alerts.push(`clientFps.min: ${s.clientFps.min} (a player is seeing lag)`);
      return {
        ok: alerts.length === 0,
        alerts,
        // Headline KPIs for a quick glance:
        players: { joins: s.joins, leaves: s.leaves, connected: s.joins - s.leaves },
        actions: { total: s.actions.total, ok: s.actions.ok, rejected: s.actions.rejected },
        domain: { battles: s.battles, captures: s.captures },
        latency: {
          submitMs: s.submitMs.count ? { avg: Math.round(s.submitMs.avg), max: s.submitMs.max } : null,
          broadcastMs: s.broadcastMs.count ? { avg: Math.round(s.broadcastMs.avg), max: s.broadcastMs.max } : null,
        },
      };
    });
    // NETA2-mon tail: the last N anomalous events from the JSONL log (rejects,
    // desyncs, slow submits, fat deltas, raw domain events, economy snapshots).
    // `?n=20` defaults to the last 20. Operator-only: these lines are pre-fog.
    app.get('/metrics/recent', async (req, reply) => {
      if (!operator(req)) return reply.callNotFound();
      const n = tailCount((req.query as { n?: unknown }).n);
      if (n === null) return reply.code(400).send({ error: 'E_BAD_REQUEST' });
      try {
        await matchLog.flush();
        return await jsonlTail(matchLog.currentFile(), n);
      } catch {
        return reply.code(503).send({ error: 'E_JOURNAL_UNAVAILABLE' });
      }
    });
    // Одна проверка сессии на все аккаунтные API: подпись валидна И пароль не менялся
    // (сброс отзывает старые сессии до того, как они займут место, SE-1.x). Стоит ВЫШЕ
    // первого потребителя намеренно: `const` в TDZ, прочитанный при регистрации роутов,
    // — та же ловушка, что уже ловили на `authMode` (REFM-0).
    const identifySession = async (request: {
      headers: Record<string, unknown>;
    }): Promise<Identity | null> => {
      const header = request.headers.authorization;
      const bearer =
        typeof header === 'string' && header.startsWith('Bearer ')
          ? header.slice('Bearer '.length).trim()
          : null;
      const who = bearer ? await authCfg.verifySession!(bearer) : null;
      return who?.ok ? liveSession(who.claim, userStore) : null;
    };
    if (AUTH) registerPlayerActivityApi(app, {
      store: pool ? new PostgresPlayerActivityStore(pool) : new MemoryPlayerActivityStore(),
      identify: identifySession,
      operator: metricsReader,
      ...(authCfg.allowedOrigins ? { allowedOrigins: authCfg.allowedOrigins } : {}),
    });
    telemetryStats = registerTelemetryApi(app, {
      log: clientLog,
      ...(AUTH ? { identify: identifySession } : {}),
      ...(actorOf ? { actorOf } : {}),
      ...(authCfg.allowedOrigins ? { allowedOrigins: authCfg.allowedOrigins } : {}),
    });
    // REL-7: seat selection — list the match's slots (faction, name, start planet,
    // taken) so the client can render a faction picker BEFORE joining. The player
    // chooses a slot, then GET /matches/:id/join?slot= reserves it.
    // ADDR-6: WHO may read that layout is the shared route's rule (`registerSeatsApi`) —
    // a match still open for entry serves anyone, a closed session only its own players,
    // because `start` is the homeworld the fog hides in game. Same move as the join
    // handshake (NETA2-7): one authorization rule, both hosts.
    registerSeatsApi(app, {
      seats: async (id) => {
        // Load-on-demand mirror of wsServer's pattern: a LAZY registry reloads an
        // evicted match here; this eager MatchRegistry has no `resolve`, so the
        // optional call is a typed no-op (kept so a lazy registry can slot in).
        const lazyRegistry = registry as {
          resolve?: (id: string) => Promise<MatchRoom | undefined>;
        };
        const room = registry.get(id) ?? (await lazyRegistry.resolve?.(id));
        if (!room) return null;
        // Кресло → ник: занятость и ник из одного ответа хранилища. Ник нужен клиенту в
        // дипломатии (строка игрока ведёт в его профиль); показывать его можно тем же,
        // кому этот расклад отдают вообще (ADDR-6, `registerSeatsApi`).
        const nickOf = new Map(
          (await accountStore.seatedNicks(id)).map((s) => [s.playerId, s.nick] as const),
        );
        // The homeworld from the match's setup, never from live ownership (which would
        // retell every capture and loss to whoever reads the layout).
        const starts = networkStartsOf(room.state, NETWORK_MODE);
        return {
          mapId: room.state.mapId ?? 'nexus',
          ended: room.state.match.status === 'ended',
          seats: Object.values(room.state.players).filter((p) => !p.npc).map((p) => ({
            playerId: p.id,
            name: p.name,
            faction: p.faction,
            start: starts[p.id] ?? null,
            taken: nickOf.has(p.id),
            nick: nickOf.get(p.id) ?? null,
          })),
        };
      },
      entryOpen: (id) => registry.entryOpen(id),
      seatOf: (id, login) => accountStore.seatOf(id, login),
      // Accounts host ⇒ a verified session names the reader; nick host ⇒ `?nick=`,
      // which is participation, not proof (that host has no sessions to check).
      ...(AUTH ? { identify: identifySession } : {}),
    });
    // The news feed (CORP-1) — public, the same module as the production entry.
    registerNewsApi(app, { feed: feedStore, announcements: announcementStore });
    // The public AvA feed (AVA-9) — confirmed matchups and results, read-only, no session.
    registerAvaFeed(app, { service: avaService });
    // The client self-configures: accounts mode shows the password field + goes
    // через register/login+join-token; nick mode keeps the old handshake.
    app.get('/auth/status', async () => ({ enabled: AUTH, accountDeletion: AUTH && !!pool && process.env.ACCOUNT_DELETION_ENABLED === '1' }));
    if (AUTH) {
      // Register/login (SE-1.x contour, shared with the production entry): scrypt
      // hashes, uniform-401 + decoy timing, per-IP rate limit — hands out the
      // session JWT the join route below authenticates.
      registerAuthApi(app, {
        users: userStore,
        onRegistered: async (accountId) => {
          try { await registrationRewards.ensure(accountId); }
          catch { process.stderr.write(`registration reward deferred for ${accountId}\n`); }
          await grantStarterArsenal(arsenalStore, accountId, starterArsenal, Date.now());
        },
        sendRecoveryMail: recoveryMailer(mailerFromEnv()),
        signSession: authCfg.signSession!,
        verifySession: authCfg.verifySession!,
        accountDeletionEnabled: !!pool && process.env.ACCOUNT_DELETION_ENABLED === '1',
        onSessionsRevoked: (accountId) => { revokeAccountConnections(registry, accountId); },
        // Новый пароль закрывает открытые игровые сокеты аккаунта во всех партиях.
        onPasswordChanged: (accountId) => {
          revokeAccountConnections(registry, accountId);
        },
        // Плейтест на десять человек часто приходит с ОДНОГО адреса (общий Wi-Fi, NAT
        // оператора), а первый вход стоит двух запросов — поэтому потолок задаётся
        // окружением, а не только дефолтом (`AUTH_RATE_MAX`/`AUTH_RATE_WINDOW_MS`).
        ...authRateFromEnv(process.env),
        // Recovery (/auth/recover + /auth/reset) mounts only when RESET_BASE_URL points the
        // emailed link at this deployment's origin, with verified SMTP delivery.
        ...(authCfg.signReset && authCfg.verifyReset && authCfg.resetBaseUrl
          ? {
              signReset: authCfg.signReset,
              verifyReset: authCfg.verifyReset,
              resetBaseUrl: authCfg.resetBaseUrl,
            }
          : {}),
      });
      // Друзья (FRIENDS-1) — тот же слайс, что в проде: список и заявки живут на
      // аккаунте, поэтому вкладка «Друзья» работает и на плейтест-хосте. Присутствие
      // читается из ЖИВОГО реестра комнат: занятое место в идущем матче — «в матче».
      registerFriendApi(app, {
        service: new FriendService({ friends: friendStore, users: userStore }),
        identify: identifySession,
        matches: {
          seatOf: async (login) => {
            for (const id of registry.ids()) {
              if (!(await accountStore.seatOf(id, login))) continue;
              const room = registry.get(id);
              if (!room) continue;
              return { matchId: id, days: Math.floor(room.state.time / MS_PER_DAY) };
            }
            return null;
          },
        },
      });
      registerCorporateMaintenance(app, process.env.CORPORATIONS_MAINTENANCE === '1');
      // The playable host shares the same corporation authority and durable storage, and
      // since CORP-5 the whole slice: challenges, rosters and medals beside the corps.
      if (corporationsEndpoint) {
        registerCorporateGateway(app, corporationsEndpoint, identifySession);
      } else {
        registerCorpApi(app, {
          service: corporateServices?.corp ?? new CorpService({ store: corpStore }),
          identify: identifySession,
        });
        registerAvaApi(app, { service: avaService, identify: identifySession });
        registerMedalApi(app, { service: medalService, identify: identifySession });
      }
      // Corp-warehouse handouts (ARS-6): a head/officer lends a corp item to a rostered fighter.
      registerCorpArsenalApi(app, { service: corpArsenalService, identify: identifySession });
      // MetaMarket (EC-3) — тот же слайс аукциона, что в проде: прото-хост не заводит
      // свою торговлю. Фаусет — из окружения, по умолчанию выключен.
      registerArsenalApi(app, { store: arsenalStore, identify: identifySession });
      const refreshAccountArsenal = async (who: { accountId: string; login: string }): Promise<void> => {
        await syncAccountArsenal({ ...who, arsenal: arsenalStore, accounts: accountStore, registry, isOrdinary: (id) => !isAvaMatchId(id) });
      };
      registerMetaEconomyApi(app, { economy: metaEconomy, identify: identifySession, onChanged: refreshAccountArsenal });
      registerMetaCommerce(app, metaEconomy, metaEconomyStore);
      app.get('/commerce/offers', async (_request, reply) => {
        reply.header('cache-control', 'no-store');
        return { offers: commerceOffers() };
      });
      registerMetaMarketApi(app, { market: metaMarket, identify: identifySession,
        onChanged: refreshAccountArsenal,
        canTrade: async (accountId) => (await commanderStore.xpOf(accountId)) >= metaCatalog.market.minimumAccountXp });
      registerProfileApi(app, { registrationRewards, profiles: profileStore, bots: botStore, users: userStore, commanders: commanderStore, premium: (accountId) => metaEconomy.isPremium(accountId),
        medalRewards: (accountId) => settleMedalRewards({ profiles: profileStore, commanders: commanderStore, economy: metaEconomy, table: metaCatalog.medals }, accountId),
        identify: identifySession });
      // Web Push (ONB-5, UIX-4.4): подписка привязана к аккаунту сессии; маршрут ключа
      // монтируется только при заданных VAPID.
      registerPushApi(app, {
        store: pushStore,
        identify: identifySession,
        ...(vapid ? { vapidPublicKey: vapid.publicKey } : {}),
      });
      registerLeaderboardApi(app, {
        commanders: commanderStore,
        users: userStore,
        corps: corpStore,
        identify: identifySession,
      });
      // ADM-1: админский слайс — состав живой партии и снятие игрока с места. Тот же
      // модуль, что у канонического хоста. Без `ADMIN_LOGINS` не монтируется вовсе:
      // «администраторов не задали» — это ОТСУТСТВИЕ поверхности, а не открытая дверь.
      registerAdminApi(app, {
        identify: identifySession,
        admins: ADMIN_LOGINS,
        users: userStore,
        announcements: announcementStore,
        roster: async (id) => {
          const room = registry.get(id);
          if (!room) return null;
          const bySeat = new Map(
            (await accountStore.seatedNicks(id)).map((s) => [s.playerId, s.nick] as const),
          );
          const online = new Set(room.connectedPlayers());
          return {
            matchId: id,
            day: Math.floor(room.state.time / MS_PER_DAY),
            ended: room.state.match.status === 'ended',
            entryOpen: registry.entryOpen(id),
            seats: Object.values(room.state.players).filter((p) => !p.npc).map((p) => ({
              playerId: p.id,
              name: p.name,
              faction: p.faction,
              nick: bySeat.get(p.id) ?? null,
              seated: p.seated === true,
              connected: online.has(p.id),
            })),
          };
        },
        kick: async (id, nick) => (await botStore.findByLogin(nick))
          ? { ok: false as const, code: 'E_BOT_SEAT_LOCKED' as const }
          : kickSeat({ matchId: id, room: registry.get(id), accounts: accountStore }, nick),
      });
      // Seat + short-lived join token (SES-2.5) through the SHARED match API, so the
      // handshake — per-IP rate-limit, identity gate, error→status mapping — lives in ONE
      // place with the production host (NETA2-7).
      registerMatchApi(app, {
        // ADDR-1: `POST /matches` поднимает НОВУЮ партию. Раньше этот хост его намеренно
        // не выставлял и жил только пачкой сессий из `MATCHES=N` — тогда «адрес партии»
        // физически не существовал: id был номером комнаты в процессе. Открытость
        // маршрута держат три границы, те же, что у канонического хоста: identity-гейт
        // (`identify` ниже — с AUTH=1 создать может только вошедший), per-IP лимит
        // самого `registerMatchApi` и потолок `MAX_HOSTED` на процесс.
        mapIds: MAP_IDS,
        // BRW-0: режимы берутся ИЗ КАТАЛОГА, а не списком здесь — иначе у хоста завёлся
        // бы второй перечень режимов, который молча разъедется с `data/modes.json`.
        modeIds: Object.keys(data.modes),
        createMatch: async (request) => {
          const h = await hostNewMatch(mapPreset(request?.mapId ?? DEFAULT_MAP_ID).id, request?.modeId);
          return { matchId: h.id, seats: playablePlayerIds(h.room.state) };
        },
        // Квота на учётку: не больше трёх ИДУЩИХ партий, созданных ею (`createQuota`).
        // Без неё одна учётка за пару минут выбирала весь `MAX_HOSTED`, и партии в сторе
        // переживали рестарт — создать новую не мог больше никто.
        ongoingMatchIds: () => matchStore.ongoingMatchIds(),
        // Identity = a signature-valid session, RE-CHECKED against the current password: a
        // reset revokes older sessions before they can claim/reclaim a seat (SE-1.x).
        identify: identifySession,
        // The seat belongs to the session's login (nobody joins as someone else). Entry
        // window (SES-2.3): a login that does NOT already hold a seat is a first-time claim —
        // refuse it once the window closed, BEFORE resolveSeat assigns a chair (a refused
        // newcomer never burns a chair); a seated login reconnects any time.
        // REL-7: `preferredSlot` lets the player choose a faction/start before joining.
        // BF-30: `preferredFaction` decouples faction from the slot's start point —
        // the player picks a faction independently; the server overrides the seat's
        // default faction after assigning it.
        join: async (
          id,
          { nick: login, accountId, pwfp, preferredSlot, preferredFaction, preferredScientists },
        ) => {
          const room = registry.get(id);
          if (!room) return { error: 'E_NO_MATCH' as const };
          // CORP-5: в битву корпораций входит только её состав, каждый — на своё место.
          if (isAvaMatchId(id)) return joinAvaBattle(id, room, { login, accountId, pwfp });
          const held = await accountStore.seatOf(id, login);
          if (!held && !registry.entryOpen(id)) return { error: 'E_ENTRY_CLOSED' as const };
          // Что достаётся игроку и переписывать ли дом — ОБЩЕЕ решение с боевым сервером
          // (`packages/server/src/joinSeat.ts`). Паритет двух хостов держится одним
          // модулем, а не двумя похожими лесенками условий: ровно на такой лесенке
          // канонический сервер и потерял `slot`/`faction` (ENTRY-1).
          const resolved = held
            ? { playerId: held, isNew: false }
            : await accountStore.resolveSeat(
                id,
                login,
                playablePlayerIds(room.state),
                preferredSlot as PlayerId | undefined,
              );
          const claim = seatClaim({
            resolved,
            // Возврат решает состояние, а не хранилище: бронь без заявки — это всё ещё
            // первый захват (правило 6 в joinSeat.ts).
            claimed: resolved ? room.state.players[resolved.playerId]?.claimedAt !== undefined : undefined,
            preferredFaction,
            // Дома ЭТОГО матча — тот же список, что уходит в `/matches/:id/seats`.
            knownFactions: [...new Set(Object.values(room.state.players).filter((p) => !p.npc).map((p) => p.faction))],
          });
          // ENTRY-3: заявка идёт ДЕЙСТВИЕМ через редьюсер, а не записью в состояние —
          // мутация мимо редьюсера не попадает в лог и ломает реплей. Отказ на любом шаге
          // отпускает кресло, которое забронировал этот вход (PT-09, см. joinSeat.ts).
          const seat = await admitSeat({
            matchId: id,
            claim,
            reserved: resolved?.isNew === true,
            release: () => accountStore.releaseSeat(id, login),
            room,
            scientists: preferredScientists,
          });
          if (!seat.ok) return { error: seat.error, ...(seat.reason !== undefined ? { reason: seat.reason } : {}) };
          if (accountId) {
            await grantStarterArsenal(arsenalStore, accountId, starterArsenal, Date.now());
            await refreshAccountArsenal({ accountId, login });
          }
          return {
            playerId: seat.playerId,
            token: await authCfg.signToken!(id, seat.playerId, accountId, pwfp),
          };
        },
      });
      // Commander progression (EC-*): the session reads its own durable lifetime XP.
      // The client turns `xp` into a level/points locally (prototype meta.ts), so the
      // end screen and hub show account-backed progress, not per-device localStorage.
      app.get('/commander/me', async (request, reply) => {
        const header = request.headers.authorization;
        const bearer =
          typeof header === 'string' && header.startsWith('Bearer ')
            ? header.slice('Bearer '.length).trim()
            : null;
        const who = bearer ? await authCfg.verifySession!(bearer) : null;
        const live = who?.ok ? await liveSession(who.claim, userStore) : null;
        if (!live) {
          void reply.code(401);
          return { error: 'E_AUTH' as const };
        }
        return { xp: await commanderStore.xpOf(live.accountId) };
      });
    }
  },
  // Остальные страницы хоста. Их отдаёт сервер, как и игру: с `no-store` и политикой по их
  // же скриптам. Заведённые здесь маршрутом, они получали политику для JSON, и скрипт не
  // запускался вовсе: с SE-7.1 оба адреса показывали пустую страницу (нашёл `smoke:net`).
  documents: [
    // ADM-1: страница пульта. Отдаётся только там, где администратор вообще назван —
    // иначе это была бы форма входа, за которой гарантированно нет ни одной двери.
    // Устаревший пульт так же вреден, как устаревшая игра, и показывал бы состав,
    // которого уже нет.
    ...(adminHtml !== undefined && AUTH && ADMIN_LOGINS.size > 0
      ? [{ routes: ['/admin'], html: adminHtml }]
      : []),
    // ADDR-3: адрес партии живёт ВНУТРИ той сборки, из которой в неё вошли, поэтому
    // дев-клиент отдаётся и на `/dev/game/<id>`. Без второго маршрута вход с дев-клиента
    // уводил бы на `/game/<id>`, то есть на игроцкую сборку без дев-оверлея — тихая
    // подмена клиента прямо посреди сессии.
    ...(playerHtml !== undefined && devHtml !== undefined
      ? [{ routes: ['/dev', '/dev/game/:matchId'], html: devHtml }]
      : []),
  ],
});
let wsUrl: string;
try {
  wsUrl = await server.listen();
} catch (err) {
  // The port never opened — say why (in plain language) instead of dumping an
  // unhandled-rejection stack, which reads as "the server doesn't start".
  const code = (err as { code?: string }).code;
  process.stderr.write(
    code === 'EADDRINUSE'
      ? `\nPort ${port} is already in use — another server is still running, or a stale one didn't exit.\n` +
          `  Free it, or start on another port:  PORT=${port + 1} pnpm host\n\n`
      : `\nFailed to start the server: ${(err as Error)?.message ?? String(err)}\n\n`,
  );
  process.exit(1);
}
const httpUrl = wsUrl.replace(/^ws/, 'http').replace(/\/matches.*$/, '');
// CORP-5: фоновый обход битв корпораций — раз в минуту, как у боевого входа, и только с
// учётками (см. блок служб выше). Запускается, когда хост уже принимает игроков.
const stopAvaSweeps = AUTH ? avaSweeps.start(60_000) : (): void => {};

// Pick the address a friend actually dials: a real LAN/public IPv4, never a
// VM-NAT/link-local one. `pnpm doctor` prints the full reachability breakdown.
const addrs = host === '0.0.0.0' ? ipv4s() : [];
const shareIp =
  addrs.find((a) => ipKind(a) === 'public') ?? addrs.find((a) => ipKind(a) === 'lan') ?? null;
const onLan = shareIp !== null;
const unreachableOnly = host === '0.0.0.0' && !onLan && addrs.length > 0;
const localHttp = httpUrl.replace('0.0.0.0', 'localhost'); // 0.0.0.0 isn't openable
const friendUrl = onLan ? `http://${shareIp}:${port}/` : null;
const liveSeatIds = Object.keys(hosted[0]!.room.state.players);
const firstSeat = liveSeatIds[0] ?? 'p1';
const lastSeat = liveSeatIds.at(-1) ?? firstSeat;

const lines = [
  'Void Dominion — prototype dev server (real core)',
  indexHtml
    ? playerHtml
      ? `  game   : ${localHttp}/   (player client · dev client with test tools: ${localHttp}/dev)`
      : `  game   : ${localHttp}/   (open in a browser → Connect)`
    : `  game   : run \`pnpm prototype\` first to serve the HTML at /`,
  `  health : ${localHttp}/health`,
  `  metrics: ${localHttp}/metrics/summary   (desyncs / rejects-by-code / dead-letters / latencies — live)`,
  DATABASE_URL
    ? `  store  : Postgres — durable${restoredCount > 0 ? ` (resumed ${restoredCount} saved match${restoredCount > 1 ? 'es' : ''})` : ''}`
    : '  store  : in-memory — a restart loses the matches (set DATABASE_URL for durability)',
  GATE
    ? '  gate   : ON — only validated action.v1 envelopes (clients auto-detect via welcome.gated)'
    : '  gate   : off — bare actions accepted (set GATE=1 for the release posture)',
  AUTH
    ? '  auth   : ACCOUNTS — POST /auth/register|login → session JWT; GET /matches/<id>/join → join token (nick/ticket handshakes refused)'
    : SEAT_LOCK
      ? '  seats  : LOCKED — a nick’s first join mints a ticket its client must present to reconnect'
      : '  seats  : open — any nick takes any free seat (set SEAT_LOCK=1 for the release posture)',
  AUTH
    ? ADMIN_LOGINS.size > 0
      ? `  admin  : ${localHttp}/admin   (roster + kick; commanded by: ${[...ADMIN_LOGINS].join(', ')})`
      : '  admin  : off — set ADMIN_LOGINS=<login,...> to command the roster (kick) from /admin'
    : '  admin  : off — needs accounts (AUTH_JWT_SECRET) before an admin can be named',
  TIME_SCALE > 1
    ? `  time   : ×${TIME_SCALE} fast-forward (1 real min ≈ ${(TIME_SCALE / 60).toFixed(1)} game-hours) — playtest mode`
    : '  time   : ×1 real-time (set TIME_SCALE=100 to fast-forward a playtest)',
  `  matches: ${MATCHES} session${MATCHES > 1 ? 's' : ''} in this process (${matchIds.join(', ')}) — set MATCHES=N for more; all listed in the in-game browser`,
  `  ai     : substitute bot takes an abandoned chair after ${(AI_GRACE_MS / 3_600_000).toFixed(1)}h offline (real time; set AI_GRACE_MS); a delegated Steward runs instantly`,
  `  join   : a NEW player may claim a free seat for ${(ENTRY_WINDOW_MS / 86_400_000).toFixed(1)} real days from a session's creation (set ENTRY_WINDOW_MS); a seated player reconnects any time`,
  `  map    : ${DEFAULT_MAP_ID} — ${NET_SEATS.length} claimable chairs; empty chairs are AI-driven`,
  '',
  '  Multiplayer test:',
  `   • You:     open ${localHttp}/  → enter a callsign → join`,
  onLan
    ? `   • Friends: open ${friendUrl}  (same Wi-Fi) → enter unique callsigns → join a free chair`
    : '   • Friends: run `pnpm host` (binds 0.0.0.0 → prints a LAN URL), or tunnel the port for remote players — see docs/multiplayer.md',
];
if (unreachableOnly) {
  lines.push(
    `   ⚠ only a non-routable address (${addrs.join(', ')}) — VM-NAT/link-local, unreachable off this box.`,
    `     Remote friend? Tunnel it:  cloudflared tunnel --url http://localhost:${port}   (or run \`pnpm doctor\`)`,
  );
}
// With ONE match listen() returns its full URL; with several it returns the base
// prefix (the client appends /<matchId>) — the printed example always shows a full,
// dialable URL for the first match.
const rawWs = (MATCHES === 1 ? wsUrl : `${wsUrl}/${matchIds[0]}`).replace('0.0.0.0', 'localhost');
lines.push(
  '',
  SEAT_LOCK
    ? `  raw ws : ${rawWs}?nick=<name>  (seat lock on — ?player= is refused)`
    : `  raw ws : ${rawWs}?player=${firstSeat}  ·  …?player=${lastSeat}`,
  '',
);
process.stdout.write(lines.join('\n'));

// The per-room offline scheduler self-arms when its clock driver is created inside
// createHostedMatch (a restored match with a due/pending event arms its first wake then;
// a fresh, empty schedule idles until the first join re-arms it via `observe`). No burst
// on resume — the clock picks up at the saved time (initiallyStarted).

// On Ctrl-C: print the playtest summary (counts gathered by `observe`) and where
// the raw JSONL landed, then close cleanly — the per-match data survives the run.
const printSummary = (): void => {
  const s = metrics.summary();
  const fmt = (m: Record<string, number>): string =>
    Object.entries(m)
      .map(([k, n]) => `${k}=${n}`)
      .join(' ') || '—';
  const ms = (x: { avg: number; max: number; count: number }): string =>
    x.count === 0 ? '—' : `avg ${x.avg.toFixed(1)}ms · max ${x.max.toFixed(1)}ms (${x.count})`;
  const kb = (x: { avg: number; max: number; count: number }): string =>
    x.count === 0 ? '—' : `avg ${(x.avg / 1024).toFixed(2)}KB · max ${(x.max / 1024).toFixed(2)}KB`;
  process.stdout.write(
    [
      '',
      '── playtest summary ──────────────────────────────',
      `  joins ${s.joins} · leaves ${s.leaves} · actions ${s.actions.total} (ok ${s.actions.ok} · rejects ${s.actions.rejected})`,
      `  by type   : ${fmt(s.actions.byType)}`,
      `  by reject : ${fmt(s.actions.rejectByCode)}`,
      `  battles ${s.battles} · captures ${s.captures} · desyncs ${s.desyncs} · dead-letters ${s.deadLetters} · overflows ${s.advanceOverflows}`,
      `  submit    : ${ms(s.submitMs)}`,
      `  advance   : ${ms(s.advanceMs)}`,
      `  broadcast : ${ms(s.broadcastMs)} · delta ${kb(s.deltaBytes)}`,
      s.clientFps
        ? `  client    : fps avg ${s.clientFps.avg.toFixed(0)} · min ${s.clientFps.min.toFixed(0)}` +
          (s.clientRttMs
            ? ` · rtt avg ${s.clientRttMs.avg.toFixed(0)}ms · max ${s.clientRttMs.max.toFixed(0)}ms`
            : '')
        : '  client    : — (перф-сэмплы не приходили)',
      s.end
        ? `  match end : winner ${s.end.winner ?? '—'}${s.end.reason ? ` (${s.end.reason})` : ''}`
        : '  match end : —',
      `  log file  : ${matchLog.currentFile()}`,
      '──────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
};

const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopAvaSweeps();
  printSummary();
  // M3: land the aggregated summary as the LAST JSONL line — the per-line log keeps
  // only anomalous broadcast/timing entries, so without this the report script would
  // have no full latency/delta aggregates to read.
  try {
    writeSummary();
  } catch {
    /* the report just falls back to the partial per-line data */
  }
  for (const h of hosted) h.clearTimers();
  // Выключение обязано ДОЙТИ до выхода. Без `catch` сбой финального сброса (недоступная
  // база) был не «вышли с ошибкой», а необработанным отклонением: процесс умирал, не
  // дойдя до `process.exit`, и оркестратор добивал его по таймауту SIGKILL — то есть
  // последний снапшот мира терялся именно там, где его и сохраняли.
  void (async () => {
    // Stop ingress first: HTTP/WS must not change a world after its final snapshot.
    await server.close();
    // An HTTP creation already in flight may have registered another hosted room.
    for (const h of hosted) h.clearTimers();
    // Meta observers are detached from reward delivery; an earlier refresh can
    // still submit durable room actions. New refreshes were disabled synchronously.
    while (arsenalRefreshes.size) await Promise.allSettled([...arsenalRefreshes]);
    const failures: unknown[] = [];
    for (const h of hosted) {
      try { await h.flush(); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'E_SHUTDOWN_SAVE');
    await rewardDelivery.stop();
    // The journals last: drain them, THEN write a fresh summary (its counters now match
    // the files; the one above stays as a fallback, the report keeps a run's LAST one)
    // and drain that. `flush()` waits for an append already in flight, so nothing is cut.
    await Promise.all([matchLog.flush(), clientLog.flush()]);
    writeSummary();
    await matchLog.flush();
    if (pool) await pool.end();
    process.exit(0);
  })().catch((err: unknown) => {
    process.stderr.write(`shutdown failed: ${String(err)}\n`);
    process.exit(1);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
