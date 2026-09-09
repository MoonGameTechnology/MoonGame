import { describe, expect, it } from 'vitest';
import { composeGameDataBundle } from '../packages/shared-core/src/index';
import { FRAGMENTS, shippedGameData } from './bundle';

/**
 * Имена фрагментов, которые `composeGameDataBundle` РЕАЛЬНО спрашивает у своего
 * читателя — авторитетный список, ВЫВЕДЕННЫЙ из композера в рантайме, а не переписанный
 * рядом с ним. Рукописный второй список — именно то, что эти тесты и стерегут: когда
 * два списка разъезжаются, загрузчик НЕ падает. Каждое поле каталога в `schemas.ts`
 * несёт `.default({})` (`rewards` — `.prefault({})`), поэтому не переданный фрагмент
 * возвращается `undefined`, zod подставляет пустую запись, и `shippedGameData()` отдаёт
 * приложению безупречно валидный бандл с молча пропавшим контентом. Так и было в AUD-1:
 * до браузера доехали 11 фрагментов из 18, а весь слой героев и модулей корабля был пуст.
 */
function fragmentsRequestedByComposer(): string[] {
  const asked: string[] = [];
  composeGameDataBundle((name) => {
    asked.push(name);
    // Композер разыменовывает `manifest.version`; остальные фрагменты он только
    // передаёт дальше, поэтому `undefined` достаточно, чтобы обойти весь список.
    return name === 'manifest.json' ? { version: '0.0.0-probe' } : undefined;
  });
  return asked;
}

describe('шипнутый каталог — список фрагментов для сборщика', () => {
  it('перечисляет ровно те фрагменты, которые читает общий композер', () => {
    expect(Object.keys(FRAGMENTS).sort()).toEqual(fragmentsRequestedByComposer().sort());
  });

  // Проверки ключей выше самой по себе мало: запись, у которой пропало ЗНАЧЕНИЕ,
  // сохраняет ключ и всё равно морит загрузчик голодом — тот же тихий пустой каталог,
  // только другой дорогой. Утверждаем то, что загрузчик реально получит, а не то, как
  // карта подписана.
  it('разрешает каждый из этих фрагментов в настоящий контент, а не в undefined', () => {
    const starved = fragmentsRequestedByComposer().filter((name) => FRAGMENTS[name] == null);
    expect(starved).toEqual([]);
  });

  // Ущерб, ради которого стоят две структурные проверки, — утверждён напрямую и без
  // перечисления каталогов поимённо: каждый record-каталог собранного бандла обязан
  // нести записи. Список выводится из бандла, поэтому новый каталог покрыт сам собой.
  // `version` (строка) и `resources` (массив) пропущены: они обязательны по схеме, так
  // что пропавший фрагмент там бросает, а не подставляет дефолт, — они защищают себя сами.
  it('собирает каталоги, которые действительно заполнены', () => {
    const data = shippedGameData() as unknown as Record<string, unknown>;
    const empty = Object.entries(data)
      .filter(([, value]) => typeof value === 'object' && value !== null && !Array.isArray(value))
      .filter(([, value]) => Object.keys(value as object).length === 0)
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });
});
