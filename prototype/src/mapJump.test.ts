import { describe, it, expect } from 'vitest';
import { jumpStep, GOTO_MIN_ZOOM, PING_ZOOM } from './mapJump';

describe('переход к точке карты — мёртвая ссылка', () => {
  it('ПО ИСЧЕЗНУВШЕМУ МИРУ НЕ ДВИГАЕМСЯ: камера у пустого места хуже, чем ничего', () => {
    expect(jumpStep('ping', false, 1)).toEqual({ do: 'none' });
    expect(jumpStep('goto', false, 1)).toEqual({ do: 'none' });
  });
});

describe('переход к точке карты — масштаб', () => {
  it('ПРЫЖОК ПРИБЛИЖАЕТ ВСЕГДА: пришедший из текста вида не выбирал', () => {
    expect(jumpStep('ping', true, 1)).toMatchObject({ scale: PING_ZOOM });
    expect(jumpStep('ping', true, 8)).toMatchObject({ scale: PING_ZOOM });
  });

  it('ПЕРЕХОД НЕ ОТДАЛЯЕТ: настроенный игроком вид не отбирают', () => {
    expect(jumpStep('goto', true, 6)).toMatchObject({ scale: 6 });
  });

  it('переход из общего плана поднимает масштаб до порога', () => {
    expect(jumpStep('goto', true, 1)).toMatchObject({ scale: GOTO_MIN_ZOOM });
  });

  it('на самом пороге масштаб не меняется', () => {
    expect(jumpStep('goto', true, GOTO_MIN_ZOOM)).toMatchObject({ scale: GOTO_MIN_ZOOM });
  });
});

describe('переход к точке карты — выделение и окна', () => {
  it('ПРЫЖОК ПЕРЕКЛЮЧАЕТ ВЫДЕЛЕНИЕ: иначе оставленный флот показал бы свою карточку', () => {
    expect(jumpStep('ping', true, 1)).toMatchObject({ select: true });
  });

  it('ПЕРЕХОД ВЫДЕЛЕНИЯ НЕ ТРОГАЕТ: панель, из которой он вызван, обязана остаться', () => {
    expect(jumpStep('goto', true, 1)).toMatchObject({ select: false });
  });

  it('ПРЫЖОК ЗАКРЫВАЕТ ДИПЛООКНО: оно перекрыло бы карту, ради которой прыгали', () => {
    expect(jumpStep('ping', true, 1)).toMatchObject({ closeDiplo: true });
  });

  it('переход диплоокно сам не закрывает — это делает его дорога изнутри окна', () => {
    expect(jumpStep('goto', true, 1)).toMatchObject({ closeDiplo: false });
  });
});

describe('переход к точке карты — чем отмечена точка', () => {
  it('ВСПЫШКА ТОЛЬКО У ПЕРЕХОДА: без смены выделения показать место больше нечем', () => {
    expect(jumpStep('goto', true, 1)).toMatchObject({ ring: true });
  });

  it('прыжок кольца не рисует — место уже названо сменой выделения', () => {
    expect(jumpStep('ping', true, 1)).toMatchObject({ ring: false });
  });

  it('обе дороги при живом мире всё-таки ведут камеру', () => {
    expect(jumpStep('ping', true, 1).do).toBe('jump');
    expect(jumpStep('goto', true, 1).do).toBe('jump');
  });
});
