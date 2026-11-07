import type { MatchSnapshot } from '../store/types';
import type { MatchRulesetBinding } from './types';
import { RulesetError } from './types';
import { canonical } from './canonical';

export function assertSnapshotPin(snapshot: Pick<MatchSnapshot, 'state' | 'dataVersion'>, pin: MatchRulesetBinding): void {
  if (snapshot.dataVersion !== pin.version.data || canonical(snapshot.state.version) !== canonical(pin.version))
    throw new RulesetError('E_RULESET_PIN_CONFLICT');
}

/** An omitted pin cannot erase an existing one; replacement is never an update. */
export function retainedPin(snapshot: MatchSnapshot, previous?: MatchRulesetBinding): MatchRulesetBinding | undefined {
  if (previous && snapshot.ruleset && canonical(previous) !== canonical(snapshot.ruleset))
    throw new RulesetError('E_RULESET_PIN_CONFLICT');
  const pin = previous ?? snapshot.ruleset;
  if (pin) assertSnapshotPin(snapshot, pin);
  return pin;
}
