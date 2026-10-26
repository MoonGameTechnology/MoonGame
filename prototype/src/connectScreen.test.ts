/**
 * Экран подключения (REFM-247) — прямой тест модуля.
 *
 * Разбор набранного адреса и адрес по умолчанию проверены у `decisions/serverAddress.ts`,
 * страницы входа и стадии экрана — у `signInPages.ts`, список партий — у `matchBrowser.ts`,
 * такт активности — у `playerActivity.ts` клиента. Здесь — то, что собирается только вместе:
 * поля экрана заполняются запомненным сервером и позывным, показ экрана читается обратно,
 * плохой адрес пишет строку статуса, а пустой позывной — нет, вход в обозреватель предлагает
 * позывной и перечитывает список, такт активности видит сервер из поля и токен его сессии.
 * Соседи подменены: тест подслушивает, о чём модуль их попросил. Каждый тест — свежая
 * загрузка модулей.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../localization/runtime';

interface Field {
  value: string;
  textContent: string;
  style: Record<string, string>;
}

interface Env {
  els: Map<string, Field>;
  store: Map<string, string>;
  calls: string[];
  target: (() => unknown) | null;
}

let env: Env;

async function load(stored: Record<string, string> = {}, sectorZeroOnly = false) {
  vi.resetModules();
  env = { els: new Map(), store: new Map(Object.entries(stored)), calls: [], target: null };
  const el = (id: string): Field => {
    let e = env.els.get(id);
    if (!e) env.els.set(id, (e = { value: '', textContent: '', style: {} }));
    return e;
  };
  vi.stubGlobal('__SECTOR_ZERO_ONLY__', sectorZeroOnly);
  vi.stubGlobal('document', { getElementById: el });
  vi.stubGlobal('localStorage', { getItem: (k: string) => env.store.get(k) ?? null });
  vi.stubGlobal('location', {
    protocol: 'https:',
    host: 'play.example',
    hostname: 'play.example',
    port: '',
  });
  vi.doMock('./signInPages', () => ({
    showStage: (stage: string) => env.calls.push(`stage:${stage}`),
    suggestCallsign: () => 'Nova',
  }));
  vi.doMock('./matchBrowser', () => ({ refreshMatches: async () => {} }));
  vi.doMock('./detach', () => ({ detach: (label: string) => env.calls.push(`detach:${label}`) }));
  vi.doMock('./updater', () => ({ bakedServer: () => null }));
  vi.doMock('./accountSession', () => ({
    sessionToken: (base: string) => (base === 'wss://srv.example' ? 'tok' : null),
  }));
  vi.doMock('../../packages/client/src/playerActivity', () => ({
    startPlayerActivity: (target: () => unknown) => {
      env.target = target;
      return { refresh: () => env.calls.push('activity.refresh'), stop: () => {} };
    },
  }));
  const screen = await import('./connectScreen');
  screen.initConnectScreen();
  return screen;
}

afterEach(() => {
  for (const m of [
    './signInPages',
    './matchBrowser',
    './detach',
    './updater',
    './accountSession',
    '../../packages/client/src/playerActivity',
  ])
    vi.doUnmock(m);
  vi.unstubAllGlobals();
});

const field = (id: string): Field => env.els.get(id)!;

describe('REFM-247 · поля и показ экрана', () => {
  it('поля заполняются запомненным сервером и позывным', async () => {
    await load({ 'void.server': 'wss://srv.example', 'void.nick': 'Vega' });
    expect(field('csrv').value).toBe('wss://srv.example');
    expect(field('cnick').value).toBe('Vega');
  });

  it('без запомненного сервер — свой адрес страницы, позывной пуст', async () => {
    await load();
    expect(field('csrv').value).toBe('wss://play.example');
    expect(field('cnick').value).toBe('');
  });

  it('показ экрана читается обратно', async () => {
    const screen = await load();
    screen.showConnect(true);
    expect(screen.connectShown()).toBe(true);
    screen.showConnect(false);
    expect(screen.connectShown()).toBe(false);
  });
});

describe('REFM-247 · разбор адреса', () => {
  it('годный адрес и позывной — база сокета и позывной', async () => {
    const screen = await load({ 'void.server': 'https://srv.example/path', 'void.nick': 'Vega' });
    expect(screen.resolveServer()).toEqual({ base: 'wss://srv.example', nick: 'Vega' });
  });

  it('пустой адрес пишет строку статуса, пустой позывной — молчит', async () => {
    const screen = await load({ 'void.nick': 'Vega' });
    field('csrv').value = '   ';
    expect(screen.resolveServer()).toBeNull();
    expect(field('cstatus').textContent).toBe(t('net.need-address'));
    field('cstatus').textContent = '';
    field('csrv').value = 'wss://srv.example';
    field('cnick').value = '';
    expect(screen.resolveServer()).toBeNull();
    expect(field('cstatus').textContent).toBe('');
  });
});

describe('REFM-247 · обозреватель и такт активности', () => {
  it('вход в обозреватель предлагает позывной и перечитывает список', async () => {
    const screen = await load();
    screen.enterBrowse();
    expect(field('cnick').value).toBe('Nova');
    expect(env.calls).toEqual(['stage:browse', 'detach:обозреватель: список партий']);
  });

  it('такт активности видит сервер из поля и токен его сессии', async () => {
    const screen = await load({ 'void.server': 'wss://srv.example' });
    screen.startActivity();
    expect(env.target!()).toEqual({ base: 'https://srv.example', token: 'tok' });
    field('csrv').value = 'wss://other.example';
    expect(env.target!()).toBeNull(); // у этого сервера нет сессии
    screen.refreshActivity();
    expect(env.calls).toEqual(['activity.refresh']);
  });

  it('в архиве площадки такт не поднимается', async () => {
    const screen = await load({}, true);
    screen.startActivity();
    screen.refreshActivity();
    expect(env.target).toBeNull();
    expect(env.calls).toEqual([]);
  });
});
