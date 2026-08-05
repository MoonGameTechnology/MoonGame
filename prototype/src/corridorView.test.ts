// HERO-CORRIDOR-VIEW — сторож «карта не врёт про коридор».
//
// Два утверждения, которые легко нарушить и невозможно заметить глазами:
// у ОДНОРАЗОВОГО коридора таймера быть не должно (он закрывается прибытием, а не
// часами — показать «осталось 6 ч» значит соврать), и чужой коридор не должен светить
// сквозь туман (иначе оверлей выдаёт позицию чужого героя и его план).
import { describe, it, expect } from 'vitest';
import type { GameState, TempLane } from '../../packages/shared-core/src/index';
import { corridorLines } from './corridorView';

const ME = 'p1';
const FOE = 'p2';
const HOUR = 3_600_000;

const lane = (over: Partial<TempLane>): TempLane => ({
  id: 'lane:1',
  owner: ME,
  from: 'A',
  to: 'B',
  speedBonus: 0.5,
  expiresAt: 6 * HOUR,
  addedLink: true,
  ...over,
});

const stateWith = (lanes: TempLane[]): GameState => ({ tempLanes: lanes }) as unknown as GameState;
const seen = () => true;

describe('HERO-CORRIDOR-VIEW — таймер только там, где он существует', () => {
  it('у ОДНОРАЗОВОГО (ступень 1) таймера нет, и линия мигает', () => {
    const [line] = corridorLines(stateWith([lane({ tier: 1 })]), ME, 0, seen);
    expect(line!.msLeft).toBeNull();
    expect(line!.blink).toBe(true);
  });

  it('у ВРЕМЕННОГО (ступень 2) таймер настоящий и не мигает', () => {
    const [line] = corridorLines(stateWith([lane({ tier: 2, expiresAt: 4 * HOUR })]), ME, HOUR, seen);
    expect(line!.msLeft).toBe(3 * HOUR);
    expect(line!.blink).toBe(false);
  });

  it('истёкший срок показывается нулём, а не отрицательным числом', () => {
    const [line] = corridorLines(stateWith([lane({ tier: 2, expiresAt: HOUR })]), ME, 9 * HOUR, seen);
    expect(line!.msLeft).toBe(0);
  });

  it('ступень без поля читается как одноразовая — как и в ядре (fail-secure)', () => {
    const [line] = corridorLines(stateWith([lane({})]), ME, 0, seen);
    expect(line!.tier).toBe(1);
    expect(line!.msLeft).toBeNull();
  });
});

describe('HERO-CORRIDOR-VIEW — чужой коридор под туманом', () => {
  it('свой виден всегда, даже если концы не опознаны', () => {
    const lines = corridorLines(stateWith([lane({ owner: ME })]), ME, 0, () => false);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.mine).toBe(true);
  });

  it('чужой виден, только когда опознаны ОБА конца', () => {
    const st = stateWith([lane({ owner: FOE })]);
    expect(corridorLines(st, ME, 0, seen)).toHaveLength(1);
    expect(corridorLines(st, ME, 0, () => false)).toHaveLength(0);
    // один конец опознан, второй нет — всё равно не показываем: иначе видно, КУДА он ведёт
    expect(corridorLines(st, ME, 0, (id) => id === 'A')).toHaveLength(0);
  });
});
