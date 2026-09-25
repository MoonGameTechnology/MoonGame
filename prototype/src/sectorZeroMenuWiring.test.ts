/**
 * Сторож меню Sector Zero (`AUD-33`) — статический: меню живёт на DOM, а DOM-окружения у
 * гейта нет. Поведение на собранном архиве проверяет робот `yandextest.mjs` (битый журнал
 * забега → меню доступно).
 *
 * Меню — единственная дверь в игру на странице Sector Zero, и оно ждёт чтения сохранения.
 * Исключение в этом чтении оставляло флаг загрузки поднятым: кнопки погашены, подпись
 * «Проверяем сохранение…» — навсегда, и перезагрузка не помогала, пока битый журнал лежит
 * в хранилище.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./sectorZeroMenu.ts', import.meta.url), 'utf8');
const open = /async function open\(\)[\s\S]*?\n {2}\}/.exec(SRC)?.[0] ?? '';

describe('AUD-33 — сбой чтения сохранения не запирает меню', () => {
  it('чтение обёрнуто: исключение — «сохранения нет», а не вечная загрузка', () => {
    expect(open).toMatch(/try \{\s+loaded = await h\.load\(\);\s+\} catch \(error\) \{/);
    // Флаг загрузки снимается ПОСЛЕ ловушки — на любом исходе чтения.
    expect(open.indexOf('loading = false;')).toBeGreaterThan(open.indexOf('} catch (error) {'));
  });

  it('игрок видит, что сохранение не открылось, и может начать заново', () => {
    expect(open).toContain("if (failed) el('sz-summary').textContent = t('sector-zero.restore-failed');");
  });
});
