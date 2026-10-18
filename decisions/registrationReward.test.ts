import { expect, it } from 'vitest';
import { parseRegistrationReward } from './registrationReward';
import { medalGrade, REGISTRATION_REWARD } from '../packages/protocol/src/playerProfile';

it('only accepts an explicit receipt for the known medal and its actual XP award', () => {
  const receipt = { ...REGISTRATION_REWARD, accepted: false };
  expect(parseRegistrationReward(receipt)).toEqual(receipt);
  for (const bad of [
    null,
    {},
    { ...receipt, grade: 1 },
    { ...receipt, xp: -1 },
    { ...receipt, xp: Infinity },
    { ...receipt, xp: '25' },
    { ...receipt, accepted: 'false' },
    { ...receipt, medalId: 'first' },
  ])
    expect(parseRegistrationReward(bad)).toBeNull();
});
it('registration unlocks only class III, never invented higher degrees', () => {
  expect(medalGrade('contribution', {})).toBeNull();
  expect(medalGrade('contribution', { registered: 1 })).toBe(3);
  expect(medalGrade('contribution', { registered: 999 })).toBe(3);
});
