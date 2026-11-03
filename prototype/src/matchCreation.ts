import { matchCreationAllowed } from '../../decisions/matchCreation';
import { httpBase } from '../../decisions/matchQuery';
import { tokenFor } from '../../decisions/sessionStore';

type Server = { base: string; nick: string };
interface Creator extends Server { readonly token: string | null }
let resolveServer: () => Server | null = () => null;
let grant: Creator | null = null;
let generation = 0;

function current(): Creator | null {
  try {
    const server = resolveServer();
    return server ? { ...server, token: tokenFor(localStorage, server.base, server.nick) } : null;
  } catch { return null; }
}
function same(a: Creator | null, b: Creator | null): boolean {
  return a !== null && b !== null && a.base === b.base && a.nick === b.nick && a.token === b.token;
}

/** A grant belongs to one server, login and session token; it is never persisted. */
export function matchCreator(): Creator | null {
  return grant && same(grant, current()) ? grant : null;
}
export function isCurrentMatchCreator(creator: Creator): boolean {
  // A lost grant blocks new requests; it must not discard an already-created match.
  return same(creator, current());
}
export function canCreateOnlineMatch(): boolean { return matchCreator() !== null; }

function renderControls(): void {
  const allowed = canCreateOnlineMatch();
  const setup = document.getElementById('setup-network-create') as HTMLButtonElement | null;
  if (setup) { setup.style.display = allowed ? '' : 'none'; setup.disabled = !allowed; }
  const button = document.getElementById('match-create-go') as HTMLButtonElement | null;
  if (button) button.disabled = !allowed;
  // The browser also owns tab/loading visibility. A grant alone cannot open its card.
  const card = document.getElementById('match-create');
  if (card && !allowed) card.style.display = 'none';
}
export function forgetMatchCreation(): void {
  generation++;
  grant = null;
  renderControls();
}
export function initMatchCreation(server: () => Server | null): void {
  resolveServer = server;
  forgetMatchCreation();
}

/** Replies from a superseded account, server or request cannot restore a grant. */
export async function refreshMatchCreation(): Promise<void> {
  const request = ++generation;
  const creator = current();
  // A confirmed grant for the same session stays stable during background polling.
  if (!same(grant, creator)) { grant = null; renderControls(); }
  if (!creator) return;
  try {
    const response = await fetch(`${httpBase(creator.base)}/matches/capabilities`, {
      ...(creator.token ? { headers: { authorization: `Bearer ${creator.token}` } } : {}),
      signal: AbortSignal.timeout(5000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (request !== generation) return;
    grant = same(creator, current()) && matchCreationAllowed({ status: response.status, body }) ? creator : null;
    renderControls();
  } catch {
    if (request === generation) { grant = null; renderControls(); }
  }
}
