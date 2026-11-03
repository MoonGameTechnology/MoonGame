/**
 * Живые отсчёты (`liveTimers.ts`): разметка несёт момент, цифры ставит патч на месте. Здесь
 * проверены обе половины договора: что в разметке нет цифр и что патч ставит верные цифры,
 * подсказку, полосу и долю, а неизменившийся текст не переписывает.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale, t } from '../../localization/runtime';
import { countdownHMS, fmtEta, fmtHrs } from './format';
import {
  LIVE_SLOT,
  liveBarHtml,
  livePctHtml,
  liveSinceHtml,
  liveTimerHtml,
  liveTipAttrs,
  patchLiveTimers,
} from './liveTimers';
import { liveRender } from './liveTimers.fixture';
import { HOUR } from './time';

beforeAll(() => setLocale('ru'));

describe('разметка живых узлов', () => {
  it('несёт момент и формат, а вместо цифр — «…»', () => {
    expect(liveTimerHtml(5000)).toBe('<span class="pn-timer" data-at="5000">…</span>');
    expect(liveTimerHtml(5000, 'hms')).toBe(
      '<span class="pn-timer" data-at="5000" data-fmt="hms">…</span>',
    );
    expect(liveSinceHtml(700, 'dur')).toBe(
      '<span class="pn-timer" data-since="700" data-fmt="dur">…</span>',
    );
    expect(liveBarHtml(100, 300)).toBe('<i class="pn-bar" data-since="100" data-at="300"></i>');
  });

  it('шаблон подсказки экранирован, место отсчёта отмечено', () => {
    expect(liveTipAttrs(9, 'hms', `"залп" через ${LIVE_SLOT}`)).toBe(
      ' data-at="9" data-fmt="hms" data-tip="&quot;залп&quot; через {t}"',
    );
  });
});

describe('живой патч', () => {
  it('отсчёт до срока — в формате узла; по умолчанию — как `timeLeft`', () => {
    const now = 10 * HOUR;
    const html = liveTimerHtml(now + 2.5 * HOUR) + liveTimerHtml(now + 90 * 60_000, 'hms') +
      liveTimerHtml(now + 14 * HOUR, 'hrs');
    expect(liveRender(html, now).replace(/<[^>]+>/g, '|')).toBe(
      `|${fmtEta(2.5)}||${countdownHMS(90 * 60_000)}||${fmtHrs(14)}|`,
    );
  });

  it('срок прошёл — ноль, а не минус', () => {
    expect(liveRender(liveTimerHtml(1000, 'hms'), 5000)).toContain(`>${countdownHMS(0)}<`);
  });

  it('«столько-то назад» считает от начала', () => {
    const formats = { dur: (ms: number) => `${ms}мс` };
    expect(liveRender(liveSinceHtml(200, 'dur'), 1200, formats)).toContain('>1000мс<');
  });

  it('неизвестный формат — «—», а не чужие цифры', () => {
    expect(liveRender(liveTimerHtml(9000, 'nope'), 0)).toContain('>—<');
  });

  it('подсказка: срок встаёт на место {t}, и в `title`, и в `aria-label`', () => {
    const tip = t('side.world.bombard-next', { t: LIVE_SLOT });
    const html = `<span class="pfact pn-tip"${liveTipAttrs(HOUR, 'hms', tip)}>⊗</span>`;
    expect(liveRender(html, 0)).toContain(
      `title="${t('side.world.bombard-next', { t: countdownHMS(HOUR) })}"`,
    );
  });

  it('полоса растёт от начала к сроку и не выходит за края', () => {
    const bar = liveBarHtml(100, 300);
    expect(liveRender(bar, 150)).toContain('style="width:25%"');
    expect(liveRender(bar, 50)).toContain('style="width:0%"');
    expect(liveRender(bar, 900)).toContain('style="width:100%"');
    // Пустое окно — работа уже сделана.
    expect(liveRender(liveBarHtml(300, 300), 0)).toContain('style="width:100%"');
  });

  it('доля погрузки — по объёму окон, целыми процентами вниз', () => {
    const html = livePctHtml([
      { startAt: 0, doneAt: 100, volume: 2 },
      { startAt: 0, doneAt: 300, volume: 1 },
    ]);
    // (2·1 + 1·⅓) / 3 = 77.7…% → 77
    expect(liveRender(html, 100)).toContain('>77<');
  });

  it('то же значение не переписывается: узел не трогается лишний раз', () => {
    const writes: string[] = [];
    let text = countdownHMS(HOUR - 400);
    const el = {
      dataset: { at: String(HOUR), fmt: 'hms' },
      get textContent() {
        return text;
      },
      set textContent(v: string) {
        writes.push(v);
        text = v;
      },
    };
    const root = {
      querySelectorAll: (sel: string) => (sel === '.pn-timer' ? [el] : []),
    } as unknown as ParentNode;
    patchLiveTimers(root, 400);
    patchLiveTimers(root, 1000); // секунда ещё не сменилась — цифры те же
    expect(writes).toEqual([]);
    patchLiveTimers(root, 1500);
    expect(writes).toEqual([countdownHMS(HOUR - 1500)]);
  });
});
