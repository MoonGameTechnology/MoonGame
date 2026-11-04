import { describe, expect, it } from 'vitest';
import { matchCreationAllowed, matchCreationSettings } from './matchCreation';

describe('server permission to create a session', () => {
  it('requires an explicit boolean grant from a successful response', () => {
    expect(matchCreationAllowed({ status: 200, body: { canCreate: true } })).toBe(true);
  });
  it.each([null, { status: 401, body: { canCreate: true } },
    { status: 403, body: { canCreate: true } }, { status: 503, body: { canCreate: true } },
    { status: 404, body: {} }, ...[null, [], true, {}, { canCreate: false },
      { canCreate: 'true' }, { canCreate: 1 }, Object.create({ canCreate: true }) as unknown]
      .map(body => ({ status: 200, body }))])('denies unknown or refused capabilities: %j', reply => {
    expect(matchCreationAllowed(reply)).toBe(false);
  });
});

describe('настройки новой партии из ответа сервера', () => {
  it('берёт скорости, скорость по умолчанию и переключатель золота', () => {
    expect(matchCreationSettings({ canCreate: true, settings: { speeds: [24, 1, 4, 4], defaultSpeed: 4, goldActions: true } }))
      .toEqual({ speeds: [1, 4, 24], defaultSpeed: 4, goldActions: true });
  });
  it('отбрасывает кривые значения', () => {
    expect(matchCreationSettings({ settings: { speeds: [0, -2, 1.5, '8', 8], defaultSpeed: 3, goldActions: 'yes' } }))
      .toEqual({ speeds: [8], defaultSpeed: null, goldActions: false });
  });
  it.each([null, [], {}, { settings: null }, { settings: [] }])('без настроек: %j', (body) => {
    expect(matchCreationSettings(body)).toEqual({ speeds: [], defaultSpeed: null, goldActions: false });
  });
});
