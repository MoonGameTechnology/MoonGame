// Keep the game OUT from under Android's system bars inside the APK.
//
// The prototype page asks for `viewport-fit=cover` so a phone BROWSER can paint under a
// notch, and its phone layout steps controls inside `env(safe-area-inset-*)`. Inside the
// APK that same tag has a much bigger effect: Capacitor 8's SystemBars plugin sees it and,
// on WebView 140+, stretches the WebView edge to edge, under the status bar and under the
// navigation bar / tablet taskbar. The PC/tablet ("holo") layout positions its windows by
// the full viewport and never reads the insets, so the taskbar covered the bottom of the
// Production window (owner's tablet screenshot, 2026-10-29).
//
// Without `cover` Capacitor takes the other branch: it pads the activity's root view by the
// system-bar insets, so the WebView sits BETWEEN the bars and every screen (phone, tablet,
// landscape with a side nav bar, Sector Zero, profile) fits by construction, while
// env(safe-area-inset-*) reads 0 and the phone layout's safe-area padding collapses to its
// plain value. The padded strip shows the activity's windowBackground, so the theme gets
// black, the page's own night tone, and SystemBars gets style DARK (light icons on it).
//
// Pure string functions, applied by patch-android.mjs to the generated android/ project
// after `cap sync`; tested in system-bars.test.mjs.

/** Near the page's darkest background stop (#01040a, prototype/build.mjs `body`). A
 *  framework colour reference, because windowBackground takes a reference, not a literal. */
export const BAR_BACKGROUND = '@android:color/black';

/** Drop `viewport-fit=cover` from the page's viewport meta; throws if the tag is gone. */
export function dropViewportCover(html) {
  const meta = /<meta name="viewport" content="([^"]*)">/;
  const found = html.match(meta);
  if (!found) throw new Error('system-bars: no <meta name="viewport"> in the packaged page');
  const content = found[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== 'viewport-fit=cover')
    .join(',');
  return html.replace(meta, `<meta name="viewport" content="${content}">`);
}

/** Light status/navigation icons: the strip under them is the page's night colour. */
export function darkSystemBars(configJson) {
  const config = JSON.parse(configJson);
  config.plugins = { ...config.plugins, SystemBars: { ...config.plugins?.SystemBars, style: 'DARK' } };
  return JSON.stringify(config, null, 2) + '\n';
}

/** Paint the strip behind the system bars in the page's colour instead of the theme's white. */
export function nightWindowBackground(stylesXml) {
  const open = '<style name="AppTheme.NoActionBar"';
  const at = stylesXml.indexOf(open);
  if (at < 0) throw new Error('system-bars: no AppTheme.NoActionBar in styles.xml');
  const end = stylesXml.indexOf('</style>', at);
  const body = stylesXml.slice(at, end);
  const item = `<item name="android:windowBackground">${BAR_BACKGROUND}</item>`;
  if (body.includes('android:windowBackground')) {
    return (
      stylesXml.slice(0, at) +
      body.replace(/<item name="android:windowBackground">[^<]*<\/item>/, item) +
      stylesXml.slice(end)
    );
  }
  return stylesXml.slice(0, end) + `    ${item}\n    ` + stylesXml.slice(end);
}
