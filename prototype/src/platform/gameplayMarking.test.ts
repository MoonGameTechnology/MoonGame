/**
 * Сторож разметки геймплея (`YAG-1.2a`) — статический, и это осознанный выбор формы.
 *
 * Что проверяется: **`sectorRunActive` присваивают ТОЛЬКО внутри `setRunActive`**, а тот
 * зовёт `gameplayStart`/`gameplayStop`. Тогда «забег идёт» и «площадка знает, что забег
 * идёт» не могут разойтись — это одно и то же действие.
 *
 * Флаг и сеттер живут у владельца забега (`sectorRun.ts`, REFM-210), а дверь разметки — в
 * `main.ts`: сеттер зовёт её хуком `runChanged`. Поэтому сторож читает оба файла и держит
 * обе стороны стыка — вызов хука в сеттере и сам хук в проводке.
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
const RUN = readFileSync(new URL('../sectorRun.ts', import.meta.url), 'utf8');

/** Строки обоих файлов — с именем файла и номером для внятного сообщения об ошибке. */
const lines = [
  ...SRC.split('\n').map((line, i) => ({ file: 'main.ts', line, no: i + 1 })),
  ...RUN.split('\n').map((line, i) => ({ file: 'sectorRun.ts', line, no: i + 1 })),
];

/** Тело функции по имени — пусто, если её нет (проверки ниже тогда падают). */
const bodyIn = (src: string, name: string): string =>
  new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1] ?? '';
const fnBody = (name: string): string => bodyIn(SRC, name);

describe('YAG-1.2a — разметка геймплея не может разойтись с состоянием забега', () => {
  it('сеттер существует и зовёт дверь разметки, а дверь — ОБА её конца', () => {
    const body = bodyIn(RUN, 'setRunActive');
    expect(body, 'функция setRunActive не найдена — сторож проверял бы пустоту').toBeTruthy();
    expect(body).toContain('sectorRunActive = on');
    expect(body).toContain('game.runChanged();');
    // Хук сеттера в проводке `main.ts` — это и есть дверь разметки (и инструменты рельса).
    expect(SRC).toMatch(
      /runChanged: \(\) => \{\s+syncSectorZeroTools\(\);\s+markGameplay\(\);\s+\},/,
    );
    const mark = fnBody('markGameplay');
    expect(mark).toContain('gameplayStart');
    expect(mark).toContain('gameplayStop');
  });

  it('YAG-6.2: «геймплей идёт» = забег идёт И мир не стоит — и это видит каждый кадр', () => {
    // Темп мира меняют больше десятка мест; дверь зовётся из кадра при смене ответа, иначе
    // пауза, чтение комикса или выход в меню оставили бы индикатор площадки зелёным.
    expect(fnBody('markGameplay')).toContain(
      'const playing = sectorRunActive && speed > 0 && !comicQueue.isBusy();',
    );
    expect(SRC).toContain(
      'if (gameplayMarked !== (sectorRunActive && speed > 0 && !comicQueue.isBusy())) markGameplay();',
    );
    expect(fnBody('runPauseEvent')).toContain('markGameplay()');
  });

  it('звать площадку напрямую, мимо двери, нельзя', () => {
    const direct = SRC.match(/\.gameplay(Start|Stop)\?\.\(\)/g) ?? [];
    expect(direct).toHaveLength(2);
    expect(RUN).not.toMatch(/\.gameplay(Start|Stop)\b/);
    const mark = fnBody('markGameplay');
    expect(mark.match(/\.gameplay(Start|Stop)\?\.\(\)/g)).toHaveLength(2);
  });

  it('`sectorRunActive` присваивают только внутри сеттера', () => {
    const offenders = lines
      .map(({ file, line, no }) => ({ file, line: line.trim(), no }))
      .filter(({ line }) => /^sectorRunActive\s*=/.test(line))
      // Единственное законное присваивание — внутри `setRunActive` (`sectorRunActive = on`).
      .filter(({ line }) => line !== 'sectorRunActive = on;');
    expect(offenders).toEqual([]);
    expect(bodyIn(RUN, 'setRunActive')).toContain('sectorRunActive = on;');
    expect(RUN.match(/^\s*sectorRunActive = on;/gm)).toHaveLength(1);
  });

  it('объявление одно, и оно с начальным значением — а не присваивание в общем счёте', () => {
    const declarations = lines.filter(({ line }) =>
      /^(export )?let sectorRunActive\b/.test(line.trim()),
    );
    expect(declarations).toHaveLength(1);
    expect(declarations[0]!.file).toBe('sectorRun.ts');
    expect(declarations[0]!.line).toContain('= false');
  });

  it('сеттер зовут отовсюду, где забег начинается или кончается — не меньше пяти точек', () => {
    // Пять на сегодня: новый забег, установка другой партии, уход в сеть, успешное
    // восстановление снимка и откат неудачного. Меньше — значит точку потеряли.
    //
    // ⚠️ Объявление функции ИСКЛЮЧЕНО из счёта, и это не педантизм: первая редакция
    // считала `\bsetRunActive\(` по всему файлу, ловила заодно `function setRunActive(`
    // и потому пропускала мутацию «убрать один вызов» — пять оставшихся совпадений её
    // устраивали. Сторож был слеп ровно к той потере, ради которой заведён.
    // Точки живут в обоих файлах: запуск, полигон, уход в сеть и хук профиля — в `main.ts`,
    // установка партии (`leaveRun`), подъём и его откат — у владельца забега.
    const calls = `${SRC}\n${RUN}`.match(/(?<!function )\bsetRunActive\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it('площадка берётся через `getPlatform()`, а не через константу выше по файлу', () => {
    const body = fnBody('markGameplay');
    // Присваивания стоят ВЫШЕ объявления `const platform`, и обращение к нему из функции,
    // вызванной раньше инициализации, упало бы на временной мёртвой зоне.
    expect(body).toContain('getPlatform()');
  });
});
