/**
 * Сторож проводки «назад» и выхода площадки (`YAG-6.4`) — статический: `main.ts` живёт на
 * DOM. Подписки адаптера покрыты в `platform/yandex.test.ts`, поведение на собранном архиве —
 * робот `yandextest.mjs`. Здесь стык, и у него два способа сломаться молча:
 *
 * 1. **«Назад» площадки идёт мимо лестницы слоёв.** Своя логика рядом с браузерной — две
 *    правды об одном жесте: одна закрывает окно, другая выкидывает из забега.
 * 2. **Выход площадки ничего не сохраняет.** Страница может не дожить до `pagehide`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

describe('YAG-6.4 — «назад» и выход площадки', () => {
  it('браузер и площадка делают один и тот же шаг «назад»', () => {
    expect(SRC).toMatch(
      /window\.addEventListener\('popstate', \(\) => \{\s+backArmed = false;\s+stepBack\(true\);/,
    );
    expect(SRC).toContain('host.onHistoryBack?.(() => stepBack(false));');
  });

  it('выход площадки ставит забег на паузу и сохраняет его и облачную копию', () => {
    const exit = /host\.onExit\?\.\(\(\) => \{([\s\S]*?)\}\);/.exec(SRC)?.[1] ?? '';
    expect(exit).toContain("runPauseEvent('hidden');");
    expect(exit).toContain('saveRun();');
    expect(exit).toContain('pushCloud(true);');
  });
});
