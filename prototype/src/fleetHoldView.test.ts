/**
 * Бейдж флота на карте (`drawFleetHoldBadge`): он рисуется у каждого флота в каждом кадре,
 * поэтому обходится без save()/restore() — каждый save() оставляет в куче браузера мусор,
 * который на слабом телефоне при быстром зуме валил вкладку. Здесь проверен договор, на
 * который опирается слой флотов: что бейдж трогает и что оставляет выставленным.
 */
import { describe, expect, it } from 'vitest';
import type { FleetHold } from '../../decisions/fleetHolds';
import { FLEET_COUNT_FONT } from '../../packages/client/src/fleetCountBadge';
import { drawFleetHoldBadge } from './fleetHoldView';
import { VETERAN_GOLD } from './veteranChevrons';

interface Call {
  name: string;
  args: unknown[];
  font: unknown;
  stroke: unknown;
  width: unknown;
}

/** Холст, записывающий каждый вызов со шрифтом, цветом и толщиной линии в момент вызова. */
function recorder() {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {
    font: '9px serif',
    textAlign: 'center',
    textBaseline: 'alphabetic',
    lineWidth: 3,
    lineCap: 'butt',
    lineJoin: 'miter',
    strokeStyle: '#000',
    fillStyle: '#000',
  };
  const cx = new Proxy(props, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      return (...args: unknown[]) => {
        calls.push({ name, args, font: target.font, stroke: target.strokeStyle, width: target.lineWidth });
        if (name === 'measureText') return { width: String(args[0]).length * 10 };
        return undefined;
      };
    },
    set(target, name, value) {
      target[name as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { cx, calls, props };
}

const hold = (over: Partial<FleetHold> = {}): FleetHold => ({
  kind: 'troops',
  used: 2,
  capacity: 4,
  reserved: 0,
  free: 2,
  over: 0,
  usedFraction: 0.5,
  reservedFraction: 0,
  loadingProgress: 0,
  unloading: 0,
  unloadingProgress: 0,
  ...over,
});

describe('бейдж флота на карте', () => {
  it('без save(): знак флота — путь, шрифт счёта остаётся выставленным, шеврон возвращает линию', () => {
    const { cx, calls, props } = recorder();
    drawFleetHoldBadge(cx, { x: 100, y: 100 }, null, 12, [], false, '#35d6e6', 2);
    expect(calls.filter((c) => c.name === 'save' || c.name === 'restore')).toEqual([]);
    // Знак «▱» — обводка пути, а не глиф: у глифа свой шрифт, и смена шрифта — тоже мусор.
    expect(calls.filter((c) => c.name === 'fillText').map((c) => [c.args[0], c.font])).toEqual([['12', FLEET_COUNT_FONT]]);
    // Шеврон ветерана — золотой линией в 2 px; толщину, концы и стыки он возвращает сам.
    const chevron = calls.filter((c) => c.name === 'stroke').at(-1)!;
    expect([chevron.stroke, chevron.width]).toEqual([VETERAN_GOLD, 2]);
    expect([props.lineWidth, props.lineCap, props.lineJoin]).toEqual([1, 'butt', 'miter']);
    // Договор со слоем: остаются выставлены шрифт счёта и выравнивание текста.
    expect([props.font, props.textAlign, props.textBaseline]).toEqual([FLEET_COUNT_FONT, 'left', 'middle']);
  });

  it('трюм: цифры своим шрифтом, после шкал — снова шрифт счёта; полосы погрузки — в своём save() с клипом', () => {
    const { cx, calls, props } = recorder();
    drawFleetHoldBadge(cx, { x: 100, y: 100 }, null, 3, [hold({ reserved: 1, reservedFraction: 0.25 })], true, '#35d6e6');
    expect(calls.filter((c) => c.name === 'save' || c.name === 'restore' || c.name === 'clip').map((c) => c.name)).toEqual([
      'save',
      'clip',
      'restore',
    ]);
    const figure = calls.find((c) => c.name === 'fillText' && c.args[0] === '2/4')!;
    expect(figure.font).toBe('600 10px ui-monospace,Menlo,monospace');
    expect(props.font).toBe(FLEET_COUNT_FONT);
  });
});
