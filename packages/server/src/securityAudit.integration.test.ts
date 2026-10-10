import { describe, expect, it } from 'vitest';
import { createInitialState, createKernel, parseGameData } from '@void/shared-core';
import { MatchRoom, type RoomPeer } from './matchRoom';
import { createMultiplayerServer } from './wsServer';
import { SecurityAudit } from './securityAudit';

const data = parseGameData({
  version: 'test',
  resources: ['marker'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  sectors: {},
  planetTypes: {},
});
function makeRoom(audit: SecurityAudit): MatchRoom {
  const state = createInitialState({ seed: 'audit', version: { data: 'test', manifest: 'test' } });
  state.players.p1 = {
    id: 'p1',
    name: 'private-login',
    faction: 'p1',
    status: 'active',
    resources: {},
  };
  return new MatchRoom({
    id: 'private-match',
    initialState: state,
    kernel: createKernel([]),
    data,
    securityAudit: audit,
  });
}

describe('security audit is wired to actual HTTP and game refusals', () => {
  it('emits an alert for HTTP authorization failures without recording request secrets', async () => {
    const lines: string[] = [];
    const audit = new SecurityAudit(
      (line) => lines.push(line),
      () => 0,
    );
    const server = createMultiplayerServer({
      room: makeRoom(audit),
      securityAudit: audit,
      httpRoutes: (app) => {
        app.get('/private', async (_request, reply) => reply.code(401).send({ error: 'E_AUTH' }));
      },
    });
    const url = new URL(await server.listen());
    url.protocol = 'http:';
    url.pathname = '/private';
    url.search = '?token=private-token';
    try {
      for (let i = 0; i < 20; i++)
        await fetch(url, { headers: { authorization: 'Bearer private-bearer' } });
      expect(lines.map((l) => JSON.parse(l))).toContainEqual(
        expect.objectContaining({ kind: 'security.alert', category: 'auth', count: 20 }),
      );
      expect(lines.join('')).not.toMatch(/private-token|private-bearer|private-login/);
    } finally {
      await server.close();
    }
  });
  it('records real rejected game frames and keeps identifiers pseudonymous', async () => {
    const lines: string[] = [];
    const audit = new SecurityAudit(
      (line) => lines.push(line),
      () => 0,
    );
    const room = makeRoom(audit);
    const peer: RoomPeer = { send: () => {} };
    room.addPeer('p1', peer);
    for (let i = 0; i < 20; i++) await room.receive('p1', peer, 'private malformed token');
    expect(lines.map((l) => JSON.parse(l))).toContainEqual(
      expect.objectContaining({ kind: 'security.alert', category: 'actions' }),
    );
    expect(lines.join('')).not.toMatch(/private-match|private-login|private malformed/);
  });
});
