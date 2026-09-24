import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { setLocale, t } from '../../localization/runtime';
import { initRunWallet, runWalletHtml, walletInfoText, type RunWalletHost, type WalletRules } from './runWallet';
import type { AdOutcome } from '../../decisions/adPlacements';

beforeAll(() => setLocale('ru'));

const RULES: WalletRules = { warrantsPerReward: 5, repairHp: 25, supplyPrice: 5, adAmount: 2, adPerDay: 3 };

describe('кошелёк профиля в шапке забега (решение владельца 2026-09-24)', () => {
  it('три валюты профиля — данные, Варранты, Суверены — с настоящими числами', () => {
    const html = runWalletHtml({ research: 12, warrants: 35, sovereigns: 7 });
    expect(html).toMatch(/tw-data[^>]*>.*◇.*12<\/button>/);
    expect(html).toMatch(/tw-warrants[^>]*>.*⌖.*35<\/button>/);
    expect(html).toMatch(/tw-sovereigns[^>]*>.*◆.*7<\/button>/);
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

describe('Суверены за ролик прямо в забеге (решение владельца 2026-09-24)', () => {
  const w = { research: 1, warrants: 2, sovereigns: 7 };

  it('«+» у Суверенов есть, только пока ролик доступен', () => {
    expect(runWalletHtml(w, { amount: 2, left: 3, open: false })).toContain('data-wallet="more"');
    expect(runWalletHtml(w, null)).not.toContain('data-wallet="more"');
  });

  it('ролик запускает только раскрытая кнопка, и на ней сказано, что будет ролик и что придёт', () => {
    // Требование площадки 4.5.1: голый «+» не говорит ни того, ни другого.
    expect(runWalletHtml(w, { amount: 2, left: 3, open: false })).not.toContain(
      'data-wallet="watch"',
    );
    const open = runWalletHtml(w, { amount: 2, left: 3, open: true });
    expect(open).toMatch(/data-wallet="watch"[^>]*>\+2 ◆ за рекламу · осталось 3</);
  });
});

describe('кошелёк: ролик только по раскрытой кнопке', () => {
  /** Корень без DOM: vitest здесь без jsdom, а кошельку нужны лишь разметка и клик. */
  function harness(outcome: Promise<AdOutcome>, inRun = true) {
    let click: (ev: { target: unknown }) => void = () => {};
    const root = {
      innerHTML: '',
      hidden: true,
      addEventListener: (_: string, fn: typeof click) => (click = fn),
    };
    const calls = { ads: [] as string[], applied: 0, notes: [] as string[] };
    let sovereigns = 7;
    let left = 3;
    const host: RunWalletHost = {
      root: root as unknown as HTMLElement,
      wallet: () => (inRun ? { research: 1, warrants: 2, sovereigns } : null),
      offer: () => (left > 0 ? { amount: 2, left } : null),
      rules: () => RULES,
      watchAd: (placement) => (calls.ads.push(placement), outcome),
      apply: () => {
        calls.applied++;
        sovereigns += 2;
        left--;
        return true;
      },
      note: (msg) => calls.notes.push(msg),
    };
    const wallet = initRunWallet(host);
    const press = (which: string, cur?: string) =>
      click({ target: { closest: () => ({ dataset: { wallet: which, ...(cur ? { cur } : {}) } }) } });
    return { root, calls, wallet, press };
  }

  it('кадр рисует кошелёк с «+», но без кнопки ролика — ролика нет', () => {
    const { root, calls, wallet } = harness(Promise.resolve('ok'));
    wallet.render();
    expect(root.hidden).toBe(false);
    expect(root.innerHTML).toContain('data-wallet="more"');
    expect(root.innerHTML).not.toContain('data-wallet="watch"');
    expect(calls.ads).toEqual([]);
  });

  it('«+» раскрывает кнопку, повторный «+» прячет — и ни разу не зовёт ролик', () => {
    const { root, calls, wallet, press } = harness(Promise.resolve('ok'));
    wallet.render();
    press('more');
    expect(root.innerHTML).toContain('data-wallet="watch"');
    press('more');
    expect(root.innerHTML).not.toContain('data-wallet="watch"');
    expect(calls.ads).toEqual([]);
  });

  it('досмотренный ролик — `run.sovereigns`, начисление и строка в ленте', async () => {
    const { root, calls, wallet, press } = harness(Promise.resolve('ok'));
    wallet.render();
    press('more');
    press('watch');
    press('watch'); // второе нажатие, пока ролик идёт, второго ролика не зовёт
    await Promise.resolve();
    expect(calls.ads).toEqual(['run.sovereigns']);
    expect(calls.applied).toBe(1);
    expect(calls.notes).toEqual(['Получено: +2 ◆.']);
    expect(root.innerHTML).toMatch(/tw-sovereigns[^>]*>.*◆.*9<\/button>/);
  });

  it('не досмотрел или адаптер сломан — ничего не начислено', async () => {
    const skipped = harness(Promise.resolve('cancelled'));
    skipped.press('watch');
    const broken = harness(Promise.reject(new Error('sdk')));
    broken.press('watch');
    await new Promise((r) => setTimeout(r, 0));
    expect(skipped.calls.applied + broken.calls.applied).toBe(0);
    expect(skipped.calls.notes).toHaveLength(1);
    expect(broken.calls.notes).toHaveLength(1);
  });

  it('вне забега кошелька нет', () => {
    const { root, wallet } = harness(Promise.resolve('ok'), false);
    wallet.render();
    expect(root.innerHTML).toBe('');
    expect(root.hidden).toBe(true);
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

  it('кошелёк — только в забеге, из профиля, и кадр перерисовывает его', () => {
    expect(main).toContain('wallet: () => (sectorZeroToolsHidden() ? sectorProgress : null),');
    expect(main).toMatch(/\n {2}runWallet\.render\(\);/);
  });

  it('ролик в кошельке — те же порция и дневной лимит, что у магазина, по сегодняшним суткам', () => {
    expect(main).toMatch(
      /offer: \(\) => \{\s*syncShopDay\(\);\s*const ad = adSovereigns\(sectorProgress, data, shopCapabilities\(platform\.capabilities\)\);/,
    );
    expect(main).toContain("apply: () => changeSectorProgress({ kind: 'ad-sovereigns' }),");
  });

  it('плашка-заглушка Суверенов в строке статуса в забеге не рисуется', () => {
    expect(main).toMatch(
      /\(sectorZeroToolsHidden\(\)\s*\? ''\s*: `<button type="button" class="dl-donate"/,
    );
  });
});

describe('тап по валюте раскрывает её описание (заказ владельца 2026-09-24)', () => {
  const w = { research: 1, warrants: 2, sovereigns: 7 };

  it('каждая валюта — кнопка описания; закрытое описание не рисуется', () => {
    const html = runWalletHtml(w);
    for (const cur of ['data', 'warrants', 'sovereigns'])
      expect(html).toContain(`data-wallet="info" data-cur="${cur}" aria-expanded="false"`);
    expect(html).not.toContain('tw-info');
  });

  it('описание называет настоящие числа — из правил, а не из текста', () => {
    expect(walletInfoText('warrants', RULES)).toContain('5 ⌖');
    const sov = walletInfoText('sovereigns', { ...RULES, repairHp: 40, supplyPrice: 9 });
    expect(sov).toContain('40');
    expect(sov).toContain('9 ◆');
    expect(sov).not.toMatch(/\{\w+\}/); // все подстановки сработали
    expect(walletInfoText('data', RULES)).toBe(t('sector-zero.wallet.data'));
  });

  it('тап раскрывает описание, повторный — прячет, другая валюта — сменяет', () => {
    const { root, wallet, press } = walletHarness();
    wallet.render();
    press('info', 'warrants');
    expect(root.innerHTML).toContain('class="tw-info tw-warrants"');
    expect(root.innerHTML).toContain('data-cur="warrants" aria-expanded="true"');
    press('info', 'sovereigns');
    expect(root.innerHTML).not.toContain('tw-info tw-warrants');
    expect(root.innerHTML).toContain('class="tw-info tw-sovereigns"');
    press('info', 'sovereigns');
    expect(root.innerHTML).not.toContain('tw-info');
  });

  it('описание и выбор ролика не открыты одновременно', () => {
    const { root, wallet, press } = walletHarness();
    wallet.render();
    press('info', 'data');
    press('more');
    expect(root.innerHTML).toContain('data-wallet="watch"');
    expect(root.innerHTML).not.toContain('tw-info');
    press('info', 'data');
    expect(root.innerHTML).not.toContain('data-wallet="watch"');
    expect(root.innerHTML).toContain('tw-info tw-data');
  });
});

/** Кошелёк без DOM для блока описаний: ролик здесь не зовётся. */
function walletHarness() {
  let click: (ev: { target: unknown }) => void = () => {};
  const root = { innerHTML: '', hidden: true, addEventListener: (_: string, fn: typeof click) => (click = fn) };
  const wallet = initRunWallet({
    root: root as unknown as HTMLElement,
    wallet: () => ({ research: 1, warrants: 2, sovereigns: 7 }),
    offer: () => ({ amount: 2, left: 3 }),
    rules: () => RULES,
    watchAd: () => Promise.resolve('cancelled'),
    apply: () => false,
    note: () => {},
  });
  const press = (which: string, cur?: string) =>
    click({ target: { closest: () => ({ dataset: { wallet: which, ...(cur ? { cur } : {}) } }) } });
  return { root, wallet, press };
}
