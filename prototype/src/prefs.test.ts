// REFM-16 — сторож правил хранения клиентских настроек.
//
// Проверяются ровно те два утверждения, из-за которых правило и собрано в одно место:
// «сохранённый 0 — это НЕ отсутствие ключа» (иначе выключенная настройка сама включалась
// бы обратно) и «провал записи не роняет UI» (приватный режим бросает на setItem).
import { describe, it, expect } from 'vitest';
import { readBool, readNum, readRaw, writeBool, writeRaw, type PrefStore } from './prefs';

const fake = (seed: Record<string, string> = {}): PrefStore => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
};

/** Хранилище, которое бросает на всём — приватный режим / запрещённые cookies. */
const hostile = (): PrefStore => ({
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
});

describe('readBool — умолчание стоит аргументом, а не в знаке сравнения', () => {
  it('ключа нет → умолчание, каким бы оно ни было', () => {
    expect(readBool('k', true, fake())).toBe(true);
    expect(readBool('k', false, fake())).toBe(false);
  });

  it('сохранённый 0 читается как ВЫКЛ даже у настройки, включённой по умолчанию', () => {
    // Тот самый разъезд, ради которого правило одно: настройка, выключенная игроком,
    // не имеет права включиться сама после перезагрузки.
    expect(readBool('k', true, fake({ k: '0' }))).toBe(false);
  });

  it('сохранённая 1 читается как ВКЛ даже у настройки, выключенной по умолчанию', () => {
    expect(readBool('k', false, fake({ k: '1' }))).toBe(true);
  });

  it('мусор в ключе не значит ничего — берётся умолчание', () => {
    expect(readBool('k', true, fake({ k: 'yes' }))).toBe(true);
    expect(readBool('k', false, fake({ k: 'yes' }))).toBe(false);
  });

  it('без хранилища (Node, приватный режим) — умолчание, без исключения', () => {
    expect(readBool('k', true, null)).toBe(true);
    expect(readBool('k', true, hostile())).toBe(true);
  });
});

describe('readNum — диапазон и ловушка Number(null)', () => {
  it('отсутствующий ключ НЕ читается как ноль', () => {
    // Number(null) === 0, а не NaN: без явной проверки чистый профиль получал бы
    // громкость 0 и погашенный радар.
    expect(readNum('k', 1, 0, 1, fake())).toBe(1);
  });

  it('сохранённый ноль — настоящий ноль, а не «ключа нет»', () => {
    expect(readNum('k', 1, 0, 1, fake({ k: '0' }))).toBe(0);
  });

  it('значение за диапазоном и нечисло дают умолчание', () => {
    expect(readNum('k', 1, 0, 1, fake({ k: '5' }))).toBe(1);
    expect(readNum('k', 1, 0, 1, fake({ k: '-0.2' }))).toBe(1);
    expect(readNum('k', 1, 0, 1, fake({ k: 'громко' }))).toBe(1);
  });
});

describe('запись', () => {
  it('writeBool кладёт ту форму, которую читает readBool', () => {
    const st = fake();
    writeBool('k', false, st);
    expect(readBool('k', true, st)).toBe(false);
    writeBool('k', true, st);
    expect(readBool('k', false, st)).toBe(true);
  });

  it('провал записи не бросает — настройка просто не переживёт перезагрузку', () => {
    expect(() => writeRaw('k', 'v', hostile())).not.toThrow();
    expect(() => writeBool('k', true, null)).not.toThrow();
  });

  it('readRaw отдаёт сырое значение как есть', () => {
    expect(readRaw('k', fake({ k: '#ff0000' }))).toBe('#ff0000');
    expect(readRaw('k', fake())).toBeNull();
  });
});
