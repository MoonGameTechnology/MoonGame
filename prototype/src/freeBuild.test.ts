import { describe, it, expect } from 'vitest';
import { restoresWallet, snapshotWallet } from './freeBuild';

describe('песочница — снятие слепка кошелька', () => {
  it('обе галочки на приказе стройки — слепок снимается', () => {
    expect(snapshotWallet(false, true, true, true)).toBe(true);
  });

  it('В ИГРОЦКОЙ СБОРКЕ ПЕСОЧНИЦЫ НЕТ ВОВСЕ', () => {
    expect(snapshotWallet(true, true, true, true)).toBe(false);
  });

  it('выключенная песочница кошелёк не трогает', () => {
    expect(snapshotWallet(false, false, true, true)).toBe(false);
  });

  it('НУЖНЫ ОБЕ ГАЛОЧКИ: одна песочница бесплатной стройки не даёт', () => {
    expect(snapshotWallet(false, true, false, true)).toBe(false);
  });

  it('ТОЛЬКО ПРИКАЗЫ СТРОЙКИ: иначе бесплатным станет всё подряд', () => {
    expect(snapshotWallet(false, true, true, false)).toBe(false);
  });
});

describe('песочница — возврат слепка', () => {
  it('успешный приказ возвращает кошелёк', () => {
    expect(restoresWallet(true, true)).toBe(true);
  });

  it('ОТКАЗ СЛЕПОК НЕ ВОЗВРАЩАЕТ: он затёр бы чужие изменения этого шага', () => {
    expect(restoresWallet(true, false)).toBe(false);
  });

  it('без слепка возвращать нечего', () => {
    expect(restoresWallet(false, true)).toBe(false);
    expect(restoresWallet(false, false)).toBe(false);
  });
});
