import { describe, expect, it } from 'vitest';
import { drawAmbushMark, drawForkMark } from './forkMark';

/** A recording context: every call as `name(args)`, properties as `name=value`. */
function recorder(): { g: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const g = new Proxy({} as Record<string, unknown>, {
    get:
      (_t, key) =>
      (...args: unknown[]) =>
        log.push(`${String(key)}(${args.join(',')})`),
    set: (_t, key, value) => (log.push(`${String(key)}=${String(value)}`), true),
  }) as unknown as CanvasRenderingContext2D;
  return { g, log };
}

describe('ROADS-4 — отметки развилки и засады', () => {
  it('развилка — закрытый ромб вокруг своей точки, залитый', () => {
    const { g, log } = recorder();
    drawForkMark(g, 10, 20, 3);
    expect(log).toEqual([
      'beginPath()',
      'moveTo(10,17)',
      'lineTo(13,20)',
      'lineTo(10,23)',
      'lineTo(7,20)',
      'closePath()',
      'fill()',
    ]);
  });

  it('засада — пунктирный ромб цвета владельца, и стиль холста возвращается как был', () => {
    const { g, log } = recorder();
    drawAmbushMark(g, 0, 0, '#ff5a4d', 10);
    expect(log[0]).toBe('save()');
    expect(log).toContain('strokeStyle=#ff5a4d');
    expect(log).toContain('setLineDash(3,3)');
    expect(log).toContain('moveTo(0,-10)');
    expect(log.at(-2)).toBe('stroke()');
    expect(log.at(-1)).toBe('restore()');
  });
});
