export {
  MatchRoom,
  type ActionReceipt,
  type MatchRoomOptions,
  type RoomObservation,
  type RoomPeer,
  type SubmitResult,
} from './matchRoom';
export {
  createMultiplayerServer,
  tlsFromEnv,
  SOCKET_FLOOD_MAX,
  SOCKET_FLOOD_WINDOW_MS,
  type MultiplayerServerHandle,
  type MultiplayerServerOptions,
} from './wsServer';
export { pveOrders, type PveOrdersOptions } from './pveOrchestrator';
export { newMatchId } from './matchId';
export {
  MatchRegistry,
  type MatchMeta,
  type MatchSummary,
  type MatchLists,
  type ArchiveResult,
} from './matchRegistry';
export {
  InMemoryRoomRegistry,
  LazyRoomRegistry,
  type LazyRoomRegistryOptions,
  type LoadedMatch,
  type RoomRegistry,
} from './roomRegistry';
export {
  registerBrowserApi,
  registerMatchApi,
  registerOpenMatchesFeed,
  registerSeatsApi,
  type CreatedMatch,
  type JoinFailure,
  type JoinResult,
  type MatchApiDeps,
  type OpenMatch,
  type OpenMatchesFeedDeps,
  type SeatLayout,
  type SeatView,
  type SeatsApiDeps,
} from './matchApi';
export { MatchKeeper, type MatchKeeperOptions } from './matchFactory';
export {
  startClockDriver,
  HEARTBEAT_MS,
  type ClockDriverHandle,
  type ClockDriverOptions,
} from './clockDriver';
export { pickAvaMap } from './avaMapPool';
export {
  arsenalSnapshotOf,
  grantStarterArsenal,
  validateStarterArsenal,
  type StarterArsenalTemplate,
} from './arsenal';
export { MetricsAggregator, type MetricsSummary, type SeriesStat } from './metrics';
export { InMemoryEphemeralStore, type EphemeralStore } from './ephemeral';
export {
  hmacSecret,
  signJoinToken,
  signResetToken,
  signSessionToken,
  verifyJoinToken,
  verifyResetToken,
  verifySessionToken,
  type JoinClaim,
  type JoinTokenResult,
  type JoinTokenSignConfig,
  type JoinTokenVerifyConfig,
  type ResetClaim,
  type ResetTokenResult,
  type SessionClaim,
  type SessionTokenResult,
  type VerifyKey,
} from './auth';
export {
  registerAuthApi,
  liveSession,
  pwFingerprint,
  authRateFromEnv,
  type AuthApiDeps,
  type Mailer,
} from './authApi';
// EC-3 · MetaMarket — аукцион мета-предметов. Экспортируется, чтобы прото-хост монтировал
// ТОТ ЖЕ слой, что прод (одна реализация торговли, а не две — как у friends/corp).
export {
  MemoryMetaMarket,
  PostgresMetaMarket,
  DEFAULT_FAUCET,
  META_MARKET_FEE,
  type MetaMarket,
} from './metaMarket';
export { registerMetaMarketApi, type MetaMarketApiDeps } from './metaMarketApi';
// FRIENDS-1 — roster API + rules, exported so the playtest host mounts the SAME slice
// as production (one implementation of the social graph, not two).
export {
  registerFriendApi,
  ONLINE_MS,
  type FriendApiDeps,
  type FriendPresence,
  type FriendRow,
  type MatchPresenceSource,
} from './friendApi';
// RANK-1 — leaderboard API, exported for the same reason as the friends slice.
export {
  registerLeaderboardApi,
  rankCorps,
  BOARD_PAGE,
  type BoardRow,
  type BoardView,
  type LeaderboardApiDeps,
} from './leaderboardApi';
// ADM-1 — админский слайс (состав матча + кик), экспортируется по той же причине,
// что и остальные: оба хоста монтируют ОДИН модуль, а не два похожих.
export {
  registerAdminApi,
  adminLoginsFromEnv,
  isAdmin,
  type AdminApiDeps,
  type AdminKickRefusal,
  type AdminRoster,
  type AdminSeatRow,
} from './adminApi';
export { kickSeat, seatKickAction, type KickSeatDeps } from './seatKick';
export {
  FriendService,
  FRIEND_LIMIT,
  type FriendErrorCode,
  type FriendServiceDeps,
} from './friendService';
export { configFromEnv, type ServerConfig } from './serverConfig';
export { hashPassword, verifyPassword, type ScryptParams } from './password';
export type {
  ClientActionMessage,
  ClientActionEnvelopeMessage,
  ClientMessage,
  ClientPingMessage,
  ServerErrorCode,
  ServerErrorMessage,
  ServerMessage,
  ServerPongMessage,
  ServerRejectionMessage,
  ServerStateMessage,
  ServerWelcomeMessage,
} from './protocol';
export { parseClientMessage, serializeServerMessage } from './protocol';
export {
  type AccountStore,
  type CommanderStore,
  type FriendEdge,
  type FriendParty,
  type FriendStore,
  type MatchSnapshot,
  type MatchStore,
  type ReceiptStore,
  type SeatAssignment,
  type StoredReceipt,
  type UserRecord,
  type UserStore,
  MemoryAccountStore,
  MemoryArsenalStore,
  MemoryCommanderStore,
  MemoryMatchStore,
  MemoryReceiptStore,
  MemoryFriendStore,
  MemoryUserStore,
  migrate,
  PostgresAccountStore,
  PostgresArsenalStore,
  PostgresCommanderStore,
  PostgresMatchStore,
  PostgresFriendStore,
  PostgresReceiptStore,
  PostgresUserStore,
} from './store';
