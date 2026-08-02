/**
 * ONB-5 · Return digest — moved into `@void/shared-core`'s `util/recap.ts` so the
 * server (`packages/server/src/push.ts`, ONB-5 push) can build off the SAME logic
 * instead of forking it. Re-exported here so `main.ts` / `recap.test.ts` keep their
 * existing import path.
 */
export {
  buildRecap,
  isHighEvent,
  type Recap,
  type RecapEvent,
  type RecapItem,
} from '../../packages/shared-core/src/index';
