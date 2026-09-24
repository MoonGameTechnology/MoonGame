/**
 * Проводка часов забега (решение владельца 2026-09-24) — статический сторож, как соседние:
 * `main.ts` живёт на DOM, и поднимать его в vitest значило бы проверять мок. Правило
 * пересчёта держит `decisions/runClock.test.ts`, форматтеры — `format.test.ts`; здесь —
 * что экраны забега действительно идут через них, а не печатают «/ч» и игровые часы мимо.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const MAIN = read('./main.ts');
const CARD = read('./resourceCard.ts');

describe('часы забега — проводка', () => {
  it('форматтеры спрашивают у хоста, идёт ли забег, — вопросом, а не флагом', () => {
    expect(MAIN).toContain('setRunClock(isSectorZeroRun);');
    expect(MAIN.match(/setRunClock\(/g)).toHaveLength(1);
  });

  it('приток в полосе ресурсов — через `flowRate`/`flowPer`, без вшитого «/ч»', () => {
    expect(MAIN).toContain('const flow = flowRounded(flowRate(inc[key] ?? 0));');
    expect(MAIN).toContain('${flowDigits(flow, kfmt)}${flowPer()}</em>');
    expect(MAIN).not.toMatch(/flowDigits\(flow, kfmt\)\}\/ч/);
  });

  it('карточка ресурса — те же скорости в той же единице', () => {
    expect(CARD).toContain('const v = flowRate(perHour);');
    expect(CARD).toContain('${netStr}${esc(flowPer())}');
    expect(CARD).not.toContain('/ч<');
  });

  it('часы статусной полосы в забеге — время забега, а не время суток', () => {
    expect(MAIN).toContain('isSectorZeroRun() ? runClockText(s.time) : clockHM(s.time)');
  });

  it('сроки стройки и исследований — через `fmtDur`, а не голые часы', () => {
    for (const file of ['./buildScreen.ts', './techTree.ts']) {
      const src = read(file);
      expect([file, src.includes('fmtDur(')]).toEqual([file, true]);
      expect([
        file,
        /t\('fmt\.hours', \{ n: (lv|def)\.buildTimeHours|t\('fmt\.hours', \{ n: td\.researchTimeHours/.test(
          src,
        ),
      ]).toEqual([file, false]);
    }
  });
});
