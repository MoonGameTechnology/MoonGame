import { describe, expect, it } from 'vitest';
import {
  CLEARED,
  needsClearing,
  overlayAlarm,
  overlayShown,
  overlayText,
  pingText,
  syncText,
} from './netOverlay';

describe('overlayShown', () => {
  it('shows the overlay when the player asked for it', () => {
    expect(overlayShown(true, false, false, false)).toBe(true);
  });

  it('shows the overlay under dev chrome', () => {
    expect(overlayShown(false, true, false, false)).toBe(true);
  });

  // Правило 1: десинк пробивает выключенную настройку — иначе о нём некому сообщить.
  it('forces the overlay on a live net desync even with the setting off', () => {
    expect(overlayShown(false, false, true, true)).toBe(true);
  });

  it('stays hidden with the setting off and nothing wrong', () => {
    expect(overlayShown(false, false, true, false)).toBe(false);
    expect(overlayShown(false, false, false, false)).toBe(false);
  });

  // Десинк без сети — это не десинк: сравнивать было не с чем.
  it('does not force the overlay on a solo match', () => {
    expect(overlayShown(false, false, false, true)).toBe(false);
  });
});

describe('pingText', () => {
  // Правило 3: до первого замера — многоточие, не «0 ms».
  it('says it does not know yet before the first measurement', () => {
    expect(pingText(null)).toBe('· · ms');
  });

  it('rounds a measured latency to whole milliseconds', () => {
    expect(pingText(0)).toBe('0 ms');
    expect(pingText(31.4)).toBe('31 ms');
    expect(pingText(31.6)).toBe('32 ms');
  });
});

describe('syncText', () => {
  it('ticks when the rebuild matches the server', () => {
    expect(syncText(false, 0)).toBe('sync ✓');
    expect(syncText(false, 4)).toBe('sync ✓'); // прошлые расхождения не отменяют согласия сейчас
  });

  // Правило 4: расхождение всегда названо числом.
  it('names the running mismatch count on a desync', () => {
    expect(syncText(true, 1)).toBe('desync ✗ 1');
    expect(syncText(true, 12)).toBe('desync ✗ 12');
  });
});

describe('overlayText', () => {
  // Правило 2: в соло нет ни задержки, ни признака синхронизации.
  it('carries only the frame rate in a solo match', () => {
    expect(overlayText(59.6, false, null, false, 0, '')).toBe('60 FPS');
  });

  it('adds latency and the sync flag in a net match', () => {
    expect(overlayText(60, true, 30, false, 0, '')).toBe('60 FPS · 30 ms · sync ✓');
  });

  it('carries the mismatch count on a desync', () => {
    expect(overlayText(60, true, 30, true, 3, '')).toBe('60 FPS · 30 ms · desync ✗ 3');
  });

  it('shows the unmeasured latency until the first ping lands', () => {
    expect(overlayText(60, true, null, false, 0, '')).toBe('60 FPS · · · ms · sync ✓');
  });

  it('appends the build label when there is one', () => {
    expect(overlayText(60, false, null, false, 0, 'b1234')).toBe('60 FPS · b1234');
    expect(overlayText(60, true, 30, false, 0, 'b1234')).toBe('60 FPS · 30 ms · sync ✓ · b1234');
  });
});

describe('overlayAlarm', () => {
  // Правило 5: красный только на сетевом десинке.
  it('alarms on a net desync', () => {
    expect(overlayAlarm(true, true)).toBe(true);
  });

  it('stays calm in sync, in solo, and on a bad frame rate', () => {
    expect(overlayAlarm(true, false)).toBe(false);
    expect(overlayAlarm(false, true)).toBe(false);
    expect(overlayAlarm(false, false)).toBe(false);
  });
});

describe('needsClearing', () => {
  // Правило 6: чистим ровно один раз — то, что на экране ещё есть.
  it('clears a line that is still on screen', () => {
    expect(needsClearing('60 FPS')).toBe(true);
  });

  it('does not clear an already empty overlay', () => {
    expect(needsClearing(CLEARED)).toBe(false);
  });
});
