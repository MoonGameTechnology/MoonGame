import { describe, it, expect } from 'vitest';
import { nodeView, seesDetails, type NodeSight } from './fogView';

const sight = (over: Partial<NodeSight> = {}): NodeSight => ({
  sector: 'core',
  identified: false,
  remembered: false,
  ...over,
});

describe('туман — каким рисовать узел', () => {
  it('ПУСТОЙ УЗЕЛ — НЕ СЕКРЕТ: спрятать его значит оставить дыру в сетке путей', () => {
    expect(nodeView(sight({ sector: 'empty' }))).toBe('void');
    expect(nodeView(sight({ sector: 'empty', identified: true }))).toBe('void');
    expect(nodeView(sight({ sector: 'empty', remembered: true }))).toBe('void');
  });

  it('опознанный мир показывается целиком', () => {
    expect(nodeView(sight({ identified: true }))).toBe('full');
  });

  it('НЕОПОЗНАННЫЙ ПОКАЗЫВАЕТСЯ ПАМЯТЬЮ, а не нынешней правдой', () => {
    expect(nodeView(sight({ remembered: true }))).toBe('remembered');
  });

  it('НИКОГДА НЕ ВИДЕННЫЙ — «?», а не пустое место: система там есть', () => {
    expect(nodeView(sight())).toBe('unexplored');
  });

  it('опознание перевешивает память — живое важнее последнего известного', () => {
    expect(nodeView(sight({ identified: true, remembered: true }))).toBe('full');
  });

  it('тип сектора кроме «empty» на выбор вида не влияет', () => {
    for (const sector of ['core', 'nebula', 'asteroid', 'rift']) {
      expect(nodeView(sight({ sector, remembered: true })), sector).toBe('remembered');
    }
  });
});

describe('туман — виден ли мир в деталях', () => {
  it('СВОЙ МИР ВИДЕН БЕЗ ОПОЗНАНИЯ: иначе игрок слеп на собственной территории', () => {
    expect(seesDetails({ identified: false, mine: true })).toBe(true);
  });

  it('чужой опознанный виден в деталях', () => {
    expect(seesDetails({ identified: true, mine: false })).toBe(true);
  });

  it('ЧУЖОЙ НЕОПОЗНАННЫЙ НЕ ВИДЕН — иначе утекут владелец, радар и его радиус', () => {
    expect(seesDetails({ identified: false, mine: false })).toBe(false);
  });

  it('свой и опознанный одновременно — тоже виден', () => {
    expect(seesDetails({ identified: true, mine: true })).toBe(true);
  });
});
