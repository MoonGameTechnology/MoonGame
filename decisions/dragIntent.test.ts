import { describe, expect, it } from 'vitest';
import { type DragIntent, cameraFollows, dragIntent, marksDragged } from './dragIntent';

// Полный жест по умолчанию: один палец, ничего не вооружено, тач, рамки нет.
const base = { pointers: 1, armed: false, pc: false, boxing: false, hasStart: true };
const at = (over: Partial<typeof base>) => dragIntent({ ...base, ...over });

describe('dragIntent — чем занят едущий палец', () => {
  it('правило 1: два пальца — щипок, что бы ни было вооружено', () => {
    expect(at({ pointers: 2 })).toBe('pinch');
    expect(at({ pointers: 2, armed: true })).toBe('pinch');
    expect(at({ pointers: 2, boxing: true })).toBe('pinch');
    expect(at({ pointers: 3, armed: true, pc: true, boxing: true })).toBe('pinch');
  });

  it('правило 1: второй палец НЕ отменяет вооружённый приказ — он везёт камеру', () => {
    // Раньше отменял, и это запирало игрока: цель за краем экрана становилась
    // недостижимой, потому что камеру при вооружённом «Курсе» было не сдвинуть.
    expect(at({ pointers: 2, armed: true })).toBe('pinch');
    expect(cameraFollows(at({ pointers: 2, armed: true }))).toBe(true);
  });

  it('правило 2: палец + вооружённый приказ ведёт ПРИЦЕЛ, а не карту', () => {
    expect(at({ armed: true })).toBe('aim');
    // Та самая починка «слепого приказа»: камера при этом стоит.
    expect(cameraFollows('aim')).toBe(false);
  });

  it('правило 3: на PC вооружённый приказ протяжку не забирает — это панорама', () => {
    expect(at({ armed: true, pc: true })).toBe('pan');
    expect(cameraFollows(at({ armed: true, pc: true }))).toBe(true);
  });

  it('правило 3: рамка на PC работает даже при вооружённом приказе', () => {
    expect(at({ armed: true, pc: true, boxing: true })).toBe('box');
  });

  it('правило 2 сильнее рамки: на тач вооружённый приказ забирает жест себе', () => {
    expect(at({ armed: true, boxing: true })).toBe('aim');
  });

  it('правило 4: рамка без точки начала не строится — жест уходит в панораму', () => {
    expect(at({ boxing: true, hasStart: false })).toBe('pan');
    expect(at({ boxing: true, hasStart: true })).toBe('box');
  });

  it('правило 5: ничем не занятое движение возит карту', () => {
    expect(at({})).toBe('pan');
    expect(at({ pc: true })).toBe('pan');
    expect(at({ pointers: 0 })).toBe('pan');
  });
});

describe('cameraFollows — правило 6', () => {
  it('камера едет только в щипке и панораме', () => {
    expect(cameraFollows('pinch')).toBe(true);
    expect(cameraFollows('pan')).toBe(true);
  });

  it('в прицеле и рамке камера стоит: иначе уехали бы и цель, и углы рамки', () => {
    expect(cameraFollows('aim')).toBe(false);
    expect(cameraFollows('box')).toBe(false);
  });
});

describe('marksDragged — правило 7', () => {
  it('щипок помечается протяжкой безусловно — два пальца это уже не тап', () => {
    expect(marksDragged('pinch', false)).toBe(true);
    expect(marksDragged('pinch', true)).toBe(true);
  });

  it('прицел не помечается НИКОГДА: протяжка и есть прицеливание', () => {
    expect(marksDragged('aim', false)).toBe(false);
    expect(marksDragged('aim', true)).toBe(false);
  });

  it('рамка и панорама помечаются, только если палец ушёл за порог тапа', () => {
    for (const i of ['box', 'pan'] as const) {
      expect(marksDragged(i, false)).toBe(false);
      expect(marksDragged(i, true)).toBe(true);
    }
  });

  it('каждый вердикт имеет ответ на оба исхода порога — молчащих нет', () => {
    const all: DragIntent[] = ['pinch', 'aim', 'box', 'pan'];
    for (const i of all) {
      for (const moved of [false, true]) {
        expect(typeof marksDragged(i, moved)).toBe('boolean');
      }
    }
  });
});
