import { describe, it, expect, vi } from 'vitest';

// Ядро рантайма (LOC-6) держит ПОДКЛЮЧЁННЫЕ таблицы, а не импортирует локали само:
// один импорт `t()` больше не затягивает в бандл все языки. Отсюда два свойства,
// которые проверяются ниже на СВЕЖЕМ экземпляре модуля — общая преамбула тестов
// (`vitest.setup.ts`) подключает все локали, поэтому обычный импорт уже полон.

const freshCore = async (): Promise<typeof import('./core')> => {
  vi.resetModules();
  return import('./core');
};

describe('рантайм без подключённых текстов', () => {
  it('без registerMessages ключ возвращается как есть — пустого экрана не будет', async () => {
    const core = await freshCore();
    expect(core.t('welcome.title')).toBe('welcome.title');
    expect(core.hasKey('welcome.title')).toBe(false);
  });

  it('подключение одной запечённой локали делает текст доступным', async () => {
    const core = await freshCore();
    const { bakedLocale } = await import('./bundles');
    core.registerMessages(core.LOCALE, bakedLocale(core.LOCALE));
    expect(core.t('welcome.title')).toBe('VOID DOMINION');
  });

  it('игрок с одной локалью видит текст источника — фолбэк в неё запечён', async () => {
    // Ровно тот случай, ради которого фолбэк переехал в сборку: подключён ТОЛЬКО
    // английский, а ключ переведён не был. Русского словаря в памяти нет.
    const core = await freshCore();
    const { bakeMessages } = await import('./bundles');
    core.setLocale('en');
    core.registerMessages('en', bakeMessages({ 'x.own': 'Own' }, { 'x.source': 'Источник' }));
    expect(core.t('x.own')).toBe('Own');
    expect(core.t('x.source')).toBe('Источник');
  });
});

// YAG-1.3: площадка сообщает язык игрока ПОСЛЕ старта рантайма — `detect()` к этому
// моменту уже выбрал язык по браузеру. Подсказка площадки обязана уступать явному выбору
// игрока и не превращаться в него сама.
describe('подсказка языка от площадки (YAG-1.3)', () => {
  /** Хранилище, которое видит свежий экземпляр рантайма. В node своего нет. */
  const withStorage = async (saved: string | null) => {
    const store = new Map<string, string>(saved === null ? [] : [['vd.locale', saved]]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const core = await freshCore();
    return { core, store };
  };

  it('явного выбора нет — подсказка принимается, и рантайм сообщает о смене', async () => {
    vi.stubGlobal('navigator', { language: 'ru-RU' });
    const { core } = await withStorage(null);
    expect(core.LOCALE).toBe('ru');
    expect(core.suggestLocale('en')).toBe(true);
    expect(core.LOCALE).toBe('en');
    vi.unstubAllGlobals();
  });

  it('подсказка не сохраняется: иначе она стала бы «выбором» и пережила смену языка на площадке', async () => {
    vi.stubGlobal('navigator', { language: 'ru-RU' });
    const { core, store } = await withStorage(null);
    core.suggestLocale('en');
    expect(store.has('vd.locale')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('игрок уже выбрал язык сам — подсказка площадки его не перебивает', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    const { core } = await withStorage('ru');
    expect(core.suggestLocale('en')).toBe(false);
    expect(core.LOCALE).toBe('ru');
    vi.unstubAllGlobals();
  });

  it('подсказка совпала с уже выбранным языком — смены нет, перерисовывать нечего', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    const { core } = await withStorage(null);
    expect(core.suggestLocale('en')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('хранилище недоступно — подсказка всё равно работает, а не падает', async () => {
    vi.stubGlobal('navigator', { language: 'ru-RU' });
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    });
    const core = await freshCore();
    expect(core.suggestLocale('en')).toBe(true);
    expect(core.LOCALE).toBe('en');
    vi.unstubAllGlobals();
  });
});

// UIX-5.3: слово при числе выбирается в строке локали — `{n|корабль|корабля|кораблей}`.
describe('склонение по числу', () => {
  it('русский: одна, две и пять — три формы, 11–14 — «много»', async () => {
    const core = await freshCore();
    core.setLocale('ru');
    core.registerMessages('ru', { 'x.ships': '{n} {n|корабль|корабля|кораблей}' });
    const ships = (n: number) => core.t('x.ships', { n });
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 0].map(ships)).toEqual([
      '1 корабль',
      '2 корабля',
      '4 корабля',
      '5 кораблей',
      '11 кораблей',
      '12 кораблей',
      '14 кораблей',
      '21 корабль',
      '22 корабля',
      '25 кораблей',
      '101 корабль',
      '111 кораблей',
      '0 кораблей',
    ]);
  });

  it('английский: две формы', async () => {
    const core = await freshCore();
    core.setLocale('en');
    core.registerMessages('en', { 'x.ships': '{n} {n|ship|ships}' });
    expect([1, 2, 0, 21].map((n) => core.t('x.ships', { n }))).toEqual([
      '1 ship',
      '2 ships',
      '0 ships',
      '21 ships',
    ]);
  });

  it('пропущенная форма берёт последнюю: русскому «other» для дробных можно не писать', async () => {
    const core = await freshCore();
    core.setLocale('ru');
    core.registerMessages('ru', {
      'x.three': '{n|корабль|корабля|кораблей}',
      'x.four': '{n|корабль|корабля|кораблей|корабля}',
    });
    expect(core.t('x.three', { n: 1.5 })).toBe('кораблей');
    expect(core.t('x.four', { n: 1.5 })).toBe('корабля');
  });

  it('значение строкой — число из неё; не число — последняя форма', async () => {
    const core = await freshCore();
    core.setLocale('ru');
    core.registerMessages('ru', { 'x.ships': '{n} {n|корабль|корабля|кораблей}' });
    expect(core.t('x.ships', { n: '3' })).toBe('3 корабля');
    expect(core.t('x.ships', { n: '1.2k' })).toBe('1.2k кораблей');
  });

  it('число в разметке читается без тегов: досье выделяют значения `<em class="hl">`', async () => {
    const core = await freshCore();
    core.setLocale('ru');
    core.registerMessages('ru', { 'x.ships': '{n} {n|корабль|корабля|кораблей}' });
    expect(core.t('x.ships', { n: '<em class="hl">1</em>' })).toBe('<em class="hl">1</em> корабль');
    expect(core.t('x.ships', { n: '<b>3</b>' })).toBe('<b>3</b> корабля');
  });

  it('форма — только слово: несколько чисел в строке склоняются каждое своим', async () => {
    const core = await freshCore();
    core.setLocale('ru');
    core.registerMessages('ru', {
      'x.group': '{f} {f|флот|флота|флотов} · {s} {s|корабль|корабля|кораблей}',
    });
    expect(core.t('x.group', { f: 1, s: 22 })).toBe('1 флот · 22 корабля');
  });

  it('нет значения — слот остаётся как есть, а не пропадает', async () => {
    const core = await freshCore();
    core.setLocale('ru');
    core.registerMessages('ru', { 'x.ships': '{n|корабль|корабля|кораблей}' });
    expect(core.t('x.ships', { m: 1 })).toBe('{n|корабль|корабля|кораблей}');
  });

  it('непереведённый ключ склоняется по-русски, а не по правилу выбранного языка', async () => {
    const core = await freshCore();
    core.setLocale('en');
    core.registerMessages('ru', { 'x.ships': '{n} {n|корабль|корабля|кораблей}' });
    core.registerMessages('en', {});
    expect(core.t('x.ships', { n: 5 })).toBe('5 кораблей');
  });
});
