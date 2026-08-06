import { describe, it, expect } from 'vitest';
import { conveyorHtml, type ConveyorLabels, type ConveyorView } from './conveyorView';

const labels: ConveyorLabels = {
  now: 'СЕЙЧАС',
  cancel: 'отменить',
  waiting: (c) => `ждём: ${c}`,
  idle: 'простаивает',
  idleTag: 'КОНВЕЙЕР',
  idleSub: 'готов к заказу',
  dequeue: 'убрать из очереди',
  queueEmpty: 'очередь пуста',
  paused: (n) => `пауза ${n}%`,
  resume: 'продолжить',
};

const view = (over: Partial<ConveyorView> = {}): ConveyorView => ({
  active: null,
  queued: [],
  paused: [],
  waitingCost: null,
  compact: false,
  ...over,
});

const active = { label: '<b>Шахта</b>', at: 5_000_000, durationMs: 3_600_000, seq: 7 };

describe('конвейер — идущая стройка', () => {
  it('показывает подпись, кнопку отмены и полосу', () => {
    const html = conveyorHtml('C1R1', 'buildings', view({ active }), labels);
    expect(html).toContain('СЕЙЧАС');
    expect(html).toContain('<b>Шахта</b>');
    expect(html).toContain('data-act="cancelbuild"');
    expect(html).toContain('data-arg="7"');
    expect(html).toContain('conv-fill');
  });

  it('ЖИВЫЕ ЧИСЛА не входят в разметку — только якоря для покадрового патча', () => {
    const html = conveyorHtml('C1R1', 'buildings', view({ active }), labels);
    expect(html).toContain('data-at="5000000"');
    expect(html).toContain('data-dur="3600000"');
    expect(html).toContain('style="width:0%"'); // полоса стартует с нуля
    expect(html).toContain('>—<'); // время — прочерк до первого патча
  });

  it('разметка НЕ меняется, пока не изменилась сама стройка', () => {
    const a = conveyorHtml('C1R1', 'buildings', view({ active }), labels);
    const b = conveyorHtml('C1R1', 'buildings', view({ active }), labels);
    expect(a).toBe(b); // иначе панель пересобиралась бы 60×/с и глотала клики
  });

  it('досье активной стройки различает мир, полосу и номер события', () => {
    const html = conveyorHtml('C1R1', 'units', view({ active }), labels);
    expect(html).toContain('data-desc="c:C1R1:units:active:7"');
  });
});

describe('конвейер — когда стройки нет', () => {
  it('ОЧЕРЕДЬ БЕЗ ДЕНЕГ называет цену, а не притворяется простоем', () => {
    const html = conveyorHtml(
      'C1R1',
      'buildings',
      view({ queued: [{ label: 'Шахта' }], waitingCost: '100¤' }),
      labels,
    );
    expect(html).toContain('ждём: 100¤');
    expect(html).not.toContain('готов к заказу');
  });

  it('простой в обычной раскладке подписан двумя строками', () => {
    const html = conveyorHtml('C1R1', 'buildings', view(), labels);
    expect(html).toContain('КОНВЕЙЕР');
    expect(html).toContain('готов к заказу');
  });

  it('КОМПАКТНАЯ подача короче — одна строка вместо двух', () => {
    const html = conveyorHtml('C1R1', 'buildings', view({ compact: true }), labels);
    expect(html).toContain('простаивает');
    expect(html).not.toContain('КОНВЕЙЕР');
  });

  it('пустая полоса рисуется в любом случае — иначе строка прыгает', () => {
    expect(conveyorHtml('C1R1', 'buildings', view(), labels)).toContain('class="bar"');
  });
});

describe('конвейер — очередь', () => {
  const queued = [{ label: 'Шахта' }, { label: 'Ферма' }];

  it('строки пронумерованы с единицы и идут по порядку', () => {
    const html = conveyorHtml('C1R1', 'buildings', view({ queued }), labels);
    expect(html).toContain('<em>1</em>Шахта');
    expect(html).toContain('<em>2</em>Ферма');
    expect(html.indexOf('Шахта')).toBeLessThan(html.indexOf('Ферма'));
  });

  it('у каждой строки своя кнопка снятия с её местом в полосе', () => {
    const html = conveyorHtml('C1R1', 'units', view({ queued }), labels);
    expect(html).toContain('data-arg="units:0"');
    expect(html).toContain('data-arg="units:1"');
  });

  it('пустая очередь говорит об этом словами', () => {
    expect(conveyorHtml('C1R1', 'buildings', view(), labels)).toContain('очередь пуста');
  });

  it('в компактной подаче пустая очередь молчит — экономим строку', () => {
    const html = conveyorHtml('C1R1', 'buildings', view({ compact: true }), labels);
    expect(html).not.toContain('очередь пуста');
  });
});

describe('конвейер — приостановленное', () => {
  const paused = [{ id: 'p1', label: 'Верфь', progress: 0.42 }];

  it('показывает процент готовности и кнопку продолжения', () => {
    const html = conveyorHtml('C1R1', 'buildings', view({ paused }), labels);
    expect(html).toContain('пауза 42%');
    expect(html).toContain('data-act="resumebuild"');
    expect(html).toContain('data-arg="p1"');
  });

  it('процент округляется — дробей игроку не показывают', () => {
    const html = conveyorHtml(
      'C1R1',
      'buildings',
      view({ paused: [{ id: 'p1', label: 'В', progress: 0.567 }] }),
      labels,
    );
    expect(html).toContain('пауза 57%');
  });

  it('приостановленное показывается и вместе с идущей стройкой', () => {
    const html = conveyorHtml('C1R1', 'buildings', view({ active, paused }), labels);
    expect(html).toContain('conv-fill');
    expect(html).toContain('пауза 42%');
  });

  it('ничего не приостановлено — блока нет', () => {
    expect(conveyorHtml('C1R1', 'buildings', view(), labels)).not.toContain('class="paused"');
  });
});

describe('конвейер — экранирование', () => {
  it('id мира и полосы экранируются — они попадают в атрибуты (CWE-79)', () => {
    const html = conveyorHtml('"><img src=x>', 'buildings', view(), labels);
    expect(html).not.toContain('<img src=x');
  });

  it('id приостановленной стройки экранируется', () => {
    const html = conveyorHtml(
      'C1R1',
      'buildings',
      view({ paused: [{ id: '"><img src=x>', label: 'В', progress: 0.5 }] }),
      labels,
    );
    expect(html).not.toContain('<img src=x');
  });
});
