import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { setLocale } from '../../localization/runtime';
import { runWalletHtml } from './runWallet';

beforeAll(() => setLocale('ru'));

describe('кошелёк профиля в шапке забега (решение владельца 2026-09-24)', () => {
  it('три валюты профиля — данные, Варранты, Суверены — с настоящими числами', () => {
    const html = runWalletHtml({ research: 12, warrants: 35, sovereigns: 7 });
    expect(html).toMatch(/tw-data[^>]*>.*◇.*12<\/span>/);
    expect(html).toMatch(/tw-warrants[^>]*>.*⌖.*35<\/span>/);
    expect(html).toMatch(/tw-sovereigns[^>]*>.*◆.*7<\/span>/);
  });

  it('полное имя валюты — в подписи для мыши и скринридера', () => {
    const html = runWalletHtml({ research: 12, warrants: 35, sovereigns: 7 });
    expect(html).toContain('title="Данные экспедиций: 12"');
    expect(html).toContain('aria-label="Варранты: 35 ⌖"');
    expect(html).toContain('title="Суверены: 7 ◆"');
  });

  it('разные числа — разная разметка: кадр увидит прибавку и перерисует', () => {
    expect(runWalletHtml({ research: 1, warrants: 0, sovereigns: 7 })).not.toBe(
      runWalletHtml({ research: 1, warrants: 0, sovereigns: 8 }),
    );
  });
});

describe('шапка забега — проводка в кадре', () => {
  // Кадр — единственное место, где признак забега доходит до шапки.
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('поля основной игры прячутся в забеге и возвращаются вне его', () => {
    expect(main).toMatch(
      /for \(const id of Object\.values\(SECTOR_ZERO_ABSENT_HUD\)\) \{[\s\S]*?el\.style\.display = run \? 'none' : '';/,
    );
  });

  it('кошелёк — только в забеге, из профиля', () => {
    expect(main).toContain(
      "const walletHtml = sectorZeroToolsHidden() ? runWalletHtml(sectorProgress) : '';",
    );
    expect(main).toContain('tbWallet.hidden = !walletHtml;');
  });

  it('плашка-заглушка Суверенов в строке статуса в забеге не рисуется', () => {
    expect(main).toMatch(
      /\(sectorZeroToolsHidden\(\)\s*\? ''\s*: `<button type="button" class="dl-donate"/,
    );
  });
});
