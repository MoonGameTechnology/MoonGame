// Electron main process: one window running the Sector Zero platform build
// (`prototype/dist/yandex`, staged into `www/` by `sync-www.mjs`) from the `app://` scheme.
// The page gets no Node access (sandbox + context isolation, no preload) — it is the
// same web build players get on the platform, nothing more.
import { app, BrowserWindow, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HOST, SCHEME, SDK_STUB, START_URL, resolveRequest } from './routes.mjs';

const WWW = fileURLToPath(new URL('./www/', import.meta.url));

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** Links out of the game (store pages, privacy policy) open in the system browser. */
const openOutside = (url) => {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Sector Zero',
    backgroundColor: '#02080e',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${SCHEME}://${HOST}/`)) return;
    event.preventDefault();
    openOutside(url);
  });
  void win.loadURL(START_URL);
}

if (!app.requestSingleInstanceLock()) {
  // A second copy would fight the first over the same save in localStorage.
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // The game asks for nothing (camera, notifications, …); deny by default.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, done) => done(false));
    protocol.handle(SCHEME, async (request) => {
      const route = resolveRequest(request.url, WWW);
      if (route.kind === 'sdk-stub') {
        return new Response(SDK_STUB, { headers: { 'content-type': route.type } });
      }
      if (route.kind === 'not-found') return new Response('', { status: 404 });
      try {
        return new Response(await readFile(route.path), {
          headers: { 'content-type': route.type },
        });
      } catch {
        return new Response('', { status: 404 });
      }
    });
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
