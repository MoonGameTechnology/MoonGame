import { describe, expect, it } from 'vitest';
import { t } from '../../localization/runtime';
import { toggleWingMore, wingOrdersHtml, type WingOrder } from './wingOrders';

const order = (act: string, on?: boolean): WingOrder => ({
  act,
  arg: 'sq:1',
  icon: 'crosshair',
  glyph: '✳',
  label: act,
  ...(on === undefined ? {} : { on }),
});

/** Классы плитки с приказом `act`. */
const cls = (html: string, act: string): string =>
  new RegExp(`class="([^"]*)" data-act="${act}"`).exec(html)?.[1] ?? '';

describe('приказы эскадры плитками', () => {
  it('без приказов ряда нет', () => {
    expect(wingOrdersHtml([], 'sq:1')).toBe('');
  });

  it('плитка — значок над подписью, как у ряда команд флота; шлёт тот же data-act', () => {
    const html = wingOrdersHtml([order('wingstrike')], 'sq:1');
    expect(html).toContain('data-act="wingstrike" data-arg="sq:1"');
    expect(html).toContain('<span class="ci" aria-hidden="true">');
    expect(html).toContain('<span class="cl">wingstrike</span>');
    expect(html).toContain(`<b>${t('fleet.console.orders')}</b>`);
    expect(html).not.toContain('data-act="wingmore"');
  });

  it('больше трёх — «Ещё», лишние помечены; «Ещё» раскрывает ряд и закрывает его', () => {
    const four = ['wingstrike', 'wingpatrol', 'wingsplit', 'wingmerge'].map((a) => order(a));
    const html = wingOrdersHtml(four, 'sq:1');
    expect(cls(html, 'wingpatrol')).toBe('btn-second');
    expect(cls(html, 'wingsplit')).toBe('btn-second extra');
    expect(html).toContain('data-act="wingmore" data-arg="sq:1"');
    expect(html).not.toContain('wing-orders open');
    toggleWingMore('sq:1');
    expect(wingOrdersHtml(four, 'sq:1')).toContain('wing-orders open');
    // Раскрыт ряд ЭТОЙ эскадры: у соседки он свёрнут.
    expect(wingOrdersHtml(four, 'sq:2')).not.toContain('wing-orders open');
    toggleWingMore('sq:1');
    expect(wingOrdersHtml(four, 'sq:1')).not.toContain('wing-orders open');
  });

  it('переключатель горит и говорит своё состояние', () => {
    const html = wingOrdersHtml([order('wingkeep', true)], 'st:1');
    expect(cls(html, 'wingkeep')).toBe('btn-second on');
    expect(html).toContain('aria-pressed="true"');
  });
});
