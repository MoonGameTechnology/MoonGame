// AIM-PAN — сторож правила «коммитит ли отпускание вооружённый приказ».
//
// Держит обе стороны, на которых ввод уже ломался: протяжка одним пальцем при
// вооружённом приказе ДОЛЖНА доводить его до цели (иначе приказ пропадает молча), а
// отпускание после щипка двумя пальцами — НЕ должна (иначе конец панорамы отправляет
// флот в случайную точку).
import { describe, it, expect } from 'vitest';
import { releaseCommits, type ReleaseGesture } from './aimGesture';

const g = (over: Partial<ReleaseGesture> = {}): ReleaseGesture => ({
  armed: false,
  pc: false,
  multiTouched: false,
  dragged: false,
  ...over,
});

describe('тач с вооружённым приказом', () => {
  it('протяжка одним пальцем доводит приказ — так на телефоне целятся', () => {
    expect(releaseCommits(g({ armed: true, dragged: true }))).toBe(true);
  });

  it('чистый тап тоже коммитит', () => {
    expect(releaseCommits(g({ armed: true }))).toBe(true);
  });

  it('после ВТОРОГО пальца — не коммитит: жест возил камеру, а не целился', () => {
    // Ради этого «нет» второй палец и перестал отменять приказ: камеру при вооружённом
    // «Курсе» надо чем-то двигать, но конец панорамы не имеет права стать приказом.
    expect(releaseCommits(g({ armed: true, multiTouched: true, dragged: true }))).toBe(false);
  });

  it('второй палец без протяжки (щипок на месте) — тоже не приказ', () => {
    expect(releaseCommits(g({ armed: true, multiTouched: true }))).toBe(false);
  });
});

describe('PC', () => {
  it('протяжка — это панорама, приказ не отправляется', () => {
    expect(releaseCommits(g({ armed: true, pc: true, dragged: true }))).toBe(false);
  });

  it('чистый клик отправляет', () => {
    expect(releaseCommits(g({ armed: true, pc: true }))).toBe(true);
  });
});

describe('приказ не вооружён — обычное выделение', () => {
  it('тап выделяет', () => {
    expect(releaseCommits(g())).toBe(true);
  });

  it('протяжка (панорама или рамка) не выделяет', () => {
    expect(releaseCommits(g({ dragged: true }))).toBe(false);
    expect(releaseCommits(g({ dragged: true, multiTouched: true }))).toBe(false);
  });
});
