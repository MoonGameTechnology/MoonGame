import type { AvaService } from './avaService';
import type { Stores } from './persistence';
import { corporateRequest, type CorporateEndpoint } from './corporateTransport';

/** No arbitrary method/property dispatch: only the game's required corporate reads
 * and settlement operations are callable over the internal gateway. */
export const CORPORATE_METHODS = {
  corpStore: ['getCorp', 'listCorps', 'membershipOf', 'membersOf', 'readyPlayersOf', 'appendAudit'],
  challengeStore: ['getChallenge', 'lockedMatchups'],
  rosterStore: ['rosterOf'],
  resultStore: ['get', 'recent', 'statsForCorp'],
  feedStore: ['recent'],
  ava: ['sweepExpired', 'sweepRosters', 'settleMatch', 'publicFeed', 'matchHistory'],
} as const;
export function corporateRemote<T extends object>(
  endpoint: CorporateEndpoint,
  name: keyof typeof CORPORATE_METHODS,
): T {
  const methods = CORPORATE_METHODS[name];
  return Object.fromEntries(
    methods.map((method) => [
      method,
      async (...args: unknown[]) => {
        const result = await corporateRequest(endpoint, 'POST', `/internal/${name}/${method}`, {
          args,
        });
        if (result.status !== 200) throw Error('E_CORPORATIONS_UNAVAILABLE');
        return (result.body as { value: unknown }).value;
      },
    ]),
  ) as T;
}
export function useRemoteCorporations(stores: Stores, endpoint: CorporateEndpoint): AvaService {
  stores.corpStore = corporateRemote(endpoint, 'corpStore');
  stores.challengeStore = corporateRemote(endpoint, 'challengeStore');
  stores.rosterStore = corporateRemote(endpoint, 'rosterStore');
  stores.resultStore = corporateRemote(endpoint, 'resultStore');
  stores.feedStore = corporateRemote(endpoint, 'feedStore');
  return corporateRemote(endpoint, 'ava');
}
