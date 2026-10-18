import { describe, expect, it } from 'vitest';
import {
  appRoot,
  claimIntent,
  matchAddress,
  matchIdFrom,
  settledAddress,
} from './matchAddress';

describe('appRoot — куда смонтирован клиент (ADDR-3)', () => {
  it('корень остаётся корнем, каким бы адресом партии его ни открыли', () => {
    expect(appRoot('/')).toBe('');
    expect(appRoot('/index.html')).toBe('');
    expect(appRoot('/game/m-1')).toBe('');
    expect(appRoot('/game/')).toBe('');
  });

  it('КЛИЕНТ НЕ ВСЕГДА В КОРНЕ: дев-сборка живёт на /dev и обязана там остаться', () => {
    // Иначе вход в партию с дев-клиента уводил бы на игрокскую сборку — без
    // дев-оверлея, которым этот клиент и отличается.
    expect(appRoot('/dev')).toBe('/dev');
    expect(appRoot('/dev/game/m-1')).toBe('/dev');
  });
});

describe('matchAddress — постоянный адрес партии (ADDR-2 → ADDR-3)', () => {
  it('ПУТЬ, А НЕ ХВОСТ: /game/<id> читается как адрес, а не как технический параметр', () => {
    expect(matchAddress('/', 'm-abc')).toBe('/game/m-abc');
  });

  it('идентификатор экранируется — он приходит от сервера, а не из кода', () => {
    expect(matchAddress('/', 'm a&b')).toBe('/game/m%20a%26b');
    expect(matchAddress('/', 'a/b')).toBe('/game/a%2Fb');
  });

  it('монтирование сохраняется, а прежний адрес партии не наслаивается', () => {
    expect(matchAddress('/dev', 'm-abc')).toBe('/dev/game/m-abc');
    expect(matchAddress('/game/m-old', 'm-new')).toBe('/game/m-new');
  });
});

describe('matchIdFrom — id партии из адреса (ADDR-3)', () => {
  const q = (s: string) => new URLSearchParams(s);

  it('берётся из пути', () => {
    expect(matchIdFrom('/game/m-1', q(''))).toBe('m-1');
    expect(matchIdFrom('/dev/game/m-1', q(''))).toBe('m-1');
  });

  it('СТАРЫЕ ССЫЛКИ ЖИВЫ: `?join=` понимается по-прежнему', () => {
    // Их уже раздали игрокам и положили в закладки; сломать их значит запереть
    // человека снаружи собственной партии.
    expect(matchIdFrom('/', q('join=m-1'))).toBe('m-1');
    expect(matchIdFrom('/index.html', q('join=m-1'))).toBe('m-1');
  });

  it('путь важнее хвоста: он и есть адрес', () => {
    expect(matchIdFrom('/game/m-path', q('join=m-tail'))).toBe('m-path');
  });

  it('экранированный id разбирается обратно', () => {
    expect(matchIdFrom('/game/m%20a%26b', q(''))).toBe('m a&b');
  });

  it('битое экранирование не роняет загрузку — id доедет до сервера и получит отказ', () => {
    expect(matchIdFrom('/game/m%zz', q(''))).toBe('m%zz');
  });

  it('нет ни пути, ни хвоста — нет и партии', () => {
    expect(matchIdFrom('/', q(''))).toBe('');
    expect(matchIdFrom('/', q('join='))).toBe('');
  });
});

describe('settledAddress — что остаётся в строке после входа (ADDR-2 → ADDR-3)', () => {
  it('остаётся ЧИСТЫЙ адрес партии: путь без параметров захвата', () => {
    expect(settledAddress('https://s/?join=m-1&slot=p2&faction=azure&sci=a,b', 'm-1')).toBe(
      'https://s/game/m-1',
    );
  });

  it('чужие параметры не трогаем — чистка хирургическая, а не переписывание адреса', () => {
    expect(settledAddress('https://s/?join=m-1&slot=p2&lang=ru', 'm-1')).toBe(
      'https://s/game/m-1?lang=ru',
    );
  });

  it('фрагмент сохраняется', () => {
    expect(settledAddress('https://s/?join=m-1&slot=p2#map', 'm-1')).toBe('https://s/game/m-1#map');
  });

  it('монтирование сохраняется', () => {
    expect(settledAddress('https://s/dev?join=m-1&slot=p2', 'm-1')).toBe('https://s/dev/game/m-1');
  });

  it('повторный вход в ту же партию адрес не меняет', () => {
    const a = 'https://s/game/m-1';
    expect(settledAddress(a, 'm-1')).toBe(a);
  });

  it('мусор вместо адреса возвращается как есть, а не роняет вход', () => {
    expect(settledAddress('не адрес', 'm-1')).toBe('не адрес');
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
