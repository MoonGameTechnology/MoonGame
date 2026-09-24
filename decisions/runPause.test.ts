import { describe, expect, it } from 'vitest';
import { runPaused, runPauseStep, type RunClock, type RunPauseEvent } from './runPause';

const NORMAL = 150;
const FAST = 225;
const running = (speed = NORMAL): RunClock => ({ speed, resumeSpeed: NORMAL, platformHeld: false });
const run = (clock: RunClock, ...events: RunPauseEvent[]): RunClock =>
  events.reduce(runPauseStep, clock);

describe('YAG-6.2 — кнопка паузы', () => {
  it('идущий мир встаёт, стоящий — идёт', () => {
    expect(runPaused(run(running(), 'toggle'))).toBe(true);
    expect(run(running(), 'toggle', 'toggle').speed).toBe(NORMAL);
  });

  it('продолжает с тем темпом, что был до паузы, — ускоренный не сбрасывается на обычный', () => {
    expect(run(running(FAST), 'toggle', 'toggle').speed).toBe(FAST);
  });

  it('темпа для продолжения нет — мир остаётся стоять, а не идёт с нулём', () => {
    const stuck = { speed: 0, resumeSpeed: 0, platformHeld: false };
    expect(runPaused(runPauseStep(stuck, 'toggle'))).toBe(true);
  });
});

describe('YAG-6.2 — уход со страницы', () => {
  it('ставит паузу, и возврат мир НЕ запускает — продолжит кнопка игрока', () => {
    const away = run(running(), 'hidden');
    expect(runPaused(away)).toBe(true);
    // Возврата как события нет вовсе: мир стоит, пока игрок не нажмёт.
    expect(run(away, 'toggle').speed).toBe(NORMAL);
  });

  it('уже стоящий по кнопке мир уход не трогает', () => {
    const paused = run(running(FAST), 'toggle');
    expect(run(paused, 'hidden')).toEqual(paused);
  });
});

describe('YAG-6.2 — пауза площадки', () => {
  it('реклама или оверлей ставят паузу, «продолжить» площадки её снимает', () => {
    const ad = run(running(FAST), 'platform-pause');
    expect(runPaused(ad)).toBe(true);
    expect(run(ad, 'platform-resume').speed).toBe(FAST);
  });

  it('пауза игрока ДО площадки её «продолжить» не снимается', () => {
    const mine = run(running(), 'toggle', 'platform-pause', 'platform-resume');
    expect(runPaused(mine)).toBe(true);
  });

  it('ушёл со страницы поверх паузы площадки — пауза переходит игроку', () => {
    const left = run(running(), 'platform-pause', 'hidden', 'platform-resume');
    expect(runPaused(left)).toBe(true);
    expect(run(left, 'toggle').speed).toBe(NORMAL);
  });

  it('«продолжить» площадки без её паузы — ничего не значит', () => {
    expect(run(running(), 'platform-resume')).toEqual(running());
  });
});

describe('YAG-6.2 — функция чистая', () => {
  it('вход не меняется', () => {
    const clock = running(FAST);
    const before = JSON.stringify(clock);
    for (const e of ['toggle', 'hidden', 'platform-pause', 'platform-resume'] as const) {
      runPauseStep(clock, e);
    }
    expect(JSON.stringify(clock)).toBe(before);
  });
});
