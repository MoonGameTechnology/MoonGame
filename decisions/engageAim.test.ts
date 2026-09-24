import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { engageFoeAt, type EngageCandidate } from './engageAim';

const foe = (id: string, location: string | null, x: number, y: number, ships = 1): EngageCandidate => ({
  id,
  location,
  x,
  y,
  ships,
});

describe('цель «Атаки» под указателем (сообщение владельца 2026-09-24)', () => {
  it('флот рядом с указателем — он и цель, ближайший из двух', () => {
    const list = [foe('a', 'W1', 10, 0), foe('b', 'W2', 4, 0)];
    expect(engageFoeAt(list, { x: 0, y: 0 }, 12, null)?.id).toBe('b');
  });

  it('тап по миру, где стоит флот противника, — это атака на него, а не промах', () => {
    const list = [foe('pirates', 'den', 100, 100, 2)];
    expect(engageFoeAt(list, { x: 0, y: 0 }, 12, 'den')?.id).toBe('pirates');
  });

  it('на мире несколько флотов — самый крупный; при равенстве — по id', () => {
    const list = [foe('b', 'den', 100, 100, 3), foe('c', 'den', 100, 100, 5), foe('a', 'den', 100, 100, 5)];
    expect(engageFoeAt(list, { x: 0, y: 0 }, 12, 'den')?.id).toBe('a');
  });

  it('флот рядом важнее мира под указателем', () => {
    const list = [foe('near', 'W9', 3, 0), foe('there', 'den', 100, 100, 9)];
    expect(engageFoeAt(list, { x: 0, y: 0 }, 12, 'den')?.id).toBe('near');
  });

  it('мир без флота противника и пустое место — цели нет', () => {
    const list = [foe('a', 'W1', 100, 100)];
    expect(engageFoeAt(list, { x: 0, y: 0 }, 12, 'empty_world')).toBeNull();
    expect(engageFoeAt(list, { x: 0, y: 0 }, 12, null)).toBeNull();
  });
});

describe('проводка «Атаки» в прототипе', () => {
  // Сторож: прицел ATK-1 не рисовал ничего, и кнопка читалась сломанной. Цели в уголках,
  // путь в превью и нажатие обязаны идти через одно правило цели.
  const main = readFileSync(new URL('../prototype/src/main.ts', import.meta.url), 'utf8');
  it('цели рисуются в кадре, превью и нажатие спрашивают engageFoeAt', () => {
    expect(main).toContain('drawEngageTargets(lastReal);');
    expect(main).toContain('if (!(aiming || assaultAim || engageAim)) return;');
    expect(main.match(/engageFoeAt\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
