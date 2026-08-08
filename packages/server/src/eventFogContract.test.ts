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

/**
 * Blank out comments, keeping every other offset intact (each comment character becomes a
 * space, newlines survive). The scanner reads source as characters, so a comment is not
 * inert text to it: its words land in the key token, its braces close literals early, and
 * a commented-out `emit(` looks like a live call site. Blanking them first is the one fix
 * for all three — and it is why this runs before ANY other parsing.
 *
 * String and template literals are honoured, so a `//` inside a payload value (a URL) is
 * left alone. A `//` inside a regex literal is not distinguished — that would need real
 * lexing, and getting it wrong here can only blank too much, which fails CLOSED (a key
 * goes missing → red test) rather than letting a defect through.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];

    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i += 1) out += src[i] === '\n' ? '\n' : ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < src.length) {
        const c = src[i]!;
        out += c;
        i += 1;
        if (c === '\\') {
          if (i < src.length) {
            out += src[i];
            i += 1;
          }
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Top-level keys of an object literal — shorthand and `key:` alike. Anything nested or
 *  spread is skipped: only what is unconditionally present counts. */
function topLevelKeys(rawBody: string): string[] {
  const body = stripComments(rawBody);
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

/** Every `emit('type', { … })` in ONE source, with its guaranteed payload keys. Split out
 *  from the directory walk so the scanner's own behaviour can be tested on a fixture. */
function emitSitesIn(file: string, rawSrc: string): EmitSite[] {
  const src = stripComments(rawSrc);
  const sites: EmitSite[] = [];

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
    sites.push({ file, type: m[2]!, keys: topLevelKeys(src.slice(open + 1, close)) });
  }

  return sites;
}

/** Every `emit('type', { … })` in the module tree, with its guaranteed payload keys. */
function collectEmitSites(): EmitSite[] {
  const sites: EmitSite[] = [];

  for (const name of readdirSync(MODULES_DIR)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
    sites.push(...emitSitesIn(name, readFileSync(path.join(MODULES_DIR, name), 'utf8')));
  }

  return sites;
}

/**
 * AUD-15 — the scanner's own guards.
 *
 * The scanner reads source character by character, so anything it fails to understand it
 * mis-reads as "this event names no audience" — a RED test against correct code. Comments
 * were exactly that blind spot: their text landed in the key token and swallowed the key
 * that followed. Every case below fails without `stripComments`.
 */
describe('the scanner itself — comments must not hide keys (AUD-15)', () => {
  it('counts a key that follows a line comment', () => {
    expect(topLevelKeys('\n// the player this struck\nplayerId,\nruleId,\n')).toEqual([
      'playerId',
      'ruleId',
    ]);
  });

  it('counts a key that follows a comment containing a colon', () => {
    // The colon is what first exposed this: it flipped `expectingKey` mid-literal.
    expect(topLevelKeys('\n// address: the victim\nplayerId,\n')).toEqual(['playerId']);
  });

  it('counts a key that follows a block comment', () => {
    expect(topLevelKeys('/* note */ playerId, ruleId,')).toEqual(['playerId', 'ruleId']);
  });

  it('counts a key that follows a trailing comment on the previous line', () => {
    expect(topLevelKeys('playerId, // spelled out\nruleId,')).toEqual(['playerId', 'ruleId']);
  });

  it('still ignores a `//` that is inside a string, not a comment', () => {
    // Stripping comments must not eat payload values — a URL is not a comment.
    expect(topLevelKeys("url: 'https://example.test', playerId,")).toEqual(['url', 'playerId']);
  });

  it('reads the whole literal when a comment contains a closing brace', () => {
    // A `}` in a comment used to end the literal early, dropping every key after it.
    const src = "h.emit('effect.applied', {\n  // a spread } would break this\n  playerId,\n});";
    expect(emitSitesIn('probe.ts', src)).toEqual([
      { file: 'probe.ts', type: 'effect.applied', keys: ['playerId'] },
    ]);
  });

  it('does not collect an emit that is itself commented out', () => {
    // Dead code held the scanner to a contract it no longer has to keep.
    const src = "// h.emit('dead.code', { nothing });\nh.emit('real.one', { playerId });";
    expect(emitSitesIn('probe.ts', src)).toEqual([
      { file: 'probe.ts', type: 'real.one', keys: ['playerId'] },
    ]);
  });
});

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
