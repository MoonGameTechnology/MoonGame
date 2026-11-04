import { expect, it } from 'vitest';
import { MemoryAccountStore, MemoryUserStore } from './store';
import { publicSeatNicks } from './publicSeatNicks';
import { nickSeatAccounts } from './commanderCredit';

it('hides a pending-deletion nick while preserving occupancy and the existing reward exclusion', async () => {
  const accounts = new MemoryAccountStore();
  const users = new MemoryUserStore();
  await users.createUser('AuditPilot', 'hash');
  await accounts.resolveSeat('audit', 'AuditPilot', ['green']);
  expect((await publicSeatNicks(accounts, users, 'audit')).get('green')).toBe('AuditPilot');
  const user = await users.findUser('AuditPilot');
  await users.requestDeletion(user!);
  const published = await publicSeatNicks(accounts, users, 'audit');
  expect(published.has('green')).toBe(true);
  expect(published.get('green')).toBeNull();
  expect(await accounts.seatOf('audit', 'AuditPilot')).toBe('green');
  expect(await nickSeatAccounts(accounts, users, 'audit')()).toEqual({});
  expect((await publicSeatNicks(accounts, undefined, 'audit')).get('green')).toBe('AuditPilot');
});
