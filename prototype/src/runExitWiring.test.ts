/**
 * ⌂ в экспедиции спрашивает (решение владельца 2026-09-26: «кнопку "закончить экспедицию" —
 * чтоб выйти и получить награды, которые успел заработать»). «Завершить» жила только флажком
 * на рельсе и в меню ☰, а ⌂ молча уводила в меню, и награду было не забрать. Теперь ⌂
 * предлагает три действия: продолжить, в меню с сохранением, завершить и забрать награду.
 *
 * Сторож статический: `main.ts` живёт на DOM. Проводка может сломаться молча тремя способами:
 * 1. ⌂ снова уходит сразу — и игрок опять не находит, как забрать награду;
 * 2. программный выход (аппаратный Back, отмена загрузки карты, кнопка «В меню» самой карточки)
 *    начинает спрашивать — и «В меню» открывает ту же карточку по кругу;
 * 3. на ПК, где ⌂ в полосе скорости спрятан, выход шевроном «‹» или с рельса уходит без вопроса.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');

/** Тело обработчика клика по элементу с этим id. */
const handler = (id: string): string =>
  new RegExp(
    `(?:\\$\\('${id}'\\)|document\\.getElementById\\('${id}'\\)\\?)\\.addEventListener\\('click', \\(([^)]*)\\) => \\{([\\s\\S]*?)\\n\\}\\);`,
  ).exec(SRC)?.[2] ?? '';

describe('⌂ в экспедиции спрашивает, а не уходит молча', () => {
  it('живой тап по ⌂ в идущей экспедиции открывает выбор, а не уводит в меню', () => {
    const body = handler('tomenu');
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/if \(ev\.isTrusted && runInProgress\(\)\) \{\s*openAbandon\('exit', \$\('tomenu'\)\);\s*return;\s*\}/);
    // Проверка стоит ДО ухода: иначе забег успел бы сохраниться и закрыться.
    expect(body.indexOf("openAbandon('exit'")).toBeLessThan(body.indexOf('saveRun()'));
  });

  it('«В меню» уходит программным кликом — он не доверенный, поэтому карточка не открывается вновь', () => {
    const body = handler('abandon-menu');
    expect(body).toContain('closeAbandon();');
    expect(body).toContain("$('tomenu').click();");
  });

  it('выход с рельса и шеврон ‹ в экспедиции тоже спрашивают — на ПК ⌂ спрятан', () => {
    const body = handler('rail-exit');
    expect(body).toMatch(/if \(runInProgress\(\)\) openAbandon\('exit'/);
    expect(body).toContain("else $('tomenu').click();");
    const chevron = handler('topback');
    expect(chevron).toMatch(/if \(act === 'exit' && runInProgress\(\)\) openAbandon\('exit', \$\('topback'\)\);/);
  });

  it('карточка называет сумму «Завершить» тем же профилем и главой, что засчёт', () => {
    // Превью и засчёт — одна формула (`runPayout`); разойтись они могут только входами.
    expect(SRC).toContain('abandonRunReward(sectorProgress, s, chapterForSettle(sectorMission), data)');
    expect(SRC).toContain('settleSectorZeroRun(sectorProgress, sectorAttempt, s, chapterForSettle(sectorMission), data)');
    // Стенд разработчика не платит — и суммы не обещает.
    expect(SRC).toContain('reward.hidden = sectorDevActive;');
    expect(BUILD).toMatch(/<div class="wp-reward" id="abandon-reward" hidden><\/div>/);
  });

  it('у выбора ⌂ свои слова и своя кнопка «В меню», скрытая у прочих поводов', () => {
    expect(SRC).toMatch(/exit: \{ title: 'run\.exit\.title', text: 'run\.exit\.text', stay: 'run\.abandon\.back', go: 'run\.exit\.go' \}/);
    expect(SRC).toContain("$('abandon-menu').hidden = !exit;");
    expect(BUILD).toMatch(/<button type="button" id="abandon-menu"[^>]*data-i18n="run\.exit\.menu" hidden><\/button>/);
  });
});
