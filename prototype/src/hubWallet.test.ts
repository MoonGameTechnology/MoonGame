import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import { hubWalletHtml, initHubWallet } from './hubWallet';

beforeAll(() => setLocale('ru'));

describe('кошелёк главного экрана (UIX-10.2)', () => {
  it('Суверены — золотая плашка с «+», как фишка в строке статуса партии', () => {
    const html = hubWalletHtml({ sovereigns: 500, warrants: 0 });
    expect(html).toMatch(
      /class="dl-donate" data-hub-wallet="donate"[^>]*>.*<svg.*<\/svg><\/i><b>500<\/b><em aria-hidden="true">\+<\/em><\/button>/,
    );
    expect(html).toContain('aria-label="Суверены: 500. Пополнить"');
  });

  it('Варранты ⌖ и дверь в аукцион — одна кнопка: валюта и место, где её тратят', () => {
    const html = hubWalletHtml({ sovereigns: 500, warrants: 1250 });
    expect(html).toMatch(
      /class="tw-cur tw-warrants" data-hub-wallet="auction"[^>]*>.*⌖.*1\.3k<span class="hw-go" aria-hidden="true">Аукцион<\/span><\/button>/,
    );
    // Скринридер и мышь слышат число и действие, а не «⌖ 1.3k Аукцион».
    expect(html).toContain('aria-label="Варранты: 1.3k. Открыть аукцион"');
  });

  it('разные числа — разная разметка: хаб перерисует кошелёк после ответа аукциона', () => {
    expect(hubWalletHtml({ sovereigns: 500, warrants: 0 })).not.toBe(
      hubWalletHtml({ sovereigns: 500, warrants: 40 }),
    );
  });
});

describe('кошелёк главного экрана: нажатия', () => {
  /** Корень без DOM: vitest здесь без jsdom, а кошельку нужны лишь разметка и клик. */
  function harness() {
    let click: (ev: { target: unknown }) => void = () => {};
    let writes = 0;
    let html = '';
    const root = {
      get innerHTML() {
        return html;
      },
      set innerHTML(v: string) {
        writes++;
        html = v;
      },
      addEventListener: (_: string, fn: typeof click) => (click = fn),
    };
    const calls: string[] = [];
    let warrants = 0;
    const wallet = initHubWallet({
      root: root as unknown as HTMLElement,
      wallet: () => ({ sovereigns: 500, warrants }),
      donate: () => calls.push('donate'),
      auction: () => calls.push('auction'),
    });
    const press = (which: string | undefined) =>
      click({ target: { closest: () => (which ? { dataset: { hubWallet: which } } : null) } });
    return {
      root,
      calls,
      wallet,
      press,
      writes: () => writes,
      earn: (n: number) => (warrants = n),
    };
  }

  it('«+» — магазин Суверенов, плашка Варрантов — аукцион, мимо кнопок — ничего', () => {
    const { calls, wallet, press } = harness();
    wallet.render();
    press('donate');
    press('auction');
    press(undefined);
    expect(calls).toEqual(['donate', 'auction']);
  });

  it('перерисовка только при новом числе: фокус на кнопке не сбрасывается зря', () => {
    const { root, wallet, writes, earn } = harness();
    wallet.render();
    wallet.render();
    expect(writes()).toBe(1);
    earn(40);
    wallet.render();
    expect(writes()).toBe(2);
    expect(root.innerHTML).toContain('⌖</i>40');
  });
});
