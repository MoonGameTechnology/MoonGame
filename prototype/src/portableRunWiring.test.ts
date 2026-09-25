/**
 * Сторож проводки дескриптора забега (`YAG-2.1`) — статический: `main.ts` живёт на DOM.
 * Правила дескриптора покрыты там, где они живут (`decisions/portableRun*.test.ts`), здесь —
 * стык с хостом, и у него три способа сломаться молча:
 *
 * 1. **Дескриптор переживает снимок.** Снимок стирают после награды за законченный
 *    забег; забудь стереть рядом дескриптор — и у законченного забега снова появится
 *    «Продолжить». Награду повторно не выдаст номер попытки, но игрок получит забег,
 *    который уже кончился.
 * 2. **Дескриптор не пишется.** Запасной путь молча пуст ровно тогда, когда он нужен —
 *    после обновления игры, сломавшего снимок.
 * 3. **Отказ снимка не ведёт к дескриптору.** Любой ранний `return false` в `restoreRun`
 *    вместо перехода к запасному пути отнимает у игрока забег, который можно было вернуть.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const body = (name: string): string =>
  new RegExp(`function ${name}\\(\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(SRC)?.[1] ?? '';

describe('YAG-2.1 — дескриптор живёт и умирает вместе со снимком', () => {
  it('каждая очистка снимка стирает и дескриптор', () => {
    const snapshot = SRC.match(/runSaveStore\.clear\(\)/g)?.length ?? 0;
    const portable = SRC.match(/portableRunStore\.clear\(\)/g)?.length ?? 0;
    expect(snapshot).toBeGreaterThan(0);
    expect(portable).toBe(snapshot);
  });

  it('запись снимка пишет и дескриптор', () => {
    const save = body('saveRun');
    expect(save).toContain('runSaveStore.save(');
    expect(save).toContain('portableRunStore.save(');
  });

  it('`restoreRun` при любом отказе снимка переходит к дескриптору, а не сдаётся', () => {
    const restore = body('restoreRun');
    expect(restore.length).toBeGreaterThan(200);
    // Единственный законный отказ без запасного пути — пришедший по ссылке или сеть.
    const refusals = restore.match(/return false;/g)?.length ?? 0;
    expect(refusals).toBe(1);
    expect(restore).toMatch(/if \(cameFromLink \|\| NET\) return false;/);
    expect(restore.match(/return restorePortable\(\);/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('восстановление по дескриптору собирает мир ТОЙ главы, что в нём записана', () => {
    const portable = body('restorePortable');
    expect(portable).toContain('pveMissionOfMap(save?.map)');
    // Мир главы — через `chapterWorld` (PVR-6.27: минус встречи, чьи задачи закрыты), и он
    // строится с карты ТОЙ ЖЕ главы.
    expect(portable).toContain('chapterWorld(mission)');
    expect(/function chapterWorld\(mission: number\)[^{]*\{[^}]*pveState\(data, mission\)/.test(SRC)).toBe(true);
    expect(portable).toContain('resumePortableRun(');
  });
});
