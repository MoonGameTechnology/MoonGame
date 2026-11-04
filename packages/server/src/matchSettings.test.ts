import { describe, expect, it } from 'vitest';
import { hostMatchSettings, hostSpeeds, MATCH_SPEEDS, withGoldActions } from './matchSettings';

describe('скорости новой партии', () => {
  it('общий список плюс скорость хоста по умолчанию, по возрастанию и без повторов', () => {
    expect(hostSpeeds(24)).toEqual([...MATCH_SPEEDS]);
    expect(hostSpeeds(200)).toEqual([...MATCH_SPEEDS, 200]);
    expect(hostSpeeds(3)).toEqual([1, 2, 3, 4, 8, 12, 24]);
  });
});

describe('правила хоста прототипа', () => {
  it('объявляет скорости вокруг своей и переключатель золота', () => {
    expect(hostMatchSettings(24)).toEqual({ speeds: [...MATCH_SPEEDS], defaultSpeed: 24, goldActions: true });
  });
  it('выбор золота ложится в мир, отсутствие выбора мир не трогает', () => {
    const state = { match: { status: 'ongoing' } };
    expect(withGoldActions(state, undefined)).toBe(state);
    expect(withGoldActions(state, false)).toEqual({ match: { status: 'ongoing', goldActions: false } });
    expect(state.match).toEqual({ status: 'ongoing' });
  });
});
