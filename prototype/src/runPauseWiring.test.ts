/**
 * Сторож проводки паузы забега (`YAG-6.2`) — статический: `main.ts` живёт на DOM. Правила
 * паузы покрыты там, где они живут (`decisions/runPause.test.ts`), поведение на собранном
 * архиве — робот `yandextest.mjs`. Здесь стык, и у него четыре способа сломаться молча:
 *
 * 1. **Повод не подключён.** Уход со страницы или пауза площадки не доходят до правила —
 *    мир снова тикает без игрока, и ни один тест правил этого не видит.
 * 2. **Возобновление нагоняет паузу.** Забыт сброс отметки реального времени — первый кадр
 *    после «продолжить» отыграет всё время паузы разом.
 * 3. **Кнопка паузы в полосе скорости идёт мимо правила.** С 2026-09-24 пауза забега живёт
 *    в полосе рядом с ▶ и ▶▶ (решение владельца), и общий обработчик полосы ставит темп
 *    напрямую — а правило помнит, с каким темпом продолжать, и слышит уход со страницы.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
const body = (name: string): string =>
  new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(SRC)?.[1] ?? '';

describe('YAG-6.2 — каждый повод паузы доходит до правила', () => {
  it('кнопка, уход со страницы и пауза площадки зовут одно правило', () => {
    expect(body('runPauseEvent')).toContain('runPauseStep(');
    expect(SRC).toContain("runPauseEvent('toggle')");
    expect(SRC).toContain("addEventListener('pagehide', () => runPauseEvent('hidden'))");
    expect(SRC).toMatch(/if \(document\.visibilityState === 'hidden'\) runPauseEvent\('hidden'\);/);
    expect(SRC).toContain(
      "host.onPlatformPause?.((paused) => runPauseEvent(paused ? 'platform-pause' : 'platform-resume'));",
    );
  });

  it('возобновление не нагоняет время паузы', () => {
    expect(body('runPauseEvent')).toContain(
      'if (speed <= 0 && next.speed > 0) lastReal = performance.now();',
    );
  });

  it('пауза есть только у забега Sector Zero — не сетевого и не законченного', () => {
    expect(body('runPauseShown')).toContain(
      "return sectorRunActive && !NET && s.match.status !== 'ended';",
    );
  });
});

describe('пауза забега — в полосе скорости (решение владельца 2026-09-24)', () => {
  it('«‖» полосы в забеге идёт через правило паузы, а не ставит темп напрямую', () => {
    expect(SRC).toMatch(
      /if \(b\.id === 'spd-pause' && runPauseShown\(\)\) \{\s+runPauseEvent\('toggle'\);\s+return;/,
    );
  });

  it('второй кнопки паузы в строке статуса больше нет', () => {
    expect(BUILD).toContain('<div id="devline"><span id="devline-head"></span><span id="devline-status"></span></div>');
    expect(SRC).not.toContain('data-run-pause');
  });

  it('у «‖» есть подпись для мыши и скринридера', () => {
    expect(BUILD).toMatch(/<button id="spd-pause"[^>]*data-i18n-title="hud\.run\.pause"[^>]*data-i18n-aria="hud\.run\.pause"/);
  });
});
