import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BANNER_FORGOTTEN,
  bannerOffersRestart,
  displayOf,
  speedbarRestartShown,
  speedbarShown,
  timeControlsShown,
} from './matchExits';

describe('bannerOffersRestart', () => {
  // Правило 1: перезапуск предлагается только на настоящем конце соло-матча.
  it('offers a restart at the end of a solo match', () => {
    expect(bannerOffersRestart(false, 'ended')).toBe(true);
  });

  it('offers nothing on a net status banner, even a finished one', () => {
    expect(bannerOffersRestart(true, 'ended')).toBe(false);
    expect(bannerOffersRestart(true, 'active')).toBe(false);
  });

  // «Переподключаюсь» и «жду игроков» — живая партия, а не конец.
  it('offers nothing while a solo match is still running', () => {
    expect(bannerOffersRestart(false, 'active')).toBe(false);
    expect(bannerOffersRestart(false, 'lobby')).toBe(false);
  });

  // Модуля матча ещё нет — статуса тоже нет, и кончиться нечему.
  it('offers nothing when there is no match status at all', () => {
    expect(bannerOffersRestart(false, undefined)).toBe(false);
  });
});

describe('BANNER_FORGOTTEN', () => {
  // Правило 2: скрытый баннер обязан забыть свою разметку.
  it('is the empty markup that means «nothing is drawn»', () => {
    expect(BANNER_FORGOTTEN).toBe('');
  });
});

describe('speedbarRestartShown', () => {
  // Правило 3: только песочница без ботов.
  it('shows the speedbar restart in a solo match with no bots', () => {
    expect(speedbarRestartShown(false, 0)).toBe(true);
  });

  it('hides it once there are bots — the end banner carries the restart there', () => {
    expect(speedbarRestartShown(false, 1)).toBe(false);
    expect(speedbarRestartShown(false, 9)).toBe(false);
  });

  it('hides it in a net match', () => {
    expect(speedbarRestartShown(true, 0)).toBe(false);
    expect(speedbarRestartShown(true, 3)).toBe(false);
  });
});

describe('speedbarShown', () => {
  // Правило 4: на телефоне полоса несёт выход ⌂ — прятать её нельзя никогда.
  it('always shows the bar on a phone', () => {
    expect(speedbarShown(false, false, false)).toBe(true);
    expect(speedbarShown(false, true, false)).toBe(true);
  });

  it('follows the dev toggle on a PC', () => {
    expect(speedbarShown(true, true, false)).toBe(true);
    expect(speedbarShown(true, false, false)).toBe(false);
  });

  // Правило 6: в забеге полоса несёт его темп — ПК-игрок без дев-выключателя тоже её видит.
  it('shows the bar in a Sector Zero run on a PC without the dev toggle', () => {
    expect(speedbarShown(true, false, true)).toBe(true);
    expect(speedbarShown(false, false, true)).toBe(true);
  });
});

describe('timeControlsShown', () => {
  it('follows the dev toggle on a PC regardless of mode', () => {
    expect(timeControlsShown(true, true, false, true, false)).toBe(true);
    expect(timeControlsShown(true, false, false, false, false)).toBe(false);
    expect(timeControlsShown(true, false, true, true, false)).toBe(false);
  });

  // Правило 5: в сети временем распоряжается сервер — игроцкой сборке ускорять нечего.
  it('hides the controls on a phone only in a net player build', () => {
    expect(timeControlsShown(false, false, true, true, false)).toBe(false);
  });

  it('keeps the controls on a phone in solo, and in any non-player build', () => {
    expect(timeControlsShown(false, false, false, true, false)).toBe(true);
    expect(timeControlsShown(false, false, true, false, false)).toBe(true);
    expect(timeControlsShown(false, false, false, false, false)).toBe(true);
  });

  // Правило 6: ускорение забега — часть продукта, а не дев-инструмент.
  it('shows the run tempo in a Sector Zero run, PC player build included', () => {
    expect(timeControlsShown(true, false, false, true, true)).toBe(true);
    expect(timeControlsShown(false, false, false, true, true)).toBe(true);
  });
});

describe('rule 6 in the markup', () => {
  // Что именно несёт полоса в забеге, решает CSS по классу `spd-run` (его ставит кадр).
  const css = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
  const hidden = /\.spd\.spd-run ([^{]+)\{display:none;\}/.exec(css)?.[1] ?? '';

  it("hides the pace multipliers of both sets and the bar's own pause", () => {
    for (const part of ['.spd-mult-legacy', '.spd-mult-pc', '#spd-pause', '.spddiv'])
      expect(hidden).toContain(part);
  });

  it('shows ▶▶ in a run even where the PC layout drops it', () => {
    expect(css).toMatch(/\.spd\.spd-run #spd-fast\{display:inline-block;\}/);
  });
});

describe('rule 6 in the frame', () => {
  // Кадр — единственное место, где признак забега доходит до полосы: без него CSS выше не
  // сработает, а правила получат «не забег».
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

  it('marks the bar in a run and passes the run to both rules', () => {
    expect(main).toContain('const run = sectorZeroToolsHidden();');
    expect(main).toContain("speedbarEl.classList.toggle('spd-run', run);");
    expect(main).toContain(
      'timeControlsShown(pcUi(), devSpeedControl, NET, __PLAYER_BUILD__, run)',
    );
    expect(main).toContain('speedbarShown(pcUi(), devSpeedControl, run)');
  });
});

describe('displayOf', () => {
  it('maps shown/hidden onto the two style values', () => {
    expect(displayOf(true)).toBe('');
    expect(displayOf(false)).toBe('none');
  });
});
