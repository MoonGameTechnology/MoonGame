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
