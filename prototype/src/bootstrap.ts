// Entry labels must not depend on game/map initialization reaching the welcome
// handlers. esbuild keeps this dynamic import inside the self-contained bundle;
// no network request is needed to start the game, including in the APK.
import { localizeStaticDom, LOCALE, LOCALE_LABEL } from '../../localization/runtime';
import { currentBuild } from './updater';

document.body.classList.add('app-starting');
localizeStaticDom();
const language = document.getElementById('clang');
if (language) language.textContent = LOCALE_LABEL[LOCALE] + ' ▾';

import('./main').then(
  () => document.body.classList.remove('app-starting'),
  (error: unknown) => {
    // Raw errors belong in developer logs, not in the player's UI: a message or
    // stack may contain a URL or stored data. The screen reports only safe codes.
    console.error('E_CLIENT_STARTUP', error);
    document.body.classList.add('app-startup-failed');
    const panel = document.getElementById('startup-error');
    if (panel) panel.hidden = false;
    const kinds = ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'SecurityError'];
    const kind = error instanceof Error && kinds.includes(error.name) ? error.name : 'Error';
    const sha = currentBuild()?.sha ?? '';
    const build = /^[0-9a-f]{7,40}$/i.test(sha) ? sha : 'web';
    const engine = /(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent)?.[1] ?? '?';
    const code = document.getElementById('startup-code');
    if (code) code.textContent = `E_CLIENT_STARTUP / ${kind} / ${build} / Chromium-${engine}`;
    // No retry timer and no storage clearing. Only the player's explicit action
    // reloads the document, so persistent failures stay readable and stable.
    document.getElementById('startup-retry')?.addEventListener('click', () => location.reload());
  },
);
