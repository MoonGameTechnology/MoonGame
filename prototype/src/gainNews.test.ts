import { describe, it, expect } from 'vitest';
import { researchHeard, gainRepaint } from './gainNews';

const ME = 'p1';
const FOE = 'p2';

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
