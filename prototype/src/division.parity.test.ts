import { describe, it, expect } from 'vitest';
import {
  GROUND_ROSTER as protoRoster,
  OFFICERS as protoOfficers,
} from './groundcombat';
import { DEFAULT_TEMPLATES as protoTemplates, OFFICER_TEMPLATES as protoOfficerTemplates } from './formations';
import {
  GROUND_ROSTER as coreRoster,
  OFFICERS as coreOfficers,
  DEFAULT_TEMPLATES as coreTemplates,
  OFFICER_TEMPLATES as coreOfficerTemplates,
} from '../../packages/shared-core/src/index';

// H4 parity — the prototype's already-tuned division/ground-combat content
// (`groundcombat.ts`/`formations.ts`) and its port into `@void/shared-core`
// (`state/groundCombat.ts`/`data/formations.ts`) are two DELIBERATELY separate
// copies (the port only wired divisions into the canonical multiplayer server;
// the prototype's own implementation is untouched, see docs/backlog.md's H4
// entry). Nothing enforces they stay in sync — this pins them so a tuning pass
// on one side that forgets the other fails loudly here, instead of the two
// hosts (prototype netserver vs. the canonical server) silently diverging.

describe('H4 content parity — prototype vs. shared-core', () => {
  it('the ground roster (hp / atk / def matrix) is identical', () => {
    expect(coreRoster).toEqual(protoRoster);
  });

  it('the officer archetypes are identical', () => {
    expect(coreOfficers).toEqual(protoOfficers);
  });

  it('the default division templates are identical', () => {
    expect(coreTemplates).toEqual(protoTemplates);
  });

  it('the officer premade templates are identical', () => {
    expect(coreOfficerTemplates).toEqual(protoOfficerTemplates);
  });
});
