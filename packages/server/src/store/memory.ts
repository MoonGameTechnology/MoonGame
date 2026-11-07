/**
 * Хранилища в памяти (тесты и дев-хост). С SLIM-5 каждый домен в своём файле
 * `store/memory/`; этот файл только собирает публичные имена, чтобы импорты не менялись.
 */
export { MemoryMatchStore, MemoryReceiptStore } from './memory/matches';
export { MemoryAccountStore, MemoryCommanderStore, MemoryUserStore } from './memory/accounts';
export { MemoryCorpStore, MemoryCorpRentStore } from './memory/corps';
export {
  MemoryAvaChallengeStore,
  MemoryAvaResultStore,
  MemoryMedalStore,
  MemoryAvaFeedStore,
  MemoryAvaSessionStore,
  MemoryAvaRosterStore,
} from './memory/ava';
export { MemoryAnnouncementStore } from './memory/news';
export { MemoryArsenalStore, MemoryDropStore } from './memory/arsenal';
export { MemoryFriendStore } from './memory/friends';
export { MemoryPushStore } from './memory/push';
