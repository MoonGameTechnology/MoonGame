import { describe, expect, it } from 'vitest';
import { coalitionChatShown, shownDms } from './diploChats';

describe('diploChats — какие чаты видны', () => {
  const others = ['p2', 'p3', 'p4', 'p5'];

  it('без переписки и предложений лички нет', () => {
    expect(
      shownDms({ others, open: 'session', talked: () => false, offered: () => false }),
    ).toEqual([]);
  });

  it('переписка или предложение в любую сторону создаёт чат', () => {
    const got = shownDms({
      others,
      open: 'session',
      talked: (id) => id === 'p3',
      offered: (id) => id === 'p5',
    });
    expect(got).toEqual(['p3', 'p5']);
  });

  it('открытая пустая переписка остаётся в списке', () => {
    expect(shownDms({ others, open: 'p4', talked: () => false, offered: () => false })).toEqual([
      'p4',
    ]);
  });

  it('канал коалиции — только при хотя бы одном союзнике', () => {
    expect(coalitionChatShown(1)).toBe(false);
    expect(coalitionChatShown(2)).toBe(true);
  });
});
