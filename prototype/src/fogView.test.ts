import { describe, it, expect } from 'vitest';
import { fleetVisible, nodeView, seesDetails, type NodeSight } from './fogView';

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

describe('туман — видимость флота', () => {
  it('СВОЙ ФЛОТ ВИДЕН ВСЕГДА: туман прячет чужое, а не свои силы', () => {
    expect(fleetVisible(true, false, false)).toBe(true);
  });

  it('чужой флот виден на ОПОЗНАННОМ узле', () => {
    expect(fleetVisible(false, true, false)).toBe(true);
  });

  it('ПО ОДНОМУ РАДАРУ ФЛОТ НЕ ПОКАЗЫВАЮТ: засечка это не состав эскадры', () => {
    // радар сюда не входит вовсе: неопознанный узел без окна разведки — не видно
    expect(fleetVisible(false, false, false)).toBe(false);
  });

  it('ОКНО РАЗВЕДКИ ПОКАЗЫВАЕТ ФЛОТЫ ВЛАДЕЛЬЦА, где бы они ни стояли', () => {
    expect(fleetVisible(false, false, true)).toBe(true);
  });

  it('окно и опознание не спорят — любого достаточно', () => {
    expect(fleetVisible(false, true, true)).toBe(true);
  });
});
