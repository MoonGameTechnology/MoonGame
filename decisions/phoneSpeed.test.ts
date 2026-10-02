import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { speedFace, tempoOf } from './phoneSpeed';

const MARKUP = readFileSync(new URL('../prototype/build.mjs', import.meta.url), 'utf8');

describe('кнопка скорости телефона (UIX-3.2)', () => {
  it('темп и множитель, как в ряду (правило 1)', () => {
    expect(speedFace('play', 10)).toEqual({ glyph: '▶', mult: '×10', paused: false });
    expect(speedFace('fast', 100)).toEqual({ glyph: '▶▶', mult: '×100', paused: false });
  });

  it('в забеге множителей нет — только темп, в дев-забеге ▶▶▶ (правило 1)', () => {
    expect(speedFace('play', null)).toEqual({ glyph: '▶', mult: '', paused: false });
    expect(speedFace('fast', null)).toEqual({ glyph: '▶▶', mult: '', paused: false });
    expect(speedFace('dev', null)).toEqual({ glyph: '▶▶▶', mult: '', paused: false });
  });

  it('на паузе — «‖» без множителя (правило 2)', () => {
    expect(speedFace('pause', 10)).toEqual({ glyph: '‖', mult: '', paused: true });
    expect(speedFace('pause', null)).toEqual({ glyph: '‖', mult: '', paused: true });
  });

  it('темп — по скорости мира: ноль и мусор — пауза, чужая скорость — вне ряда (правило 3)', () => {
    const rates = { play: 10, fast: 30 };
    expect(tempoOf(10, rates)).toBe('play');
    expect(tempoOf(30, rates)).toBe('fast');
    expect(tempoOf(0, rates)).toBe('pause');
    expect(tempoOf(Number.NaN, rates)).toBe('pause');
    expect(tempoOf(-1, rates)).toBe('pause');
    expect(tempoOf(20, rates)).toBeNull();
    expect(tempoOf(1500, { ...rates, dev: 1500 })).toBe('dev');
    expect(tempoOf(1500, rates), 'без дев-забега ▶▶▶ нет').toBeNull();
  });

  it('темп вне ряда читается как «▶», мусорный множитель не пишется (правило 3)', () => {
    expect(speedFace(null, 50)).toEqual({ glyph: '▶', mult: '×50', paused: false });
    for (const junk of [Number.NaN, 0, -10, Number.POSITIVE_INFINITY])
      expect(speedFace('play', junk).mult, String(junk)).toBe('');
  });

  it('знак темпа на кнопке тот же, что на его кнопке в ряду', () => {
    const glyph = (id: string) =>
      new RegExp(`<button id="${id}"[^>]*>([^<]*)</button>`).exec(MARKUP)?.[1];
    expect(speedFace('pause', null).glyph).toBe(glyph('spd-pause'));
    expect(speedFace('play', null).glyph).toBe(glyph('spd-play'));
    expect(speedFace('fast', null).glyph).toBe(glyph('spd-fast'));
    expect(speedFace('dev', null).glyph).toBe(glyph('spd-dev'));
  });
});
