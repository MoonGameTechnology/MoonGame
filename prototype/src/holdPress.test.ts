import { describe, it, expect } from 'vitest';
import { IDLE, consumeClick, mature, moveAway, press, release } from './holdPress';

const ТОЧКА = { x: 10, y: 20 };

describe('долгое нажатие — взвод и снятие', () => {
  it('нажатие взводит ожидание и запоминает точку', () => {
    expect(press(ТОЧКА)).toEqual({ from: ТОЧКА, armed: true, matured: false });
  });

  it('ПОЕХАВШИЙ ПАЛЕЦ СНИМАЕТ ОЖИДАНИЕ: прокрутка не должна давать подсказок', () => {
    expect(moveAway(press(ТОЧКА)).armed).toBe(false);
    expect(moveAway(press(ТОЧКА)).from).toBeNull();
  });

  it('движение без взведённого ожидания ничего не меняет', () => {
    expect(moveAway(IDLE)).toEqual(IDLE);
  });

  it('отпускание гасит ожидание и точку', () => {
    const st = release(press(ТОЧКА));
    expect(st.armed).toBe(false);
    expect(st.from).toBeNull();
  });
});

describe('долгое нажатие — созревание', () => {
  it('созревает только взведённое', () => {
    expect(mature(press(ТОЧКА)).matured).toBe(true);
    expect(mature(IDLE).matured).toBe(false);
  });

  it('созревшее больше не ждёт', () => {
    expect(mature(press(ТОЧКА)).armed).toBe(false);
  });

  it('СНЯТОЕ ДВИЖЕНИЕМ НЕ СОЗРЕВАЕТ: палец уехал — подсказки не будет', () => {
    expect(mature(moveAway(press(ТОЧКА))).matured).toBe(false);
  });
});

describe('долгое нажатие — хвостовой клик', () => {
  it('СОЗРЕВШЕЕ УДЕРЖАНИЕ СЪЕДАЕТ КЛИК: иначе поверх подсказки откроется ещё и кодекс', () => {
    const после = release(mature(press(ТОЧКА)));
    expect(consumeClick(после).eat).toBe(true);
  });

  it('ПРАВО СЪЕСТЬ ОДНОРАЗОВОЕ: иначе следующий честный тап молча пропадёт', () => {
    const после = release(mature(press(ТОЧКА)));
    const первый = consumeClick(после);
    expect(первый.eat).toBe(true);
    expect(consumeClick(первый.next).eat).toBe(false);
  });

  it('обычный тап клик не съедает', () => {
    expect(consumeClick(release(press(ТОЧКА))).eat).toBe(false);
    expect(consumeClick(IDLE).eat).toBe(false);
  });

  it('право съесть переживает отпускание — клик приходит уже после него', () => {
    expect(release(mature(press(ТОЧКА))).matured).toBe(true);
  });

  it('прокрутка права съесть не даёт', () => {
    expect(consumeClick(release(moveAway(press(ТОЧКА)))).eat).toBe(false);
  });
});
