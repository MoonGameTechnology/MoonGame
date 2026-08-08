import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * AUD-2 — the fog-routing contract, enforced.
 *
 * `MatchRoom.eventVisibleTo` decides who may see a domain event by reading the KEY NAMES
 * of its payload: there is no schema, no registry, just a convention every core module is
 * expected to follow. A module that names its addressee `target` or `recipient` gets its
 * events silently HIDDEN from that player — fail-closed, so nothing leaks, but the
 * mechanic simply never reaches the person it was written for. Nothing catches that
 * today: the reducer is happy, the tests are green, the event just evaporates on the way
 * out. `matchRoom.ts` asks for this test in its own comment ("extend the lists below
 * together with a test in matchRoom.test.ts").
 *
 * WHY A SOURCE SCAN AND NOT A RUNTIME SWEEP. Collecting events from a simulated match
 * would only cover what that particular match happens to fire — the rare branches (a hero
 * lane expiring, a steward hand-off) are exactly the ones that slip through. The contract
 * is about the CONVENTION, so it is checked against every call site in the tree.
 *
 * WHY CONDITIONAL KEYS DON'T COUNT. A key contributed by a spread (`...(x ? { at } : {})`)
 * is present only sometimes, so the event is routable only sometimes — and invisible the
 * rest of the time. That is the same defect, just rarer, so the scanner counts only keys
 * that are unconditionally present.
 */

const MODULES_DIR = fileURLToPath(new URL('../../shared-core/src/modules', import.meta.url));

/** Keys `eventVisibleTo` routes by. Mirrors `matchRoom.ts` — the two are meant to be read
 *  side by side, and this test is what makes them stay together. */
const AUDIENCE = ['owner', 'playerId', 'a', 'b', 'from', 'to', 'buyer', 'seller'] as const;
const PLACE = ['location', 'planetId', 'at'] as const;
const OWNERSHIP = ['fleetId'] as const;
const ROUTABLE = new Set<string>([...AUDIENCE, ...PLACE, ...OWNERSHIP]);

/** Events `eventVisibleTo` shows to everybody before it ever looks at the payload. */
const isBroadcast = (type: string): boolean =>
  type === 'time.advanced' || type.startsWith('match.');

/** `hero.*` short-circuits to `p.owner === playerId`, so for those the audience list is
 *  NOT consulted — only `owner` will do. */
const isHeroOnly = (type: string): boolean => type.startsWith('hero.');

/**
 * Known, deliberate exceptions. Format follows the `.trivyignore` convention in this repo:
 * an entry needs a reason and a date, not just a name.
 */
const ALLOWLIST = new Map<string, string>([
  // Empty by design. The only entry this list ever held (`effect.applied`, 2026-08-05)
  // was retired by AUD-11: `effectsModule` now names its audience unconditionally.
]);

interface EmitSite {
  file: string;
  type: string;
  keys: string[];
}

/** Top-level keys of an object literal — shorthand and `key:` alike. Anything nested or
 *  spread is skipped: only what is unconditionally present counts. */
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let token = '';
  let expectingKey = true;

  for (const ch of body) {
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;

    if (depth === 0 && ch === ',') {
      const shorthand = token.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(shorthand)) keys.push(shorthand);
      token = '';
      expectingKey = true;
      continue;
    }
    if (depth === 0 && ch === ':' && expectingKey) {
      const named = token.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(named)) keys.push(named);
      token = '';
      expectingKey = false;
      continue;
    }
    if (depth === 0) token += ch;
  }
  const last = token.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(last)) keys.push(last);

  return [...new Set(keys)];
}

/** Every `emit('type', { … })` in the module tree, with its guaranteed payload keys. */
function collectEmitSites(): EmitSite[] {
  const sites: EmitSite[] = [];

  for (const name of readdirSync(MODULES_DIR)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    const src = readFileSync(path.join(MODULES_DIR, name), 'utf8');

    const call = /emit\(\s*(['"`])([^'"`]+)\1\s*,/g;
    let m: RegExpExecArray | null;
    while ((m = call.exec(src)) !== null) {
      const open = src.indexOf('{', m.index + m[0].length - 1);
      // No object literal right after the comma (a variable, a call) — the scanner cannot
      // read those keys, so it must not pretend they are missing.
      if (open < 0 || open > m.index + m[0].length + 2) continue;

      let depth = 0;
      let close = open;
      for (; close < src.length; close += 1) {
        if (src[close] === '{') depth += 1;
        else if (src[close] === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      sites.push({ file: name, type: m[2]!, keys: topLevelKeys(src.slice(open + 1, close)) });
    }
  }

  return sites;
}

describe('fog routing contract — every emitted event must be addressable', () => {
  const sites = collectEmitSites();

  it('finds the emit sites at all (guards the scanner itself)', () => {
    // A scanner that silently matches nothing would make every assertion below vacuous.
    expect(sites.length).toBeGreaterThan(50);
  });

  it('routes every non-broadcast event by at least one key MatchRoom reads', () => {
    const unroutable = sites
      .filter((s) => !isBroadcast(s.type))
      .filter((s) => !ALLOWLIST.has(s.type))
      .filter((s) => (isHeroOnly(s.type) ? !s.keys.includes('owner') : !s.keys.some((k) => ROUTABLE.has(k))))
      .map((s) => `${s.file}: ${s.type} { ${s.keys.join(', ')} }`);

    expect(unroutable).toEqual([]);
  });

  it('keeps the allowlist honest — no stale entries', () => {
    const stale = [...ALLOWLIST.keys()].filter((type) => !sites.some((s) => s.type === type));
    expect(stale).toEqual([]);
  });
});
