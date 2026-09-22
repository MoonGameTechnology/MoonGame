/**
 * Сторож разметки геймплея (`YAG-1.2a`) — статический, и это осознанный выбор формы.
 *
 * Что проверяется: **`sectorRunActive` присваивают ТОЛЬКО внутри `setRunActive`**, а тот
 * зовёт `gameplayStart`/`gameplayStop`. Тогда «забег идёт» и «площадка знает, что забег
 * идёт» не могут разойтись — это одно и то же действие.
 *
 * Почему не поведенческий тест. `main.ts` — 14 тысяч строк, которым нужен DOM, канвас,
 * данные и живое ядро; поднять его в vitest ради одного флага невозможно без мока
 * половины браузера, а такой тест проверял бы мок. Поведение САМОГО адаптера при этом уже
 * покрыто 19 тестами (`yandex.test.ts`) и 13 тестами чистого решения
 * (`decisions/platformLifecycle.test.ts`) — включая парность, повторный `start` и `stop`
 * без `start`. Непокрытым оставался ровно стык: «а зовут ли их вообще и отовсюду ли».
 * Его и держит эта проверка.
 *
 * Чего она стоит, если её обойти. Индикатор геймплея на debug-панели останется зелёным
 * после выхода в меню — и это ровно то, что модерация смотрит по требованию 1.19.
 * Дефект не виден в игре и не ломает ни одного теста: его замечает только площадка.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');

/** Строки файла без пустых — номера сохраняются для внятного сообщения об ошибке. */
const lines = SRC.split('\n');

describe('YAG-1.2a — разметка геймплея не может разойтись с состоянием забега', () => {
  it('сеттер существует и зовёт ОБА конца разметки', () => {
    const body = /function setRunActive\(on: boolean\): void \{([\s\S]*?)\n\}/.exec(SRC)?.[1];
    expect(body, 'функция setRunActive не найдена — сторож проверял бы пустоту').toBeTruthy();
    expect(body).toContain('sectorRunActive = on');
    expect(body).toContain('gameplayStart');
    expect(body).toContain('gameplayStop');
  });

  it('`sectorRunActive` присваивают только внутри сеттера', () => {
    const offenders = lines
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter(({ line }) => /^sectorRunActive\s*=/.test(line))
      // Единственное законное присваивание — внутри `setRunActive` (`sectorRunActive = on`).
      .filter(({ line }) => line !== 'sectorRunActive = on;');
    expect(offenders).toEqual([]);
  });

  it('объявление одно, и оно с начальным значением — а не присваивание в общем счёте', () => {
    const declarations = lines.filter((l) => /^let sectorRunActive\b/.test(l.trim()));
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toContain('= false');
  });

  it('сеттер зовут отовсюду, где забег начинается или кончается — не меньше пяти точек', () => {
    // Пять на сегодня: новый забег, установка другой партии, уход в сеть, успешное
    // восстановление снимка и откат неудачного. Меньше — значит точку потеряли.
    //
    // ⚠️ Объявление функции ИСКЛЮЧЕНО из счёта, и это не педантизм: первая редакция
    // считала `\bsetRunActive\(` по всему файлу, ловила заодно `function setRunActive(`
    // и потому пропускала мутацию «убрать один вызов» — пять оставшихся совпадений её
    // устраивали. Сторож был слеп ровно к той потере, ради которой заведён.
    const calls = SRC.match(/(?<!function )\bsetRunActive\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it('площадка берётся через `getPlatform()`, а не через константу выше по файлу', () => {
    const body = /function setRunActive\(on: boolean\): void \{([\s\S]*?)\n\}/.exec(SRC)?.[1] ?? '';
    // Присваивания стоят ВЫШЕ объявления `const platform`, и обращение к нему из функции,
    // вызванной раньше инициализации, упало бы на временной мёртвой зоне.
    expect(body).toContain('getPlatform()');
  });
});
