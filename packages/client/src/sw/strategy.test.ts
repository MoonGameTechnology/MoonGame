import { describe, expect, it } from 'vitest';
import { scopePath, strategyFor, type ShellScope } from './strategy';

/**
 * CP2.2 — кого воркер трогает, а кого пропускает мимо себя.
 *
 * Главный тест здесь — «незнакомый свой путь НЕ кэшируется». Клиент и сервер могут
 * стоять на одном origin (`deploy/Caddyfile` проксирует всё на `server:8788`), и
 * тогда `/matches` придёт воркеру как обычный свой GET. Правило по умолчанию —
 * пропустить — единственное, что не даёт отдать игроку вчерашний список партий.
 */
const SCOPE = 'https://play.example.com/';
const o: ShellScope = {
  scope: SCOPE,
  cacheable: ['index.html', 'assets/main-5EH-V8Xc.js', 'assets/ru-_A4Nf2dg.js'],
};
const get = (url: string, mode = 'cors'): { method: string; mode: string; url: string } => ({
  method: 'GET',
  mode,
  url,
});

describe('стратегия запроса (CP2.2)', () => {
  it('не-GET не трогается никогда', () => {
    expect(strategyFor({ method: 'POST', mode: 'cors', url: SCOPE + 'auth/login' }, o)).toBe(
      'bypass',
    );
  });

  it('незнакомый СВОЙ путь пропускается — это API сервера, а не файл сборки', () => {
    expect(strategyFor(get(SCOPE + 'matches'), o)).toBe('bypass');
    expect(strategyFor(get(SCOPE + 'matches/m-1/seats'), o)).toBe('bypass');
  });

  it('чужой origin пропускается — там живёт игровой сервер', () => {
    expect(strategyFor(get('https://api.example.com/matches'), o)).toBe('bypass');
    expect(strategyFor(get('https://play.example.com.evil/index.html'), o)).toBe('bypass');
  });

  it('переход — это оболочка, даже с запросом в адресе', () => {
    expect(strategyFor(get(SCOPE, 'navigate'), o)).toBe('shell');
    expect(strategyFor(get(SCOPE + '?join=wss%3A%2F%2Fhost', 'navigate'), o)).toBe('shell');
  });

  it('файл сборки — это ассет, запрос в адресе его не переименовывает', () => {
    expect(strategyFor(get(SCOPE + 'assets/main-5EH-V8Xc.js'), o)).toBe('asset');
    expect(strategyFor(get(SCOPE + 'assets/main-5EH-V8Xc.js?v=1'), o)).toBe('asset');
    expect(strategyFor(get(SCOPE + 'assets/main-OLDHASH.js'), o)).toBe('bypass');
  });

  it('область действия может быть подпапкой — сборка ходит с `--base=./`', () => {
    const sub: ShellScope = { scope: 'https://host/game/', cacheable: ['assets/main-X.js'] };
    expect(strategyFor(get('https://host/game/assets/main-X.js'), sub)).toBe('asset');
    // Выше своей области воркер не отвечает: там чужое приложение.
    expect(strategyFor(get('https://host/assets/main-X.js'), sub)).toBe('bypass');
  });

  it('путь считается от области, а мусор в адресе не роняет разбор', () => {
    expect(scopePath(SCOPE + 'assets/x.js#top', SCOPE)).toBe('assets/x.js');
    expect(scopePath(SCOPE, SCOPE)).toBe('');
    expect(scopePath('не адрес', SCOPE)).toBeNull();
  });
});
