import { describe, it, expect } from 'vitest';
import { isMine, seen, seenArc, seenTail } from './eventVisibility';

const Я = 'p1';

describe('журнал — я участник', () => {
  it('любая из сторон — это я', () => {
    expect(isMine(['p2', Я], Я)).toBe(true);
    expect(isMine([Я], Я)).toBe(true);
  });

  it('чужая драка — не моя', () => {
    expect(isMine(['p2', 'p3'], Я)).toBe(false);
  });

  it('ПУСТЫЕ СТОРОНЫ НЕ СЧИТАЮТСЯ СВОИМИ: у ничейного узла владельца нет', () => {
    expect(isMine([null, undefined], Я)).toBe(false);
    expect(isMine([], Я)).toBe(false);
  });
});

describe('журнал — обычное правило', () => {
  it('СВОЁ ВИДНО ВСЕГДА — даже под туманом', () => {
    expect(seen(true, false)).toBe(true);
  });

  it('ЧУЖОЕ ВИДНО ТОЛЬКО НА ОПОЗНАННОМ УЗЛЕ: драка ботов за туманом не моя разведка', () => {
    expect(seen(false, false)).toBe(false);
    expect(seen(false, true)).toBe(true);
  });
});

describe('журнал — хвост боя', () => {
  it('БОЙ, В КОТОРОМ Я ДРАЛСЯ, ВИДЕН ДО КОНЦА: узел мог уйти под туман по ходу', () => {
    expect(seenTail(true, false)).toBe(true);
  });

  it('чужой бой на опознанном узле виден и без памяти о нём', () => {
    expect(seenTail(false, true)).toBe(true);
  });

  it('чужой бой под туманом не виден', () => {
    expect(seenTail(false, false)).toBe(false);
  });
});

describe('журнал — выстрел по дуге', () => {
  it('ХВАТИТ ОДНОГО ОПОЗНАННОГО КОНЦА: залп по видимой цели замечаешь, не зная стрелка', () => {
    expect(seenArc(false, true)).toBe(true);
    expect(seenArc(true, false)).toBe(true);
  });

  it('оба конца под туманом — выстрела не видно', () => {
    expect(seenArc(false, false)).toBe(false);
  });

  it('оба конца опознаны — тем более видно', () => {
    expect(seenArc(true, true)).toBe(true);
  });
});
