/**
 * Сторож проводки облачного сейва (`YAG-2.2`) — статический: `main.ts` живёт на DOM.
 * Правила сверки покрыты в `decisions/cloudSync.test.ts`, адаптер — в `yandex.test.ts`,
 * поведение на собранном архиве — робот `yandextest.mjs`. Здесь стык, и у него три
 * способа сломаться молча:
 *
 * 1. **Изменение без новой правки.** Профиль сохранился, а номер правки не сдвинулся —
 *    сверка на другом устройстве решит, что вперёд ушло облако, и возьмёт его поверх
 *    свежего локального прогресса.
 * 2. **Сверка не ждёт меню.** Меню показало локальный профиль, а через секунду под ним
 *    подменился облачный — игрок успел потратить валюту в чужом профиле.
 * 3. **Уход со страницы без отправки.** Таймер окна квоты после выгрузки не сработает, и
 *    последний прогресс останется на одном устройстве.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const body = (name: string): string =>
  new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(SRC)?.[1] ?? '';

describe('YAG-2.2 — каждое изменение профиля — новая правка облака', () => {
  it('сохранение профиля двигает правку', () => {
    expect(body('saveSectorProgress')).toContain('bumpCloudRev();');
  });

  it('смена дескриптора забега двигает правку, повтор того же — нет', () => {
    const save = body('saveRun');
    expect(save).toContain('if (portable !== lastPortableRaw) {');
    expect(save).toContain('bumpCloudRev();');
  });

  it('правка отправляется в облако, а отправка отмечает сверку', () => {
    expect(body('bumpCloudRev')).toContain('pushCloud();');
    expect(body('pushCloud')).toContain('syncedRev: syncMark.rev');
  });
});

describe('YAG-2.2 — сверка на старте', () => {
  it('цепляется к записи профиля — меню её дожидается', () => {
    expect(SRC).toContain('progressWrite = progressWrite.then(syncCloud)');
  });

  it('решение принимает общее правило, развилка облако не трогает', () => {
    const sync = body('syncCloud');
    expect(sync).toContain('planCloudSync(');
    expect(sync).toMatch(/if \(plan === 'choose'\) \{\s+cloudState = 'held';\s+return;/);
    expect(body('pushCloud')).toContain("if (cloudState !== 'on') return;");
  });

  it('облако не ответило вовремя — в этой сессии его нет, а не зависшее меню', () => {
    const sync = body('syncCloud');
    expect(sync).toContain('Promise.race([');
    expect(sync).toContain('if (raw === undefined) return;');
  });
});

describe('YAG-2.2 — уход со страницы', () => {
  it('отправляет копию сразу, а не в окно квоты', () => {
    expect(SRC).toContain("addEventListener('pagehide', () => pushCloud(true));");
    expect(SRC).toMatch(/if \(document\.visibilityState === 'hidden'\) pushCloud\(true\);/);
  });
});
