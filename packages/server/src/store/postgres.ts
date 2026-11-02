/**
 * Хранилища на Postgres. С SLIM-5 каждый домен в своём файле `store/postgres/`, схема — в
 * `postgres/schema.ts`; этот файл только собирает публичные имена, чтобы импорты не менялись.
 */
export { schemaFingerprint, migrate } from './postgres/schema';
export { PostgresMatchStore, PostgresReceiptStore } from './postgres/matches';
export {
  PostgresAccountStore,
  PostgresCommanderStore,
  PostgresUserStore,
} from './postgres/accounts';
export { PostgresCorpStore, PostgresCorpRentStore } from './postgres/corps';
export {
  PostgresAvaChallengeStore,
  PostgresAvaRosterStore,
  PostgresAvaResultStore,
  PostgresMedalStore,
  PostgresAvaFeedStore,
  PostgresAvaSessionStore,
} from './postgres/ava';
export { PostgresAnnouncementStore } from './postgres/news';
export { PostgresArsenalStore, PostgresDropStore } from './postgres/arsenal';
export { PostgresFriendStore } from './postgres/friends';
export { PostgresPushStore } from './postgres/push';
