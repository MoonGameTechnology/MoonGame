/**
 * Сторож подписей колонки инструментов (UIX-9.4).
 *
 * На ПК колонка под курсором раскрывается подписями (`holographic.css`), поэтому подпись —
 * имя кнопки, а не сокращение для узкого меню телефона («Дипло», «Корп», «Сон»). Имя то же,
 * что у плитки «Ещё» и раздела нижней панели телефона (`decisions/phoneNav.ts`): одна кнопка —
 * одно имя на обоих устройствах. Подсказка `title` всплывает через секунду поверх уже видной
 * подписи, поэтому она есть только там, где говорит больше подписи («Хранитель — передать ИИ
 * на сон»). Живой вёрстки в vitest нет — сторож читает разметку, как соседние.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PHONE_MORE, PHONE_TABS } from '../../decisions/phoneNav';
import { en } from '../../localization/en';
import { ru } from '../../localization/ru';

const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');

interface RailButton {
  id: string;
  label: string | undefined;
  title: string | undefined;
}

/** Кнопки колонки инструментов из разметки: id, ключ подписи и ключ подсказки. */
function railButtons(): RailButton[] {
  const at = BUILD.indexOf('<div id="railtools">');
  const block = BUILD.slice(at, BUILD.indexOf('</div>', at));
  return [...block.matchAll(/<button id="([\w-]+)"([^>]*)>(.*?)<\/button>/g)].map((m) => ({
    id: m[1]!,
    title: /data-i18n-title="([\w.-]+)"/.exec(m[2]!)?.[1],
    label: /<span class="rlbl" data-i18n="([\w.-]+)">/.exec(m[3]!)?.[1],
  }));
}

describe('колонка инструментов — подписи полными словами (UIX-9.4)', () => {
  const buttons = railButtons();

  it('у каждой кнопки есть подпись в обеих локалях', () => {
    expect(buttons.length).toBeGreaterThanOrEqual(10);
    for (const b of buttons) {
      expect(b.label, b.id).toBeDefined();
      expect(ru[b.label!], b.id).toBeTruthy();
      expect(en[b.label!], b.id).toBeTruthy();
    }
  });

  it('подпись — то же имя, что у кнопки на телефоне', () => {
    const phone = new Map([...PHONE_TABS, ...PHONE_MORE].map((item) => [item.opens, item.label]));
    const shared = buttons.filter((b) => phone.has(`#${b.id}`));
    expect(shared.length).toBeGreaterThanOrEqual(10);
    for (const b of shared) expect(b.label, b.id).toBe(phone.get(`#${b.id}`));
  });

  it('подсказка — только там, где она говорит больше подписи', () => {
    for (const b of buttons.filter((x) => x.title !== undefined))
      for (const locale of [ru, en])
        expect(locale[b.title!]?.toLowerCase(), b.id).not.toBe(locale[b.label!]?.toLowerCase());
  });
});
