import { describe, expect, it } from 'vitest';
import { resolveAddress, socketBase } from './serverAddress';

describe('адрес сокета из набранного', () => {
  it('ws:// и wss:// проходят как есть', () => {
    expect(socketBase('ws://host:8788', false)).toBe('ws://host:8788');
    expect(socketBase('wss://void.example', true)).toBe('wss://void.example');
  });

  it('СКОПИРОВАННЫЙ ИЗ БРАУЗЕРА http(s):// переводится в ws(s)://', () => {
    expect(socketBase('http://host:8788', false)).toBe('ws://host:8788');
    expect(socketBase('https://void.example', true)).toBe('wss://void.example');
  });

  it('голый host:port дополняется схемой СТРАНИЦЫ', () => {
    expect(socketBase('host:8788', false)).toBe('ws://host:8788');
    expect(socketBase('host:8788', true)).toBe('wss://host:8788');
  });

  it('НА HTTPS-СТРАНИЦЕ ws:// поднимается до wss:// — иначе браузер молча режет сокет', () => {
    expect(socketBase('ws://void.example', true)).toBe('wss://void.example');
    expect(socketBase('http://void.example', true)).toBe('wss://void.example');
  });

  it('на обычной странице ws:// не трогают', () => {
    expect(socketBase('ws://host:1', false)).toBe('ws://host:1');
  });

  it('ПУТЬ И ЗАПРОС ОТБРАСЫВАЮТСЯ: вставленный /matches сделал бы из сокета 404', () => {
    expect(socketBase('https://void.example/matches?nick=a', false)).toBe('wss://void.example');
    expect(socketBase('host:8788/matches', false)).toBe('ws://host:8788');
  });

  it('схема пишется в любом регистре — её печатают руками', () => {
    expect(socketBase('HTTPS://void.example', false)).toBe('wss://void.example');
    expect(socketBase('WS://host:1', false)).toBe('ws://host:1');
  });

  it('неразбираемый адрес — null, а не мусорная строка', () => {
    expect(socketBase('ws://', false)).toBe(null);
    expect(socketBase(':::', false)).toBe(null);
  });
});

describe('разбор полей входа', () => {
  const поля = (server: string, nick: string, pageHttps = false): Parameters<typeof resolveAddress>[0] => ({
    server,
    nick,
    pageHttps,
  });

  it('всё на месте — адрес и позывной', () => {
    expect(resolveAddress(поля(' host:8788 ', ' Гончая '))).toEqual({
      kind: 'ok',
      base: 'ws://host:8788',
      nick: 'Гончая',
    });
  });

  it('ПУСТОЙ АДРЕС НАЗЫВАЮТ ВСЛУХ', () => {
    expect(resolveAddress(поля('', 'Гончая'))).toEqual({
      kind: 'need-address',
      key: 'net.need-address',
    });
    expect(resolveAddress(поля('   ', 'Гончая')).kind).toBe('need-address');
  });

  it('ПУСТОЙ ПОЗЫВНОЙ — МОЛЧА: пробу зовут до того, как игрок что-то напечатал', () => {
    expect(resolveAddress(поля('host:1', ''))).toEqual({ kind: 'need-nick' });
    expect(resolveAddress(поля('host:1', '  '))).toEqual({ kind: 'need-nick' });
  });

  it('битый адрес — отказ С ПРИЧИНОЙ, опечатка тут самая частая беда', () => {
    expect(resolveAddress(поля('ws://', 'Гончая'))).toEqual({
      kind: 'bad-address',
      key: 'net.bad-address',
    });
  });

  it('адрес проверяют РАНЬШЕ позывного — иначе битый адрес молчал бы', () => {
    expect(resolveAddress(поля('ws://', '')).kind).toBe('bad-address');
  });

  it('ни того ни другого — жалуются на адрес', () => {
    expect(resolveAddress(поля('', '')).kind).toBe('need-address');
  });
});
