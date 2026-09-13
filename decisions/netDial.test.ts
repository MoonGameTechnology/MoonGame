import { describe, expect, it } from 'vitest';
import { dialIdentity, dialUrl, seatTicketKey } from './netDial';

describe('чем представляемся при дозвоне', () => {
  it('режим аккаунтов с выписанным токеном — представляемся токеном', () => {
    expect(dialIdentity(true, 'jwt-123', 'Комдив', null)).toEqual({
      kind: 'token',
      token: 'jwt-123',
    });
  });

  it('СПОСОБЫ НЕ СМЕШИВАЮТСЯ: без режима аккаунтов токен не годится, идём позывным', () => {
    expect(dialIdentity(false, 'jwt-123', 'Комдив', 'tick')).toEqual({
      kind: 'nick',
      nick: 'Комдив',
      ticket: 'tick',
    });
  });

  it('режим аккаунтов, но токена нет — тоже позывным (токен живёт минуты)', () => {
    expect(dialIdentity(true, null, 'Комдив', null)).toEqual({
      kind: 'nick',
      nick: 'Комдив',
      ticket: null,
    });
  });
});

describe('адрес дозвона', () => {
  it('токеном: в адресе только токен, ника и билета там быть не должно', () => {
    const url = dialUrl('wss://srv', 'm-1', { kind: 'token', token: 'jwt-123' });
    expect(url).toBe('wss://srv/matches/m-1?token=jwt-123');
    expect(url).not.toContain('nick=');
    expect(url).not.toContain('ticket=');
  });

  it('позывным без билета — БЕЗ пустого параметра (правило 3)', () => {
    expect(dialUrl('wss://srv', 'm-1', { kind: 'nick', nick: 'Ost', ticket: null })).toBe(
      'wss://srv/matches/m-1?nick=Ost',
    );
  });

  it('позывным с билетом — билет прикладывается вторым параметром', () => {
    expect(dialUrl('wss://srv', 'm-1', { kind: 'nick', nick: 'Ost', ticket: 't-9' })).toBe(
      'wss://srv/matches/m-1?nick=Ost&ticket=t-9',
    );
  });

  it('ЭКРАНИРУЕТСЯ ВСЁ: «&» в позывном иначе расклеит адрес (правило 4)', () => {
    const url = dialUrl('wss://srv', 'м матч/1', { kind: 'nick', nick: 'a&b=c?d', ticket: 'x y' });
    expect(url).toBe(
      'wss://srv/matches/%D0%BC%20%D0%BC%D0%B0%D1%82%D1%87%2F1?nick=a%26b%3Dc%3Fd&ticket=x%20y',
    );
    // «&» в адресе ровно один — тот, что разделяет параметры; остальные экранированы
    expect(url.split('&').length - 1).toBe(1);
  });
});

describe('ключ билета места', () => {
  it('БИЛЕТ ПРИВЯЗАН К ТРОЙКЕ: сервер, матч и позывной — иначе предъявим чужой', () => {
    const k = seatTicketKey('wss://srv', 'm-1', 'Ost');
    expect(k).not.toBe(seatTicketKey('wss://other', 'm-1', 'Ost'));
    expect(k).not.toBe(seatTicketKey('wss://srv', 'm-2', 'Ost'));
    expect(k).not.toBe(seatTicketKey('wss://srv', 'm-1', 'Кто-то'));
  });

  it('та же тройка — тот же ключ, иначе билет терялся бы каждый вход', () => {
    expect(seatTicketKey('wss://srv', 'm-1', 'Ost')).toBe(seatTicketKey('wss://srv', 'm-1', 'Ost'));
  });
});
