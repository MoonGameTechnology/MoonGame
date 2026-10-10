import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { captureHeard, researchHeard, gainRepaint } from './gainNews';

const ME = 'p1';
const FOE = 'p2';

describe('gainNews — кто слышит о захвате', () => {
  it('взявший мир слышит (правило 1)', () => {
    expect(captureHeard(ME, FOE, ME)).toBe(true);
    expect(captureHeard(ME, null, ME)).toBe(true);
  });

  it('тот, у кого мир взяли, слышит — потеря своего не проходит молча', () => {
    expect(captureHeard(FOE, ME, ME)).toBe(true);
  });

  // Решение владельца 2026-10-06: чужой захват даже на видимом мире — раскрытие
  // информации. Прежде строку пускал фог-вердикт, и печатался любой захват в обзоре.
  it('чужой захват не слышен — ни между двумя чужими, ни ничейного мира', () => {
    expect(captureHeard(FOE, 'p3', ME)).toBe(false);
    expect(captureHeard(FOE, null, ME)).toBe(false);
  });

  it('безымянные стороны — не я (fail-secure)', () => {
    expect(captureHeard(undefined, undefined, ME)).toBe(false);
    expect(captureHeard(null, null, ME)).toBe(false);
  });

  // Сторож места вызова: строку захвата пускает `captureHeard`, а не фог-вердикт. Если
  // её снова занесут под `seen(...)` вместе со вспышкой, чужой захват на видимом мире
  // опять поедет в журнал, тосты и сводку — и увидит это только игрок.
  it('в ленте (`eventFeed.ts`) строка захвата стоит под captureHeard, а не под фог-вердиктом', () => {
    const src = readFileSync(new URL('./eventFeed.ts', import.meta.url), 'utf8');
    const at = src.indexOf("case 'planet.captured':");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("      case '", at + 10));
    const gate = body.indexOf('if (captureHeard(p.owner, p.from, ME))');
    const line = body.indexOf("t('log.capture'");
    expect(gate).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(gate);
    expect(body.slice(gate, line)).not.toContain('seen(');
  });
});

describe('gainNews — кто слышит об открытии', () => {
  it('только исследователь (правило 4)', () => {
    expect(researchHeard(ME, ME)).toBe(true);
    expect(researchHeard(FOE, ME)).toBe(false);
  });

  it('безымянный исследователь — не я (fail-secure)', () => {
    expect(researchHeard(undefined, ME)).toBe(false);
    expect(researchHeard(null, ME)).toBe(false);
  });
});

describe('gainNews — что перерисовать', () => {
  it('захват двигает счётчик провинций в ростере (правило 5)', () => {
    expect(gainRepaint('capture')).toEqual({ roster: true, techTree: false });
  });

  it('открытие двигает доступность узлов в дереве (правило 5)', () => {
    expect(gainRepaint('research')).toEqual({ roster: false, techTree: true });
  });

  it('виды не пересекаются — захват не трогает дерево, открытие не трогает ростер', () => {
    expect(gainRepaint('capture').techTree).toBe(false);
    expect(gainRepaint('research').roster).toBe(false);
  });

  // Сторож правила 5: перерисовка НЕ зависит от того, услышал ли игрок строку.
  // Если кто-то занесёт её под проверку адресата, ростер перестанет сходиться
  // с состоянием на захвате за туманом — а увидит это только игрок.
  it('вердикт не принимает адресата вовсе — ему нечем от него зависеть', () => {
    expect(gainRepaint.length).toBe(1);
  });
});
