import { describe, expect, it } from 'vitest';
import { hubDoor } from './hubDoor';

describe('главная дверь хаба (UIX-10.1)', () => {
  const save = { mapId: 'nexus', time: 3 * 86_400_000 };

  it('сохранённая партия — «Продолжить» с её картой и временем', () => {
    expect(hubDoor(save, false)).toEqual({ kind: 'continue', mapId: 'nexus', time: 259_200_000 });
  });

  it('начатая партия важнее обучения (правило 1)', () => {
    expect(hubDoor(save, true).kind).toBe('continue');
  });

  it('нечитаемое сохранение не прячется: дверь остаётся, закрытая (правило 2)', () => {
    expect(hubDoor('unreadable', false)).toEqual({ kind: 'broken' });
    expect(hubDoor('unreadable', true)).toEqual({ kind: 'broken' });
  });

  it('новичку без сохранения — обучение (правило 3)', () => {
    expect(hubDoor('empty', true)).toEqual({ kind: 'tutorial' });
  });

  it('прошедшему обучение без сохранения двери нет (правило 4)', () => {
    expect(hubDoor('empty', false)).toEqual({ kind: 'none' });
  });
});
