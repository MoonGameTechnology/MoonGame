/**
 * Сторож проводки паузы забега (`YAG-6.2`) — статический: `main.ts` живёт на DOM. Правила
 * паузы покрыты там, где они живут (`decisions/runPause.test.ts`), поведение на собранном
 * архиве — робот `yandextest.mjs`. Здесь стык, и у него четыре способа сломаться молча:
 *
 * 1. **Повод не подключён.** Уход со страницы или пауза площадки не доходят до правила —
 *    мир снова тикает без игрока, и ни один тест правил этого не видит.
 * 2. **Возобновление нагоняет паузу.** Забыт сброс отметки реального времени — первый кадр
 *    после «продолжить» отыграет всё время паузы разом.
 * 3. **Кнопку снова рисуют строкой.** Строка статуса перерисовывается каждый кадр, и
 *    пересозданная кнопка теряет нажатие (так и было в первой редакции).
 * 4. **Кнопка на ПК глуха.** Строка статуса там не принимает нажатий, и кнопке нужно
 *    отдельное разрешение.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
const HOLO = readFileSync(new URL('../holographic.css', import.meta.url), 'utf8');
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

describe('YAG-6.2 — кнопка переживает перерисовку строки статуса', () => {
  it('кнопка — постоянный узел разметки между двумя перерисовываемыми частями', () => {
    expect(BUILD).toMatch(
      /<div id="devline"><span id="devline-head"><\/span><button id="runpause"[^>]*data-run-pause="1"[^>]*hidden><\/button><span id="devline-status"><\/span><\/div>/,
    );
  });

  it('в перерисовываемую строку кнопку больше не пишут', () => {
    expect(SRC.match(/data-run-pause="/g) ?? []).toHaveLength(0);
  });

  it('на ПК строка статуса глуха к нажатиям — кнопке паузы нажатия разрешены', () => {
    expect(HOLO).toContain('body.holo-ui #devline .dl-pause{pointer-events:auto;}');
  });
});
