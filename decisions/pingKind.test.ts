import { describe, expect, it } from 'vitest';
import { en } from '../localization/en';
import { ru } from '../localization/ru';
import {
  PING_KIND_LABEL,
  PING_MARKER_KINDS,
  pingGlyph,
  pingIsActive,
  pingMarkerKind,
} from './pingKind';

describe('tactical marker presentation', () => {
  it.each([undefined, '', 'move', 'build', 'future-kind'])(
    'preserves the original marker for legacy or unsupported kind %s',
    (kind) => {
      expect(pingMarkerKind(kind)).toBe('mark');
      expect(pingGlyph(kind)).toBe(pingGlyph('mark'));
    },
  );

  it.each(PING_MARKER_KINDS)('keeps the selected %s marker kind', (kind) => {
    expect(pingMarkerKind(kind)).toBe(kind);
  });

  it('shows three different symbols, keeping the existing pin and adding shield and sword', () => {
    const glyphs = PING_MARKER_KINDS.map(pingGlyph);
    expect(glyphs).toEqual(['📍', '🛡', '🗡']);
    expect(new Set(glyphs).size).toBe(3);
  });

  it.each([
    { locale: 'ru', messages: ru, labels: ['Метка', 'Защита', 'Атака'] },
    { locale: 'en', messages: en, labels: ['Marker', 'Defend', 'Attack'] },
  ])('has translated labels for every selectable marker in $locale', ({ messages, labels }) => {
    expect(PING_MARKER_KINDS.map((kind) => messages[PING_KIND_LABEL[kind]])).toEqual(labels);
    expect(messages['ping.kind.label']).toBeTruthy();
  });

  it('expires at the authoritative match-time deadline, including a paused clock', () => {
    const ping = { pingExpiresAt: 2000 };
    expect(pingIsActive(ping, 1999)).toBe(true);
    expect(pingIsActive(ping, 1999)).toBe(true);
    expect(pingIsActive(ping, 2000)).toBe(false);
    expect(pingIsActive(ping, 2001)).toBe(false);
  });

  it('keeps solo and legacy messages that have no server expiry stamp', () => {
    expect(pingIsActive({}, 86_400_000)).toBe(true);
  });
});
