/** Automation with gameplay consequences belongs to the same source revision. */
import type { GameState } from '../packages/shared-core/src/index';
import { SWARM_MEMORY_WINDOW } from '../packages/shared-core/src/index';
import { data } from '../prototype/src/gameData';
import { aiOrders } from '../prototype/src/ai';
import { botBehaviorOrders } from '../prototype/src/botBehavior';
import { aiOrderSlices } from '../prototype/src/aiOrderSlices';
import { serverAutoRetreatActions, serverAutoAssaultActions, serverChainActions } from '../prototype/src/serverDrivers';
import { chainStamp } from '../decisions/actions';
import { pveOrders } from '../packages/server/src/pveOrchestrator';
import { standingOrderTickActions } from '../packages/server/src/standingOrderDriver';
import type { RulesetDrivers } from '../packages/server/src/rulesets/types';

export const drivers: RulesetDrivers = {
  ai: aiOrders, bot: botBehaviorOrders, slices: aiOrderSlices,
  pve: (state, seq, session) => pveOrders(state, data, { seq, session, memoryWindow: SWARM_MEMORY_WINDOW.weak }),
  *standing(state: () => GameState) {
    // Resume each phase after the host has applied the preceding phase's orders.
    for (const item of serverAutoRetreatActions(state())) yield { actions: item.actions, stopOnFailure: false };
    for (const item of serverAutoAssaultActions(state())) yield { actions: item.actions, stopOnFailure: true };
    for (const chain of serverChainActions(state(), state().time)) {
      yield { stopOnFailure: false, actions: [...(chain.patch ? [chainStamp(chain.owner, chain.fleetId, chain.patch.steps, chain.patch.waitUntil)] : []), ...chain.actions] };
    }
  },
  canonicalStanding: (state, probe) => standingOrderTickActions(state, data, probe),
};
