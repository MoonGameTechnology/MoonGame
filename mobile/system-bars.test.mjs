import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { darkSystemBars, dropViewportCover, nightWindowBackground } from './system-bars.mjs';

const VIEWPORT = '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';

describe('dropViewportCover', () => {
  it('removes only viewport-fit=cover and is idempotent', () => {
    const once = dropViewportCover(`<head>${VIEWPORT}</head>`);
    expect(once).toBe('<head><meta name="viewport" content="width=device-width,initial-scale=1"></head>');
    expect(dropViewportCover(once)).toBe(once);
  });

  it('matches the tag the prototype build actually emits', () => {
    const build = readFileSync(new URL('../prototype/build.mjs', import.meta.url), 'utf8');
    expect(build).toContain(VIEWPORT);
  });

  it('fails loudly when the page has no viewport meta', () => {
    expect(() => dropViewportCover('<head></head>')).toThrow(/viewport/);
  });
});

describe('darkSystemBars', () => {
  it('sets SystemBars style DARK and keeps the rest of the config', () => {
    const out = JSON.parse(darkSystemBars('{"appId":"a","server":{"androidScheme":"https"}}'));
    expect(out).toEqual({ appId: 'a', server: { androidScheme: 'https' }, plugins: { SystemBars: { style: 'DARK' } } });
  });
});

describe('nightWindowBackground', () => {
  const styles = `<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
    </style>
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
    </style>
</resources>`;

  it('adds a black windowBackground to the activity theme only, once', () => {
    const once = nightWindowBackground(styles);
    expect(once.match(/android:windowBackground/g)).toHaveLength(1);
    const theme = once.slice(once.indexOf('AppTheme.NoActionBar'));
    expect(theme).toContain('<item name="android:windowBackground">@android:color/black</item>');
    expect(nightWindowBackground(once)).toBe(once);
  });

  it('fails loudly when the theme is missing', () => {
    expect(() => nightWindowBackground('<resources></resources>')).toThrow(/NoActionBar/);
  });
});
