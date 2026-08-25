import { describe, expect, it } from 'vitest';
import { matchAddress, scrubClaimParams, claimIntent } from './matchAddress';

describe('matchAddress — постоянный адрес партии (ADDR-2)', () => {
  it('несёт только идентификатор', () => {
    expect(matchAddress('/', 'm-abc')).toBe('/?join=m-abc');
  });

  it('идентификатор экранируется — он приходит от сервера, а не из кода', () => {
    expect(matchAddress('/', 'm a&b')).toBe('/?join=m%20a%26b');
  });

  it('путь сохраняется, каким был', () => {
    expect(matchAddress('/game/', 'm-abc')).toBe('/game/?join=m-abc');
  });
});

describe('scrubClaimParams — что остаётся в строке после входа (ADDR-2)', () => {
  it('параметры захвата уходят, адрес партии остаётся', () => {
    expect(scrubClaimParams('https://s/?join=m-1&slot=p2&faction=azure&sci=a,b')).toBe(
      'https://s/?join=m-1',
    );
  });

  it('чужие параметры не трогаем — чистка хирургическая, а не переписывание адреса', () => {
    expect(scrubClaimParams('https://s/?join=m-1&slot=p2&lang=ru')).toBe('https://s/?join=m-1&lang=ru');
  });

  it('адрес без параметров захвата не меняется вовсе', () => {
    const a = 'https://s/?join=m-1';
    expect(scrubClaimParams(a)).toBe(a);
  });

  it('фрагмент сохраняется', () => {
    expect(scrubClaimParams('https://s/?join=m-1&slot=p2#map')).toBe('https://s/?join=m-1#map');
  });

  it('мусор вместо адреса возвращается как есть, а не роняет вход', () => {
    expect(scrubClaimParams('не адрес')).toBe('не адрес');
  });
});

describe('claimIntent — приглашение против возврата (ADDR-2)', () => {
  const params = (s: string) => new URLSearchParams(s);

  it('ссылка с выбором — ПРИГЛАШЕНИЕ: намерение занять место', () => {
    expect(claimIntent(params('join=m-1&slot=p2&faction=azure&sci=a,b'), false)).toEqual({
      slot: 'p2',
      faction: 'azure',
      scientists: ['a', 'b'],
    });
  });

  it('та же ссылка у того, кто УЖЕ сидит в партии, — просто адрес', () => {
    // Иначе стухшая закладка просила бы место, давно занятое другим, а отданная
    // другу ссылка навязывала бы ему твой дом.
    expect(claimIntent(params('join=m-1&slot=p2&faction=azure'), true)).toBeNull();
  });

  it('ссылка без выбора — тоже просто адрес, а не пустое приглашение', () => {
    expect(claimIntent(params('join=m-1'), false)).toBeNull();
  });

  it('пустые значения не считаются выбором', () => {
    expect(claimIntent(params('join=m-1&slot=&faction='), false)).toBeNull();
  });

  it('совет разбирается списком, пустые элементы отбрасываются', () => {
    expect(claimIntent(params('join=m-1&slot=p2&sci=a,,b,'), false)?.scientists).toEqual(['a', 'b']);
  });

  it('только дом без места — законное приглашение: место подберёт сервер', () => {
    expect(claimIntent(params('join=m-1&faction=azure'), false)).toEqual({ faction: 'azure' });
  });
});
