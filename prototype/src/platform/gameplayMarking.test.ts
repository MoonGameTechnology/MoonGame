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
 * С REFM-210 дверь и разметка живут у владельца забега (`sectorRun.ts`), а кадр и пауза — в
 * `main.ts`. Поэтому сторож читает оба файла: присваивание мимо двери в любом из них, как и
 * прямой вызов площадки, его роняет.
 *
 * Чего она стоит, если её обойти. Индикатор геймплея на debug-панели останется зелёным
 * после выхода в меню — и это ровно то, что модерация смотрит по требованию 1.19.
 * Дефект не виден в игре и не ломает ни одного теста: его замечает только площадка.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
const RUN = readFileSync(new URL('../sectorRun.ts', import.meta.url), 'utf8');
const BOTH = `${SRC}\n${RUN}`;

/** Строки файла — с номерами для внятного сообщения об ошибке. */
const linesOf = (src: string) =>
  src.split('\n').map((line, i) => ({ line: line.trim(), no: i + 1 }));

/** Тело функции по имени — пусто, если её нет (проверки ниже тогда падают). */
const bodyIn = (src: string, name: string): string =>
  new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(src)?.[1] ?? '';
const fnBody = (name: string): string => bodyIn(RUN, name);

describe('YAG-1.2a — разметка геймплея не может разойтись с состоянием забега', () => {
  it('сеттер существует и зовёт дверь разметки, а дверь — ОБА её конца', () => {
    const body = fnBody('setRunActive');
    expect(body, 'функция setRunActive не найдена — сторож проверял бы пустоту').toBeTruthy();
    expect(body).toContain('sectorRunActive = on');
    expect(body).toContain('markGameplay()');
    const mark = fnBody('markGameplay');
    expect(mark).toContain('gameplayStart');
    expect(mark).toContain('gameplayStop');
  });

  it('YAG-6.2: «геймплей идёт» = забег идёт И мир не стоит — и это видит каждый кадр', () => {
    // Темп мира меняют больше десятка мест; дверь зовётся из кадра при смене ответа, иначе
    // пауза, чтение комикса или выход в меню оставили бы индикатор площадки зелёным.
    expect(fnBody('markGameplay')).toContain(
      'const playing = sectorRunActive && game.worldRunning();',
    );
    // «Мир идёт» — тот же ответ, что сверяет кадр: не пауза и не комикс.
    expect(SRC).toContain('worldRunning: () => speed > 0 && !comicQueue.isBusy(),');
    expect(SRC).toContain(
      'if (gameplayMarked !== (sectorRunActive && speed > 0 && !comicQueue.isBusy())) markGameplay();',
    );
    expect(bodyIn(SRC, 'runPauseEvent')).toContain('markGameplay()');
  });

  it('звать площадку напрямую, мимо двери, нельзя', () => {
    const direct = BOTH.match(/\.gameplay(Start|Stop)\?\.\(\)/g) ?? [];
    expect(direct).toHaveLength(2);
    const mark = fnBody('markGameplay');
    expect(mark.match(/\.gameplay(Start|Stop)\?\.\(\)/g)).toHaveLength(2);
  });

  it('`sectorRunActive` присваивают только внутри сеттера', () => {
    const offenders = [...linesOf(RUN), ...linesOf(SRC)]
      .filter(({ line }) => /^sectorRunActive\s*=/.test(line))
      // Единственное законное присваивание — внутри `setRunActive` (`sectorRunActive = on`).
      .filter(({ line }) => line !== 'sectorRunActive = on;');
    expect(offenders).toEqual([]);
    expect(SRC.match(/^\s*sectorRunActive\s*=/gm) ?? []).toHaveLength(0);
  });

  it('объявление одно, и оно с начальным значением — а не присваивание в общем счёте', () => {
    const declare = /^(export )?let sectorRunActive\b/;
    const declarations = linesOf(RUN).filter(({ line }) => declare.test(line));
    expect(declarations).toHaveLength(1);
    expect(declarations[0]!.line).toContain('= false');
    expect(linesOf(SRC).filter(({ line }) => declare.test(line))).toHaveLength(0);
  });

  it('сеттер зовут отовсюду, где забег начинается или кончается — не меньше пяти точек', () => {
    // Пять на сегодня: новый забег, установка другой партии, уход в сеть, успешное
    // восстановление снимка и откат неудачного. Меньше — значит точку потеряли.
    //
    // ⚠️ Объявление функции ИСКЛЮЧЕНО из счёта, и это не педантизм: первая редакция
    // считала `\bsetRunActive\(` по всему файлу, ловила заодно `function setRunActive(`
    // и потому пропускала мутацию «убрать один вызов» — пять оставшихся совпадений её
    // устраивали. Сторож был слеп ровно к той потере, ради которой заведён.
    const calls = BOTH.match(/(?<!function )\bsetRunActive\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });

  it('площадка берётся через `getPlatform()`, а не через константу модуля', () => {
    const body = fnBody('markGameplay');
    // Дев-сборка и смоуки ставят площадку телом `main.ts` — ПОСЛЕ импорта модуля забега;
    // константа, снятая при импорте, держала бы прежнюю площадку.
    expect(body).toContain('getPlatform()');
  });
});
