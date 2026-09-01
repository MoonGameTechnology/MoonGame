import { describe, expect, it } from 'vitest';
import { type SeatKind, seatBadgeOf, seatKind } from './seatBadge';

const ВСЕ: SeatKind[] = ['me', 'ai', 'player'];

describe('seatKind — кто занимает место (правило 2)', () => {
  it('своё место опознаётся СВОИМ раньше всего прочего', () => {
    expect(seatKind(true, false)).toBe('me');
    // Даже если место помечено машинным — «это я» сильнее: иначе игрок искал бы себя
    // среди чужих.
    expect(seatKind(true, true)).toBe('me');
  });

  it('чужое машинное место — машина, чужое человеческое — человек', () => {
    expect(seatKind(false, true)).toBe('ai');
    expect(seatKind(false, false)).toBe('player');
  });
});

describe('seatBadgeOf — значок и подпись (правила 1, 3, 4)', () => {
  it('правило 3: подпись приходит ТЕКСТОМ, а не ключом', () => {
    // Это и есть починка: раньше наружу выходил ключ, и три места печатали его как есть.
    for (const k of ВСЕ) {
      const tag = seatBadgeOf(k).tag;
      expect(tag).not.toContain('.'); // ключ выглядит как `comms.you`
      expect(tag.length).toBeGreaterThan(0);
    }
  });

  it('правило 3: подпись не совпадает с ключом — значит локаль его РАЗВЕРНУЛА', () => {
    // `t()` возвращает сам ключ, когда его нет ни в одной локали. Такой ответ здесь
    // означал бы, что подпись снова уехала к игроку ключом.
    expect(seatBadgeOf('me').tag).not.toBe('comms.you');
    expect(seatBadgeOf('ai').tag).not.toBe('diplo.filter.ai');
    expect(seatBadgeOf('player').tag).not.toBe('comms.tag.player');
  });

  it('правило 4: у меня и у другого человека значок ОДИН, различает подпись', () => {
    expect(seatBadgeOf('me').icon).toBe(seatBadgeOf('player').icon);
    expect(seatBadgeOf('me').tag).not.toBe(seatBadgeOf('player').tag);
  });

  it('машина отличается и значком, и подписью', () => {
    expect(seatBadgeOf('ai').icon).not.toBe(seatBadgeOf('me').icon);
    expect(seatBadgeOf('ai').tag).not.toBe(seatBadgeOf('me').tag);
  });

  it('правило 1: значок и подпись выдаются вместе, у каждого вида — оба', () => {
    for (const k of ВСЕ) {
      const b = seatBadgeOf(k);
      expect(b.icon.length).toBeGreaterThan(0);
      expect(b.tag.length).toBeGreaterThan(0);
    }
  });

  it('подписи трёх видов попарно различны — иначе вид места не читался бы', () => {
    const tags = ВСЕ.map((k) => seatBadgeOf(k).tag);
    expect(new Set(tags).size).toBe(3);
  });
});
