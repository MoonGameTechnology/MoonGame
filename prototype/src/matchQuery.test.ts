import { describe, expect, it } from 'vitest';
import { archiveUrl, httpBase, matchesUrl, queryOutcome, seatsUrl } from './matchQuery';

describe('адрес того же сервера по HTTP', () => {
  it('ОДИН АДРЕС НА ДВА ПРОТОКОЛА: схема меняется, остальное нет', () => {
    expect(httpBase('ws://127.0.0.1:8788')).toBe('http://127.0.0.1:8788');
    expect(httpBase('wss://void.example/игра')).toBe('https://void.example/игра');
  });
});

describe('адреса запросов', () => {
  it('позывной уходит в адрес ЭКРАНИРОВАННЫМ: его набирает человек', () => {
    // «&», «?» и пробел разорвали бы запрос
    expect(matchesUrl('ws://s', 'Ко & Ма?')).toBe('http://s/matches?nick=%D0%9A%D0%BE%20%26%20%D0%9C%D0%B0%3F');
  });

  it('идентификатор матча тоже экранируется — он приходит по ссылке', () => {
    expect(seatsUrl('ws://s', 'a/b c')).toBe('http://s/matches/a%2Fb%20c/seats');
  });

  it('архив и разархив — один адрес с разной операцией', () => {
    expect(archiveUrl('ws://s', 'm1', 'Ник', false)).toBe(
      'http://s/matches/m1/archive?nick=%D0%9D%D0%B8%D0%BA',
    );
    expect(archiveUrl('ws://s', 'm1', 'Ник', true)).toBe(
      'http://s/matches/m1/unarchive?nick=%D0%9D%D0%B8%D0%BA',
    );
  });
});

describe('чем кончился запрос', () => {
  it('2xx — ответ получен', () => {
    expect(queryOutcome({ ok: true })).toBe('ok');
  });

  it('СЕРВЕР ОТВЕТИЛ ОТКАЗОМ — повторять бессмысленно, надо прочитать причину', () => {
    expect(queryOutcome({ ok: false })).toBe('refused');
  });

  it('ДО СЕРВЕРА НЕ ДОШЛИ — другая беда: связи нет, повторить позже', () => {
    expect(queryOutcome(null)).toBe('unreachable');
  });
});
