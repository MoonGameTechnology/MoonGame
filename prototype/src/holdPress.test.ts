import { describe, it, expect } from 'vitest';
import { IDLE, MAP_HOLD_MS, consumeClick, mature, moveAway, press, release } from './holdPress';

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

// ── Карта (REFM-131) ─────────────────────────────────────────────────────────
// Порядок вызовов повторяет проводку в `main.ts`: у карты своя мерка «поехал палец» и
// свой второй палец, но фазы удержания — те же, что у плитки.
describe('удержание НА КАРТЕ — та же жизнь, что у плитки', () => {
  it('добор флота: удержание созрело и СЪЕЛО отпускание — иначе тот же жест ещё и выберет', () => {
    let st = press(ТОЧКА); // палец лёг
    st = mature(st); // ожидание доиграло → добор флота
    expect(st.matured).toBe(true);
    st = release(st); // cancelLongPress на отпускании
    const хвост = consumeClick(st);
    expect(хвост.eat).toBe(true);
    // следующее отпускание — уже честное
    expect(consumeClick(хвост.next).eat).toBe(false);
  });

  it('ПАНОРАМА НЕ ДАЁТ УДЕРЖАНИЯ: поехавший палец снял ожидание, созревать нечему', () => {
    const st = mature(moveAway(press(ТОЧКА)));
    expect(st.matured).toBe(false);
    expect(consumeClick(release(st)).eat).toBe(false); // и отпускание не съедено
  });

  it('ВТОРОЙ ПАЛЕЦ СНИМАЕТ ОЖИДАНИЕ: щипок — не удержание', () => {
    const st = mature(release(press(ТОЧКА))); // release = cancelLongPress из ветки щипка
    expect(st.matured).toBe(false);
  });

  it('системная отмена жеста НЕ ОСТАВЛЯЕТ права съесть: отпускания уже не будет', () => {
    const st = mature(press(ТОЧКА));
    expect(st.matured).toBe(true);
    expect(consumeClick(IDLE).eat).toBe(false); // pointercancel обнуляет жизнь целиком
  });

  it('карта ждёт своё время, отдельно от панельного', () => {
    expect(MAP_HOLD_MS).toBe(350);
  });
});
