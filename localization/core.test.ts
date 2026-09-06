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
