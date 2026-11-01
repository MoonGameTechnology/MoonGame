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
  // Правило 4: на телефоне ряд раскрывает кнопка скорости — гасить узел нельзя никогда.
  it('always shows the bar on a phone', () => {
    expect(speedbarShown(false, false, false)).toBe(true);
    expect(speedbarShown(false, true, false)).toBe(true);
  });

  // На ПК полоса видна, пока ей есть что нести: управление временем или перезапуск.
  it('shows the bar on a PC only when it carries something', () => {
    expect(speedbarShown(true, true, false)).toBe(true);
    expect(speedbarShown(true, false, true)).toBe(true);
    expect(speedbarShown(true, false, false)).toBe(false);
  });
});

describe('timeControlsShown', () => {
  it('follows the dev toggle on a PC in solo', () => {
    expect(timeControlsShown(true, true, false, false)).toBe(true);
    expect(timeControlsShown(true, false, false, false)).toBe(false);
  });

  // Правило 5: в сети временем распоряжается сервер — ни на ПК, ни на телефоне.
  it('hides the controls in a network match everywhere, dev toggle included', () => {
    expect(timeControlsShown(true, true, true, false)).toBe(false);
    expect(timeControlsShown(false, false, true, false)).toBe(false);
  });

  it('keeps the controls on a phone in solo', () => {
    expect(timeControlsShown(false, false, false, false)).toBe(true);
  });

  // Правило 6: ускорение забега — часть продукта, а не дев-инструмент.
  it('shows the run tempo in a Sector Zero run on a PC without the dev toggle', () => {
    expect(timeControlsShown(true, false, false, true)).toBe(true);
    expect(timeControlsShown(false, false, false, true)).toBe(true);
  });

  // Правило 7: ×300 урока видно и на ПК без дев-выключателя.
  it('shows the lesson tempo in the guided first match on a PC without the dev toggle', () => {
    expect(timeControlsShown(true, false, false, false, true)).toBe(true);
    expect(timeControlsShown(false, false, false, false, true)).toBe(true);
    expect(timeControlsShown(true, false, true, false, true)).toBe(false); // правило 5 сильнее
  });
});

describe('rule 6 in the markup', () => {
  // Что именно несёт полоса в забеге, решает CSS по классу `spd-run` (его ставит кадр).
  const css = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
  const hidden = /\.spd\.spd-run ([^{]+)\{display:none;\}/.exec(css)?.[1] ?? '';

  it('hides the pace multipliers of both sets, but keeps the pause — it lives here now', () => {
    for (const part of ['.spd-mult-legacy', '.spd-mult-pc', '.spddiv']) expect(hidden).toContain(part);
    expect(hidden).not.toContain('#spd-pause');
  });

  it('shows ▶▶ in a run even where the PC layout drops it', () => {
    expect(css).toMatch(/\.spd\.spd-run #spd-fast\{display:inline-block;\}/);
  });
});

describe('rule 6 in the frame', () => {
  // Кадр — единственное место, где признак забега доходит до полосы: без него CSS выше не
  // сработает, а правила получат «не забег». Кадр полосы — у её владельца (`matchTopBar.ts`,
  // REFM-222); признак забега и тумблер разработчика он берёт хуками `main.ts`.
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const bar = readFileSync(new URL('./matchTopBar.ts', import.meta.url), 'utf8');

  it('marks the bar in a run and passes the run to the time controls', () => {
    expect(bar).toContain('const run = game.toolsHidden();');
    expect(bar).toContain("speedbarEl.classList.toggle('spd-run', run);");
    expect(bar).toContain(
      'timeControlsShown(pcUi(), game.speedControl(), netWorld, run, lesson)',
    );
    expect(bar).toContain('const lesson = game.lessonSpeed() && !netWorld;');
    expect(bar).toContain("speedbarShown(pcUi(), showSpdCtl === '', restartShown)");
    expect(main).toContain('toolsHidden: sectorZeroToolsHidden,');
    expect(main).toContain('speedControl: () => devSpeedControl,');
    expect(main).toContain('lessonSpeed: lessonRunning,');
    expect(main).toMatch(/renderEndScreen\(\);\s*renderSpeedbar\(\);/);
  });

  it('▶▶▶ — только в дев-забеге, и в игроцкой сборке её нет вовсе', () => {
    expect(bar).toContain('const devHidden = !(run && sectorDevActive);');
    expect(bar).toContain('devFastBtn.hidden = devHidden;');
    const markup = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
    expect(markup).toMatch(/<!--dev-only--><button id="spd-dev"[^>]*hidden>▶▶▶<\/button><!--\/dev-only-->/);
  });
});

describe('одна запись скорости (UIX-5.2)', () => {
  // Скорость везде пишется «×N», и N — настоящий множитель к реальному времени (`data-mult`
  // полосы, `data-spd` настройки матча): ПК подписывал ×1800 как «30×», и это читалось почти
  // как «×50» телефона.
  const markup = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
  const chips = [
    ...markup.matchAll(/<button class="spd(?:mini|chip)"[^>]* data-(?:mult|spd)="(\d+)"[^>]*>([^<]*)<\/button>/g),
  ];

  it('подпись каждого чипа — «×» и его множитель', () => {
    expect(chips.length).toBe(14); // полоса: 4 телефона + 4 ПК; настройка матча: 6
    for (const [, mult, label] of chips) expect(label).toBe(`×${mult}`);
  });
});

describe('displayOf', () => {
  it('maps shown/hidden onto the two style values', () => {
    expect(displayOf(true)).toBe('');
    expect(displayOf(false)).toBe('none');
  });
});
