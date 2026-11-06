import { describe, expect, it } from 'vitest';
import { t } from '../../localization/runtime';
import { eventLogHtml } from './eventLogView';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('журнал «Событий» по дням (UIX-10.9)', () => {
  const html = eventLogHtml([
    { time: 2 * HOUR + 12 * 60_000, msg: '🛠️ 1× разведчик · METIS-9' },
    { time: DAY + 17 * HOUR + 35 * 60_000, msg: '⚔️ бой · SELENE-2 (орбита)', at: 'selene' },
    { time: DAY + 17 * HOUR + 35 * 60_000, msg: '☠️ флот уничтожен' },
    { time: 4 * DAY + 11 * 60_000, msg: '🌾 Гниль на фермах: −50 еды' },
  ]);

  it('свежие сверху; день назван один раз, у первой записи дня, у остальных — время суток', () => {
    const stamps = [...html.matchAll(/<time class="lg-hm">([^<]*)<\/time>/g)].map((m) => m[1]);
    expect(stamps).toEqual([
      t('fmt.stamp', { d: 5, hm: '00:11' }),
      t('fmt.stamp', { d: 2, hm: '17:35' }),
      '17:35',
      t('fmt.stamp', { d: 1, hm: '02:12' }),
    ]);
    // Разделитель «·» после метки не нужен: метка своим цветом отделена от текста.
    expect(html).toContain('</time> 🌾 Гниль');
    expect(html).not.toContain('</time> ·');
  });

  it('кнопка ⌖ — только у записи с местом', () => {
    expect(html.match(/class="lg-ping"/g)).toHaveLength(1);
    expect(html).toContain('data-ping="selene"');
  });

  it('пустой журнал — пустая разметка', () => {
    expect(eventLogHtml([])).toBe('');
  });
});
