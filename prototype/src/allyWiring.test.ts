/**
 * Проводка интерфейса главы IV (PVR-7.5) — статический сторож, как у окна торговца: проводка
 * живёт в DOM и кадре `main.ts`, а робот главы в CI не играет. Держит то, что может
 * отвалиться молча: вход в окно, кадровый такт, прицел по карте, метки, Back и кнопку
 * извлечения.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');

describe('глава IV — проводка интерфейса', () => {
  it('окно есть в разметке; вход — чип строки статуса', () => {
    expect(BUILD).toContain('<div id="ally"></div>');
    expect(MAIN).toMatch(/closest\('\[data-ally-open\]'\)\) \{ allyScreen\.open\(\); return; \}/);
    expect(MAIN).toMatch(
      /const allyView = sectorRunActive \? allyPanelView\(s, ME, data\) : null;/,
    );
  });

  it('кадр ведёт окно, Back закрывает его', () => {
    expect(MAIN).toMatch(/tickTrader\(\);\s*tickAlly\(\);/);
    expect(MAIN).toMatch(
      /\{ id: 'ally', isOpen: \(\) => allyScreen\.isOpen\(\), close: \(\) => allyScreen\.close\(\) \}/,
    );
  });

  it('взведённый приказ забирает тап по карте и уходит в ядро как `ally.order`', () => {
    expect(MAIN).toMatch(/allyAim: !!allyAim,/);
    expect(MAIN).toMatch(/if \(owner === 'ally-order' && allyAim\) \{/);
    expect(MAIN).toMatch(
      /playerOrder\(allyOrder\(ME, ally, kind, hit \? \{ fleet: hit\.id \} : \{ planet: node!\.id \}\)\)/,
    );
  });

  it('на карте — цель союзника и носитель; в панели — цепочка и извлечение', () => {
    expect(MAIN).toMatch(/drawMissionTargets\(\);\s*drawAllyMarks\(\);/);
    expect(MAIN).toMatch(/chain: \(\) => runChain\(\),/);
    expect(MAIN).toMatch(/playerOrder\(extractionStart\(ME, fleetId\)\)/);
  });

  it('встреча зовёт открыть связь: заметка и мигающий чип', () => {
    expect(MAIN).toMatch(
      /case 'ally\.contact':[\s\S]{0,120}note\(t\('ally\.contact\.note'\)\);\s*allyPulseUntil = /,
    );
  });
});

describe('глава VI — проводка интерфейса (PVR-8.4, PVR-8.5)', () => {
  it('панель берёт цепочку главы с данными: у главы VI счёт контракта операции', () => {
    expect(MAIN).toMatch(
      /return chapterChain\(s, ME, extractionNeedMs\(s, ctx\(s\.time, s\)\), data\);/,
    );
  });

  it('доки найдены — живой сигнал; угроза докам — доклад и мигающий чип связи', () => {
    expect(MAIN).toMatch(
      /case 'refuge\.found':\s*if \(p\.owner === ME\) note\(t\('refuge\.signal'\)/,
    );
    expect(MAIN).toMatch(
      /note\(t\('refuge\.threat'\), toRefuge\[0\]!\.at\);\s*allyPulseUntil = performance\.now\(\) \+ /,
    );
  });

  it('окно связи видит флоты так же, как карта: предложение охранять доки — по видимому', () => {
    expect(MAIN).toMatch(/order: playerOrder,\s*sees: fleetSeen,\s*\}\);/);
  });
});
